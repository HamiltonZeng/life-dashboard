import {guardSynthetic} from '../v02-phase3/guard.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildApp} from '../../apps/api/src/app.js';
import {createPool} from '../../packages/db/src/client.js';
import {seed,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from '../../packages/db/src/seed.js';

test('PostgreSQL-backed T0/T1 acceptance',async t=>{
  assert.equal(process.env.NODE_ENV,'test');
  assert.equal(process.env.DATABASE_NAME,'life_dashboard_v03_test','Refuse to reset a non-test database');
  assert.equal(process.env.DATABASE_HOST,'postgres-test');
  const pool=createPool();
  (guardSynthetic(),await pool.query('TRUNCATE users CASCADE'));
  await seed(pool);await seed(pool);
  const app=await buildApp(pool);
  let cookie='';
  const origin='http://localhost:18380';
  const req=async(method:string,path:string,payload?:any,key=randomUUID())=>app.inject({method:method as any,url:'/api/v1/'+path,headers:{origin,cookie,'idempotency-key':key},payload});
  const get=async(path:string)=>(await req('GET',path)).json().data;
  const post=async(path:string,payload:any)=>{const r=await req('POST',path,payload);assert.equal(r.statusCode,200,r.body);return r.json().data;};
  try {
    await t.test('health, session auth and CSRF checks',async()=>{
      assert.equal((await app.inject('/health/ready')).statusCode,200);
      assert.equal((await req('GET','records')).statusCode,401);
      assert.equal((await app.inject({method:'POST',url:'/api/v1/session',payload:{login_secret:process.env.LOCAL_LOGIN_SECRET}})).statusCode,403);
      assert.equal((await req('POST','session',{login_secret:'wrong'})).statusCode,401);
      const r=await req('POST','session',{login_secret:process.env.LOCAL_LOGIN_SECRET});assert.equal(r.statusCode,200,r.body);
      cookie=String(r.headers['set-cookie']).split(';')[0];assert.match(String(r.headers['set-cookie']),/HttpOnly/);
    });
    await t.test('seed is idempotent and contains no fictional facts',async()=>{
      const b=await get('bootstrap');assert.equal(b.modules.length,4);assert.equal(b.record_types.length,4);
      for(const k of ['tasks','records','metrics','achievement_awards']) assert.equal(b[k].length,0);
    });
    const module_id=DEFAULT_MODULE_IDS[0],record_type_id=DEFAULT_TEMPLATE_IDS[0];
    const task={id:randomUUID(),module_id,title:'完成一次实践',completion_mode:'record_required',record_type_id,acceptance:{kind:'field_gte',field_key:'duration_minutes',threshold:'10'},business_date:null,timezone:'Asia/Shanghai'};
    const task2={...task,id:randomUUID(),completion_mode:'record_optional'};
    const metric={id:randomUUID(),module_id,record_type_id,name:'本周学习时长',unit:'分钟',aggregation:'sum',field_key:'duration_minutes',window:'week',timezone:'Asia/Shanghai'};
    const count={...metric,id:randomUUID(),name:'累计学习次数',unit:'次',aggregation:'count',field_key:null,window:'all_time'};
    const achievement={id:randomUUID(),module_id,metric_id:count.id,name:'迈出第一步',operator:'gte',threshold:'1',history_policy:'include_existing'};
    await t.test('configure task instances, metrics and achievement definitions',async()=>{
      await post('tasks',task);await post('tasks',task2);await post('metrics',metric);await post('metrics',count);await post('achievements',achievement);
      assert.equal((await get('metrics')).find((x:any)=>x.id===count.id).computed.value,null);
      assert.equal((await req('POST',`tasks/${task.id}/complete`,{base_version:1})).statusCode,422);
      assert.equal((await req('POST','metrics',{...metric,id:randomUUID(),field_key:'topic'})).statusCode,422);
    });
    let record={id:randomUUID(),module_id,record_type_id,schema_version:1,occurred_at:new Date().toISOString(),timezone:'Asia/Shanghai',status:'confirmed',values:{topic:'实际练习',duration_minutes:5},task_ids:[task.id,task2.id]};
    await t.test('5 minutes persists, tasks remain partial, count achievement unlocks',async()=>{
      await post('records',record);
      assert.equal((await get(`tasks/${task.id}`)).status,'partial');
      assert.equal((await get('metrics')).find((x:any)=>x.id===count.id).computed.value,'1');
      const award=(await get('awards'))[0];assert.equal(award.state,'unlocked');assert.deepEqual(award.evidence.source_record_ids,[record.id]);
      assert.equal((await get('metrics')).find((x:any)=>x.id===metric.id).computed.value,'5');
    });
    await t.test('updating the evidence completes both tasks without duplicate statistics',async()=>{
      record={...record,values:{...record.values,duration_minutes:10}};
      const {id,...payload}=record;const r=await req('PUT',`records/${id}`,{...payload,base_version:1});assert.equal(r.statusCode,200,r.body);
      assert.equal((await get(`tasks/${task.id}`)).status,'completed');
      assert.equal((await get(`tasks/${task2.id}`)).status,'completed');
      assert.equal((await get('awards')).length,1);
      assert.equal((await get('metrics')).find((x:any)=>x.id===count.id).computed.value,'1');
    });
    await t.test('stale edits and reused operation IDs cannot overwrite facts',async()=>{
      const {id,...payload}=record;
      assert.equal((await req('PUT',`records/${id}`,{...payload,base_version:1})).statusCode,409);
      const key=randomUUID(),r={...record,id:randomUUID(),task_ids:[]};
      const first=await req('POST','records',r,key),second=await req('POST','records',r,key);
      assert.equal(first.statusCode,200,first.body);assert.deepEqual(second.json(),first.json());
      assert.equal((await req('POST','records',{...r,values:{topic:'different'}},key)).statusCode,409);
      await req('DELETE',`records/${r.id}`,{base_version:1});
    });
    await t.test('concurrent duplicate commands create one record and one receipt',async()=>{
      const key=randomUUID(),r={...record,id:randomUUID(),task_ids:[]};
      const responses=await Promise.all([req('POST','records',r,key),req('POST','records',r,key)]);
      assert.deepEqual(responses[0].json(),responses[1].json());assert.equal(responses[0].statusCode,200,responses[0].body);
      assert.equal((await pool.query('SELECT count(*) FROM mutation_receipts WHERE operation_id=$1',[key])).rows[0].count,'1');
      await req('DELETE',`records/${r.id}`,{base_version:1});
    });
    await t.test('deleting sole completion evidence triggers task and award review',async()=>{
      const r=await req('DELETE',`records/${record.id}`,{base_version:2});assert.equal(r.statusCode,200,r.body);
      for(const id of [task.id,task2.id]) {const task=await get(`tasks/${id}`);assert.equal(task.status,'pending');assert.equal(task.needs_review,true);}
      assert.equal((await get('awards'))[0].state,'needs_review');
      assert.equal((await get('metrics')).find((x:any)=>x.id===count.id).computed.value,null);
      assert.equal((await req('GET',`records/${record.id}`)).statusCode,404);
      assert.equal((await pool.query('SELECT count(*) FROM record_revisions WHERE record_id=$1',[record.id])).rows[0].count,'2');
    });
    await t.test('drafts do not contribute facts, old evidence cannot revive a deletion',async()=>{
      await post('records',{...record,id:randomUUID(),status:'draft',values:{},task_ids:[]});
      assert.equal((await get('awards'))[0].state,'needs_review');
      const {id,...payload}=record;assert.equal((await req('PUT',`records/${id}`,{...payload,base_version:3})).statusCode,409);
      assert.equal((await req('POST','records',{...record,id:randomUUID(),values:{topic:'未知',duration_minutes:null},task_ids:[]})).statusCode,200);
      assert.equal((await get('metrics')).find((x:any)=>x.id===metric.id).computed.value,null);
    });
    await t.test('wrong task date, module and unknown facts fail atomically',async()=>{
      const dated=await post('tasks',{...task,id:randomUUID(),business_date:'2000-01-01'});
      const before=(await get('records')).length;
      const bad={...record,id:randomUUID(),task_ids:[dated.id]};
      assert.equal((await req('POST','records',bad)).json().error.code,'TASK_DATE_MISMATCH');
      assert.equal((await req('POST','records',{...bad,task_ids:[],module_id:DEFAULT_MODULE_IDS[1]})).statusCode,422);
      assert.equal((await req('POST','records',{...bad,task_ids:[],completed:true})).statusCode,400);
      assert.equal((await get('records')).length,before);
    });
    await t.test('manual completion remains completed when unrelated facts change',async()=>{
      const r=await post('tasks',{...task,id:randomUUID(),completion_mode:'manual',record_type_id:null,acceptance:null});
      await post(`tasks/${r.id}/complete`,{base_version:1});
      await post('records',{...record,id:randomUUID(),task_ids:[]});
      assert.equal((await get(`tasks/${r.id}`)).status,'completed');
    });
    await t.test('custom modules share template and record capabilities; archive retains history',async()=>{
      const m=await post('modules',{id:randomUUID(),name:'语言学习',description:'',icon:'book',color:'blue'});
      const rt=await post('record-types',{id:randomUUID(),module_id:m.id,name:'练习',fields:[{key:'topic',label:'内容',type:'text',required:true}]});
      const r={...record,id:randomUUID(),module_id:m.id,record_type_id:rt.id,values:{topic:'实际内容'},task_ids:[]};await post('records',r);
      const ar=await req('PATCH',`modules/${m.id}`,{base_version:1,status:'archived',name:'改名'});assert.equal(ar.statusCode,200,ar.body);
      assert.equal((await req('POST','records',{...r,id:randomUUID()})).statusCode,409);
      assert.equal((await get(`records/${r.id}`)).module_id,m.id);
      assert.equal((await req('PATCH',`modules/${m.id}`,{base_version:1,name:'stale'})).statusCode,409);
    });
    await t.test('cross-user references cannot leak or mutate data',async()=>{
      const user=randomUUID(),module=randomUUID();
      await pool.query("INSERT INTO users(id,name) VALUES($1,'other')",[user]);
      await pool.query("INSERT INTO modules(id,user_id,name,icon,color) VALUES($1,$2,'private','book','blue')",[module,user]);
      assert.equal((await req('GET',`modules/${module}`)).statusCode,404);
      assert.equal((await req('POST','record-types',{id:randomUUID(),module_id:module,name:'bad',fields:[{key:'x',label:'x',type:'text',required:false}]})).statusCode,404);
    });
    await t.test('invalid pagination and missing idempotency key rejected',async()=>{
      assert.equal((await req('GET','records?limit=101')).statusCode,400);
      assert.equal((await app.inject({method:'POST',url:'/api/v1/records',headers:{origin,cookie},payload:record})).statusCode,400);
    });
    await t.test('logout revokes the session immediately',async()=>{
      assert.equal((await req('DELETE','session')).statusCode,200);
      assert.equal((await req('GET','records')).statusCode,401);
    });
  } finally {await app.close();await pool.end();}
});
