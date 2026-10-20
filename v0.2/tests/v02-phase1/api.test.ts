import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {fixture,graph,guard,profileField,report,LOCAL_USER_ID,DEFAULT_MODULE_IDS} from './support.js';
import {exportUserData,restoreUserData,backupChecksum} from '../../packages/db/src/backup.js';

test('DeepSeek phase-one independent API specification',async t=>{
  guard();const results:Record<string,unknown>={};
  const scenario=async(id:string,run:(f:Awaited<ReturnType<typeof fixture>>)=>Promise<void>)=>{
    await t.test(id,async()=>{const f=await fixture();try{await run(f);results[id]={status:'PASS'};}catch(e){results[id]={status:'FAIL',message:(e as Error).message};throw e;}finally{await f.close();report('api',results);}});
  };
  await scenario('D01 auth origin and capability boundary',async f=>{
    for(const path of ['profile','home-preferences','home'])assert.equal((await f.request('GET',path,undefined,undefined,{cookie:''})).statusCode,401);
    assert.equal((await f.request('PATCH','profile',{base_version:1,nickname:'x'},undefined,{origin:'http://evil.invalid'})).statusCode,403);
    assert.equal((await f.request('PATCH','profile',{base_version:1,nickname:'x'},undefined,{'idempotency-key':''})).statusCode,400);
    const caps=await f.ok('GET','capabilities');for(const k of ['home','home_preferences','profile_fields'])assert.equal(caps[k],true);
    for(const k of ['ai_chat','ai_recording','ai_profile_update','ai_reward_pricing','avatar_renderer','avatar_redemption'])assert.equal(caps[k],false);
    assert.equal(caps.recurring_tasks,true);
    for(const path of ['ai/chat','ai/recording','ai/profile-update','ai/reward-pricing','avatar/render','avatar/redeem','wallet']){const r=await f.request('POST',path,{balance:999});assert.equal(r.statusCode,409);assert.equal(r.json().error.code,'FEATURE_DISABLED');}
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM ai_generation_jobs')).rows[0].n,0);
  });
  await scenario('D02 empty home and read-only defaults',async f=>{
    const before=await exportUserData(f.pool,LOCAL_USER_ID);const h=await f.ok('GET','home');
    assert.equal(h.profile.id,LOCAL_USER_ID);assert.equal(h.profile.nickname,'本地用户');assert.equal(h.profile.version,1);assert.equal(h.profile.bio,null);assert.equal(h.profile.static_avatar_ref,null);assert.deepEqual(h.profile.module_fields,[]);
    assert.equal(h.preferences.version,1);assert.equal(h.preferences.minimal_mode,false);assert.deepEqual(h.preferences.pinned_trends,[]);
    for(const key of ['metrics','tasks','recent_achievements'])assert.deepEqual(h[key],[]);
    assert.equal(h.wallet.balance,'0');assert.equal(h.wallet.policy_version,'reward-policy-v1');assert.deepEqual(h.avatar,{enabled:false,model_asset_ref:null});
    await f.ok('GET','profile');await f.ok('GET','home-preferences');assert.deepEqual((await exportUserData(f.pool,LOCAL_USER_ID)).data,before.data);
  });
  await scenario('D03 concurrent replays payload mismatch and version race',async f=>{
    const key=randomUUID(),payload={base_version:1,nickname:'并发资料',field_upserts:[profileField()]};
    const rs=await Promise.all(Array.from({length:8},()=>f.request('PATCH','profile',payload,key)));
    for(const r of rs){assert.equal(r.statusCode,200,r.body);assert.deepEqual(r.json(),rs[0].json());}
    assert.equal(rs[0].json().operation_id,key);assert.equal(rs[0].json().data.version,2);
    assert.equal((await f.request('PATCH','profile',{...payload,bio:'different'},key)).json().error.code,'IDEMPOTENCY_MISMATCH');
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM mutation_receipts')).rows[0].n,1);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM configuration_revisions')).rows[0].n,1);
    const races=await Promise.all(['a','b'].map(bio=>f.request('PATCH','profile',{base_version:2,bio})));
    assert.deepEqual(races.map(r=>r.statusCode).sort(),[200,409]);
    const conflict=races.find(r=>r.statusCode===409)!;assert.equal(conflict.json().error.code,'VERSION_CONFLICT');
    const p=await f.ok('GET','profile');assert.equal(p.version,3);assert.equal(p.module_fields[0].key,'session');
  });
  await scenario('D04 typed fields explicit removals and immutable derived data',async f=>{
    const custom=await f.ok('POST','modules',{id:randomUUID(),name:'独立自定义模块',icon:'star',color:'cyan'});
    const fields=[['text',''],['textarea','简介'],['integer',0],['decimal','0.000001'],['date','2024-02-29'],['boolean',false],['single_select','选项']].map(([type,value],i)=>profileField(custom.id,{key:'key_'+i,type,value,options:type==='single_select'?['选项']:[]}));
    let p=await f.ok('PATCH','profile',{base_version:1,nickname:'昵称',bio:'x',timezone:'UTC',field_upserts:fields});
    assert.equal(p.module_fields.length,7);for(const field of fields)assert.equal(p.module_fields.find((x:any)=>x.id===field.id).value,field.value);
    p=await f.ok('PATCH','profile',{base_version:p.version,bio:null,field_remove_ids:[fields[0].id]});assert.equal(p.bio,null);assert.equal(p.nickname,'昵称');assert.equal(p.module_fields.length,6);
    const before=(await exportUserData(f.pool,LOCAL_USER_ID)).data;
    for(const body of [
      {field_upserts:[profileField(custom.id,{kind:'observation'})]},
      {field_upserts:[profileField(custom.id,{kind:'derived'})]},
      {field_upserts:[profileField(custom.id,{type:'decimal',value:1})]},
      {field_upserts:[profileField(custom.id,{type:'date',value:'2026-02-30'})]},
      {field_upserts:[profileField(custom.id,{type:'boolean',value:''})]},
      {field_upserts:[profileField(custom.id,{type:'single_select',value:'b',options:['a']})]},
      {nickname:null},{timezone:'bad/zone'},{wallet:100},{static_avatar_ref:'model.glb'},
      {field_upserts:[fields[1],{...fields[1],id:randomUUID()}]},
      {field_remove_ids:[fields[1].id],field_upserts:[fields[1]]}
    ]){const r=await f.request('PATCH','profile',{base_version:p.version,...body});assert.ok([400,422].includes(r.statusCode),r.body);}
    assert.deepEqual((await exportUserData(f.pool,LOCAL_USER_ID)).data,before);
  });
  await scenario('D05 foreign references and archived module changes are rejected',async f=>{
    const other=randomUUID(),module=randomUUID(),fieldId=randomUUID(),token='f'.repeat(64);
    await f.pool.query("INSERT INTO users(id,name) VALUES($1,'foreign')",[other]);await f.pool.query('INSERT INTO user_sync_clock(user_id) VALUES($1)',[other]);
    await f.pool.query("INSERT INTO modules(id,user_id,name,icon,color) VALUES($1,$2,'foreign','book','blue')",[module,other]);
    await f.pool.query('INSERT INTO user_profiles(user_id) VALUES($1)',[other]);await f.pool.query("INSERT INTO profile_fields(id,user_id,module_id,key,label,type,value) VALUES($1,$2,$3,'session','foreign','text','null')",[fieldId,other,module]);
    await f.pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),other]);
    const foreign=async(path:string,body:any)=>{const r=await f.request('POST',path,body,undefined,{cookie:'life_session='+token});assert.equal(r.statusCode,200,r.body);return r.json().data;};
    const rt=await foreign('record-types',{id:randomUUID(),module_id:module,name:'foreign',fields:[{key:'topic',label:'topic',type:'text',required:false}]});
    const m=await foreign('metrics',{id:randomUUID(),module_id:module,record_type_id:rt.id,name:'foreign',unit:'次',aggregation:'count',field_key:null,window:'all_time',timezone:'UTC'});
    const task=await foreign('tasks',{id:randomUUID(),module_id:module,title:'foreign',completion_mode:'manual',record_type_id:null,acceptance:null,timezone:'UTC'});
    for(const body of [{field_upserts:[profileField(module)]},{field_upserts:[profileField(undefined,{id:fieldId})]},{field_remove_ids:[fieldId]}])assert.ok([404,422].includes((await f.request('PATCH','profile',{base_version:1,...body})).statusCode));
    for(const body of [{pinned_metric_ids:[m.id]},{pinned_task_ids:[task.id]}])assert.equal((await f.request('PATCH','home-preferences',{base_version:1,...body})).statusCode,422);
    const field=profileField();await f.ok('PATCH','profile',{base_version:1,field_upserts:[field]});await f.ok('PATCH',`modules/${DEFAULT_MODULE_IDS[0]}`,{base_version:1,status:'archived'});
    for(const body of [{field_upserts:[field]},{field_remove_ids:[field.id]}])assert.equal((await f.request('PATCH','profile',{base_version:2,...body})).statusCode,409);
    assert.equal((await f.ok('GET','profile')).module_fields.length,1);
  });
  await scenario('D06 pin order limits replay minimal mode and invalidated references',async f=>{
    const g=await graph(f),metric=await f.ok('POST','metrics',{...g.metric.definition,id:randomUUID(),name:'second'});
    const payload={base_version:1,pinned_metric_ids:[metric.id,g.metric.id],pinned_task_ids:[g.task.id]},key=randomUUID();
    const saved=await f.request('PATCH','home-preferences',payload,key);assert.equal(saved.statusCode,200,saved.body);assert.deepEqual((await f.request('PATCH','home-preferences',payload,key)).json(),saved.json());
    assert.equal((await f.request('PATCH','home-preferences',{...payload,minimal_mode:true},key)).statusCode,409);
    let h=await f.ok('GET','home');assert.deepEqual(h.metrics.map((x:any)=>x.id),[metric.id,g.metric.id]);assert.deepEqual(h.tasks.map((x:any)=>x.id),[g.task.id]);
    let p=await f.ok('PATCH','home-preferences',{base_version:2,minimal_mode:true});p=await f.ok('PATCH','home-preferences',{base_version:p.version,minimal_mode:false});assert.deepEqual(p.pinned_metric_ids,payload.pinned_metric_ids);assert.deepEqual(p.pinned_task_ids,payload.pinned_task_ids);
    assert.equal((await f.request('PATCH','home-preferences',{base_version:1,minimal_mode:true})).statusCode,409);
    for(const body of [{pinned_metric_ids:Array.from({length:5},()=>randomUUID())},{pinned_task_ids:Array.from({length:6},()=>randomUUID())}])assert.equal((await f.request('PATCH','home-preferences',{base_version:p.version,...body})).statusCode,422);
    assert.equal((await f.request('PATCH','home-preferences',{base_version:p.version,pinned_task_ids:[g.task.id,g.task.id]})).statusCode,400);
    const cleared=await f.ok('PATCH','home-preferences',{base_version:p.version,pinned_trends:[]});assert.deepEqual(cleared.pinned_trends,[]);
    await f.ok('PATCH',`modules/${g.module_id}`,{base_version:1,status:'archived'});h=await f.ok('GET','home');assert.deepEqual(h.metrics,[]);assert.deepEqual(h.tasks,[]);assert.equal(h.warnings.length,3);assert.deepEqual(h.preferences.pinned_task_ids,[g.task.id]);
  });
  await scenario('D07 facts sources revisions and no profile side effects',async f=>{
    const g=await graph(f);const h=await f.ok('GET','home');assert.equal(h.metrics[0].computed.value,'1');assert.deepEqual(h.metrics[0].computed.source_record_ids,[g.record.id]);assert.equal(h.recent_achievements[0].achievement_id,g.achievement.id);assert.equal(h.recent_achievements[0].state,'unlocked');
    const before=await f.ok('GET','bootstrap');await f.ok('PATCH','profile',{base_version:1,timezone:'Pacific/Kiritimati',field_upserts:[profileField()]});
    const after=await f.ok('GET','bootstrap');for(const key of ['records','tasks','achievement_awards'])assert.deepEqual(after[key],before[key]);assert.equal(after.metrics[0].definition.timezone,'Asia/Shanghai');
    await f.ok('DELETE',`records/${g.record.id}`,{base_version:g.record.version});const review=await f.ok('GET','home');assert.equal(review.metrics[0].computed.value,null);assert.deepEqual(review.recent_achievements,[]);
    const awards=(await f.ok('GET','bootstrap')).achievement_awards;assert.equal(awards[0].state,'needs_review');
  });
  await scenario('D08 backup restore preserves old facts tombstones awards configs revisions and receipts',async f=>{
    const g=await graph(f),key=randomUUID(),payload={base_version:1,nickname:'备份资料',field_upserts:[profileField()]};
    const original=await f.request('PATCH','profile',payload,key);assert.equal(original.statusCode,200,original.body);
    await f.ok('PATCH','profile',{base_version:2,bio:'新资料'});await f.ok('PATCH','home-preferences',{base_version:1,minimal_mode:true,pinned_metric_ids:[g.metric.id],pinned_task_ids:[g.task.id]});
    await f.ok('DELETE',`records/${g.record.id}`,{base_version:1});const backup=await exportUserData(f.pool,LOCAL_USER_ID);
    assert.equal(backup.counts.profile_fields,1);assert.equal(backup.counts.user_profiles,1);assert.equal(backup.counts.home_preferences,1);assert.equal(backup.counts.configuration_revisions,3);assert.equal(backup.counts.record_revisions,1);assert.equal(backup.counts.achievement_awards,1);assert.ok(backup.data.records[0].deleted_at);
    assert.ok(!('sessions' in backup.data));assert.ok(!('ai_generation_jobs' in backup.data));
    await f.pool.query('TRUNCATE users CASCADE');await restoreUserData(f.pool,backup);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM sessions')).rows[0].n,0);
    assert.deepEqual((await exportUserData(f.pool,LOCAL_USER_ID)).data,backup.data);
    const l=await f.app.inject({method:'POST',url:'/api/v1/session',headers:{origin:'http://gateway-test'},payload:{login_secret:process.env.LOCAL_LOGIN_SECRET}});assert.equal(l.statusCode,200,l.body);const cookie=String(l.headers['set-cookie']).split(';')[0];
    const replay=await f.request('PATCH','profile',payload,key,{cookie});assert.deepEqual(replay.json(),original.json());
    assert.deepEqual((await exportUserData(f.pool,LOCAL_USER_ID)).data,backup.data);
    await assert.rejects(restoreUserData(f.pool,backup),{code:'NON_EMPTY_TARGET'});
    const tampered=structuredClone(backup);tampered.data.user_profiles[0].bio='篡改';await assert.rejects(restoreUserData(f.pool,tampered),{code:'CHECKSUM_MISMATCH'});
    const wrong=structuredClone(backup);wrong.migrations=wrong.migrations.slice(0,2);const {checksum:_,...base}=wrong;wrong.checksum=backupChecksum(base);await assert.rejects(restoreUserData(f.pool,wrong),{code:'MIGRATION_MISMATCH'});
    const broken=structuredClone(backup);broken.data.profile_fields[0].module_id=randomUUID();const {checksum:__,...base2}=broken;broken.checksum=backupChecksum(base2);await f.pool.query('TRUNCATE users CASCADE');await assert.rejects(restoreUserData(f.pool,broken));assert.equal((await f.pool.query('SELECT count(*)::int n FROM users')).rows[0].n,0);
  });
});
