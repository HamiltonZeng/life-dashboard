import {guardSynthetic} from '../v02-phase3/guard.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { buildApp } from '../../apps/api/src/app.js';
import { createPool } from '../../packages/db/src/client.js';
import { seed, LOCAL_USER_ID, DEFAULT_MODULE_IDS, DEFAULT_TEMPLATE_IDS } from '../../packages/db/src/seed.js';
import { exportUserData, restoreUserData } from '../../packages/db/src/backup.js';

test('v0.2 profile and home isolated acceptance',async t=>{
  assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.DATABASE_HOST,'postgres-test');assert.equal(process.env.DATABASE_NAME,'life_dashboard_v03_test');
  const pool=createPool();(guardSynthetic(),await pool.query('TRUNCATE users CASCADE'));await seed(pool);
  const app=await buildApp(pool,{profile:'mvp'});
  const token='d'.repeat(64),cookie='life_session='+token;
  const login=async()=>pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),LOCAL_USER_ID]);
  await login();
  const req=(method:string,path:string,payload?:any,key:string=randomUUID())=>app.inject({method:method as any,url:'/api/v1/'+path,headers:{cookie,origin:'http://localhost:18380','idempotency-key':key},payload});
  const ok=async(method:string,path:string,payload?:unknown,key?:string)=>{const r=await req(method,path,payload,key);assert.equal(r.statusCode,200,r.body);return r.json().data;};
  const field={id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],key:'session',label:'学习时段',type:'text',kind:'profile',value:'token is a business word',unit:null,options:[]};
  const profileOperation=randomUUID(),profilePayload={base_version:1,nickname:'测试昵称',bio:'简介',timezone:'Pacific/Kiritimati',field_upserts:[field]};
  let profileVersion=1,prefVersion=1;const metricIds:string[]=[],taskIds:string[]=[];
  try {
    await t.test('read defaults without creating facts or config rows',async()=>{
      const home=await ok('GET','home');assert.equal(home.profile.id,LOCAL_USER_ID);assert.equal(home.profile.version,1);assert.equal(home.profile.static_avatar_ref,null);
      assert.deepEqual(home.metrics,[]);assert.deepEqual(home.tasks,[]);assert.deepEqual(home.recent_achievements,[]);assert.equal(home.wallet.balance,'0');assert.deepEqual(home.avatar,{enabled:false,model_asset_ref:null});
      assert.equal((await pool.query('SELECT count(*)::int n FROM user_profiles')).rows[0].n,0);
      assert.equal((await pool.query('SELECT count(*)::int n FROM home_preferences')).rows[0].n,0);
      const caps=await ok('GET','capabilities');for(const key of ['home','profile_fields','home_preferences'])assert.equal(caps[key],true);
      for(const key of ['ai_chat','ai_recording','ai_profile_update','ai_reward_pricing','avatar_renderer','avatar_redemption'])assert.equal(caps[key],false);
      for(const path of ['ai/chat','ai/recording','ai/profile-update','ai/reward-pricing','avatar/redeem','wallet'])assert.equal((await req('POST',path,{})).json().error.code,'FEATURE_DISABLED');
    });
    await t.test('atomic profile, legal business names, replay and stale versions',async()=>{
      const payload=profilePayload,key=profileOperation;
      const [a,b]=await Promise.all([req('PATCH','profile',payload,key),req('PATCH','profile',payload,key)]);assert.equal(a.statusCode,200,a.body);assert.deepEqual(a.json(),b.json());
      profileVersion=a.json().data.version;assert.equal(profileVersion,2);assert.equal(a.json().data.module_fields[0].key,'session');
      assert.equal((await req('PATCH','profile',{...payload,nickname:'异载荷'},key)).statusCode,409);
      const stale=await req('PATCH','profile',{base_version:1,bio:null});assert.equal(stale.statusCode,409);assert.equal(stale.json().error.details.current.version,2);
      const p=await ok('PATCH','profile',{base_version:2,bio:null});profileVersion=p.version;assert.equal(p.bio,null);assert.equal(p.nickname,'测试昵称');assert.equal(p.module_fields.length,1);
      const rev=(await pool.query("SELECT snapshot FROM configuration_revisions WHERE entity_type='profile' AND version=2")).rows[0].snapshot;assert.equal(rev.bio,'简介');
      assert.equal((await ok('GET','me')).timezone,'Pacific/Kiritimati');
    });
    await t.test('reject invalid types, derived values, duplicates and foreign fields atomically',async()=>{
      const before=await exportUserData(pool,LOCAL_USER_ID);
      for(const f of [{...field,kind:'derived'},{...field,type:'decimal',value:1},{...field,type:'integer',value:''},{...field,type:'date',value:'2026-02-30'},{...field,type:'single_select',value:'a',options:[]}])assert.ok([400,422].includes((await req('PATCH','profile',{base_version:profileVersion,nickname:'must rollback',field_upserts:[f]})).statusCode));
      assert.equal((await req('PATCH','profile',{base_version:profileVersion,nickname:null})).statusCode,400);
      assert.equal((await req('PATCH','profile',{base_version:profileVersion,timezone:'not/a/zone'})).statusCode,400);
      assert.equal((await req('PATCH','profile',{base_version:profileVersion,field_upserts:[{...field,id:randomUUID()}]})).statusCode,422);
      const other=randomUUID(),module=randomUUID(),otherField=randomUUID();
      await pool.query("INSERT INTO users(id,name) VALUES($1,'foreign')",[other]);await pool.query("INSERT INTO modules(id,user_id,name,icon,color) VALUES($1,$2,'foreign','book','blue')",[module,other]);
      await pool.query('INSERT INTO user_profiles(user_id) VALUES($1)',[other]);await pool.query("INSERT INTO profile_fields(id,user_id,module_id,key,label,type,value) VALUES($1,$2,$3,'session','foreign','text','null')",[otherField,other,module]);
      for(const f of [{...field,module_id:module},{...field,id:otherField}])assert.ok([404,422].includes((await req('PATCH','profile',{base_version:profileVersion,field_upserts:[f]})).statusCode));
      assert.equal((await req('PATCH','profile',{base_version:profileVersion,field_remove_ids:[otherField]})).statusCode,422);
      const after=await exportUserData(pool,LOCAL_USER_ID);assert.deepEqual(after.data,before.data);
    });
    await t.test('real metrics, local today tasks, pins, no duplicates or fake wallet',async()=>{
      for(let i=0;i<2;i++) {
        metricIds.push((await ok('POST','metrics',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],record_type_id:DEFAULT_TEMPLATE_IDS[0],name:'次数'+i,unit:'次',aggregation:'count',field_key:null,window:'all_time',timezone:'Asia/Shanghai'})).id);
        taskIds.push((await ok('POST','tasks',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],title:'今日任务'+i,completion_mode:'manual',record_type_id:null,acceptance:null,business_date:DateTime.now().setZone('Pacific/Kiritimati').toISODate(),timezone:'Pacific/Kiritimati'})).id);
      }
      const payload={base_version:1,pinned_metric_ids:[...metricIds].reverse(),pinned_task_ids:[...taskIds].reverse()},key=randomUUID();
      const response=await req('PATCH','home-preferences',payload,key);assert.equal(response.statusCode,200,response.body);assert.deepEqual((await req('PATCH','home-preferences',payload,key)).json(),response.json());prefVersion=response.json().data.version;
      assert.equal((await req('PATCH','home-preferences',{...payload,minimal_mode:true},key)).statusCode,409);
      let home=await ok('GET','home');assert.deepEqual(home.metrics.map((m:any)=>m.id),[...metricIds].reverse());assert.equal(home.metrics[0].computed.value,null);assert.deepEqual(home.tasks.map((x:any)=>x.id),[...taskIds].reverse());
      const minimal=await ok('PATCH','home-preferences',{base_version:prefVersion,minimal_mode:true});prefVersion=minimal.version;assert.deepEqual(minimal.pinned_metric_ids,payload.pinned_metric_ids);
      assert.equal((await req('PATCH','home-preferences',{base_version:1,minimal_mode:false})).statusCode,409);
      assert.equal((await req('PATCH','home-preferences',{base_version:prefVersion,pinned_metric_ids:[metricIds[0],metricIds[0]]})).statusCode,400);
      assert.equal((await req('PATCH','home-preferences',{base_version:prefVersion,pinned_task_ids:Array.from({length:6},()=>randomUUID())})).statusCode,422);
      assert.equal((await req('PATCH','home-preferences',{base_version:prefVersion,pinned_trends:[{metric_id:metricIds[0],range:'month',grain:'21d'}]})).statusCode,422);
      assert.equal((await req('PATCH','home-preferences',{base_version:prefVersion,pinned_metric_ids:[randomUUID()]})).statusCode,422);
      await ok('POST','records',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],record_type_id:DEFAULT_TEMPLATE_IDS[0],schema_version:1,occurred_at:new Date().toISOString(),timezone:'Asia/Shanghai',status:'confirmed',values:{topic:'synthetic'},task_ids:[]});
      home=await ok('GET','home');assert.equal(home.metrics[0].computed.value,'1');assert.equal(home.metrics[0].computed.source_record_ids.length,1);
      const before=(await ok('GET','bootstrap'));const p=await ok('PATCH','profile',{base_version:profileVersion,bio:'资料只改配置'});profileVersion=p.version;
      const after=await ok('GET','bootstrap');assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(after.records,before.records);assert.deepEqual(after.achievement_awards,before.achievement_awards);
    });
    await t.test('foreign pins cannot be used and failure leaves preferences unchanged',async()=>{
      const other=randomUUID(),token2='e'.repeat(64);
      await pool.query("INSERT INTO users(id,name) VALUES($1,'foreign pins')",[other]);
      await pool.query('INSERT INTO user_sync_clock(user_id) VALUES($1)',[other]);
      await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token2).digest('hex'),other]);
      const foreign=async(path:string,payload:any)=>{const r=await app.inject({method:'POST',url:'/api/v1/'+path,headers:{cookie:'life_session='+token2,origin:'http://localhost:18380','idempotency-key':randomUUID()},payload});assert.equal(r.statusCode,200,r.body);return r.json().data;};
      const m=await foreign('modules',{id:randomUUID(),name:'foreign',icon:'book',color:'blue'});
      const rt=await foreign('record-types',{id:randomUUID(),module_id:m.id,name:'foreign',fields:[{key:'session',label:'session',type:'text',required:false}]});
      const metric=await foreign('metrics',{id:randomUUID(),module_id:m.id,record_type_id:rt.id,name:'foreign',unit:'次',aggregation:'count',field_key:null,window:'all_time',timezone:'Asia/Shanghai'});
      const task=await foreign('tasks',{id:randomUUID(),module_id:m.id,title:'foreign',completion_mode:'manual',record_type_id:null,acceptance:null,timezone:'Asia/Shanghai'});
      const before=await ok('GET','home-preferences');
      for(const body of [{pinned_metric_ids:[metric.id]},{pinned_task_ids:[task.id]}])assert.equal((await req('PATCH','home-preferences',{base_version:prefVersion,...body})).statusCode,422);
      assert.deepEqual(await ok('GET','home-preferences'),before);
      assert.ok(!(await ok('GET','home')).metrics.some((x:any)=>x.id===metric.id));
    });
    await t.test('custom profile fields support all types and explicit removal',async()=>{
      const module=await ok('POST','modules',{id:randomUUID(),name:'自定义资料',icon:'book',color:'blue'});
      const values=[['decimal','0.00'],['integer',0],['boolean',false],['date','2024-02-29'],['single_select','选项'],['textarea',''],['text',null]];
      const fields=values.map(([type,value],i)=>({...field,id:randomUUID(),module_id:module.id,key:'field_'+i,type,value,options:type==='single_select'?['选项']:[]}));
      const payload={base_version:profileVersion,field_upserts:fields};let p=await ok('PATCH','profile',payload);profileVersion=p.version;
      for(const f of fields)assert.equal(p.module_fields.find((x:any)=>x.id===f.id).value,f.value);
      p=await ok('PATCH','profile',{base_version:profileVersion,field_remove_ids:[fields[0].id]});profileVersion=p.version;assert.ok(!p.module_fields.some((x:any)=>x.id===fields[0].id));
      // Retain the primary field for the export/restore test below.
      p=await ok('PATCH','profile',{base_version:profileVersion,field_remove_ids:fields.slice(1).map(x=>x.id)});profileVersion=p.version;
    });
    await t.test('recent achievements keep valid sources and exclude review states',async()=>{
      const a=await ok('POST','achievements',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],metric_id:metricIds[0],name:'真实来源授予',operator:'gte',threshold:'1'});
      let home=await ok('GET','home');assert.equal(home.recent_achievements.length,1);assert.equal(home.recent_achievements[0].achievement_id,a.id);assert.equal(home.recent_achievements[0].definition.metric_id,metricIds[0]);assert.equal(home.recent_achievements[0].evidence.source_record_ids.length,1);
      const record=(await ok('GET','bootstrap')).records[0];await ok('DELETE',`records/${record.id}`,{base_version:record.version});
      home=await ok('GET','home');assert.deepEqual(home.recent_achievements,[]);assert.equal(home.metrics[0].computed.value,null);
    });
    await t.test('archived sources are omitted with warnings, edits rejected',async()=>{
      await ok('PATCH',`modules/${DEFAULT_MODULE_IDS[0]}`,{base_version:1,status:'archived'});
      const home=await ok('GET','home');assert.deepEqual(home.metrics,[]);assert.deepEqual(home.tasks,[]);assert.equal(home.warnings.length,4);assert.deepEqual(home.preferences.pinned_metric_ids,[...metricIds].reverse());
      assert.equal((await req('PATCH','profile',{base_version:profileVersion,field_upserts:[{...field,value:'blocked'}]})).statusCode,409);
      assert.equal((await req('PATCH','home-preferences',{base_version:prefVersion,pinned_metric_ids:metricIds})).statusCode,422);
    });
    await t.test('profile preferences revisions and receipts survive empty database restore',async()=>{
      const before=await exportUserData(pool,LOCAL_USER_ID);assert.equal(before.counts.profile_fields,1);assert.ok(before.counts.configuration_revisions>=4);
      const p=await ok('GET','profile'),pref=await ok('GET','home-preferences');
      (guardSynthetic(),await pool.query('TRUNCATE users CASCADE'));await restoreUserData(pool,before);await login();
      assert.deepEqual(await ok('GET','profile'),p);assert.deepEqual(await ok('GET','home-preferences'),pref);
      const after=await exportUserData(pool,LOCAL_USER_ID);assert.deepEqual(after.data,before.data);assert.deepEqual(after.migrations,before.migrations);
      const replay=await req('PATCH','profile',profilePayload,profileOperation);assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().data.version,2);assert.deepEqual(await ok('GET','profile'),p);
    });
  } finally {await app.close();await pool.end();}
});
