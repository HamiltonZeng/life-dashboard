// Synthetic measurements, never a production load generator.
import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture,LOCAL_USER_ID,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from '../v02-phase2/support.js';
const results:any[]=[];
for(const size of [100,1000,10000])for(const instances of [101,365]){
 const f=await fixture();try{
 const t=await f.template();
 await f.pool.query(`INSERT INTO records(id,user_id,module_id,record_type_id,schema_version,occurred_at,timezone,status,values)
 SELECT gen_random_uuid(),$1,$2,$3,1,'2026-10-20T00:00:00Z'::timestamptz-(n%365)*interval '1 day','Asia/Shanghai','confirmed',jsonb_build_object('topic','synthetic benchmark','duration_minutes',n%60) FROM generate_series(1,$4::int) n`,[LOCAL_USER_ID,DEFAULT_MODULE_IDS[0],DEFAULT_TEMPLATE_IDS[0],size]);
 const ids=(await f.pool.query(`INSERT INTO tasks(id,user_id,module_id,template_id,definition,created_at)
 SELECT gen_random_uuid(),user_id,module_id,template_id,definition,created_at-n*interval '1 day' FROM tasks CROSS JOIN generate_series(1,$2::int) n WHERE id=$1 RETURNING id`,[t.instance.id,instances-1])).rows;
 for(let i=0;i<ids.length;i++)await f.pool.query(`INSERT INTO task_instance_details(user_id,task_id,template_id,template_version,category,period_key,period_start,period_end,snapshot,reward_policy_version,reward_candidate,quota_period,reward_deadline)
 SELECT user_id,$2,template_id,template_version,category,$3,period_start-$4*interval '1 day',period_end-$4*interval '1 day',snapshot,reward_policy_version,reward_candidate,quota_period,reward_deadline FROM task_instance_details WHERE task_id=$1`,[t.instance.id,ids[i].id,'bench-'+i,i+1]);
 const metric=await f.ok('POST','metrics',{id:crypto.randomUUID(),module_id:DEFAULT_MODULE_IDS[0],record_type_id:DEFAULT_TEMPLATE_IDS[0],name:'synthetic benchmark',unit:'分钟',aggregation:'sum',field_key:'duration_minutes',window:'all_time',timezone:'Asia/Shanghai'});
 // Instrument the actual clients used by API handlers. Count all SQL, including BEGIN/COMMIT.
 let count=0,active=false;f.pool.on('acquire',(client)=>{const c:any=client;if(!c.phase3Instrumented){const query=c.query.bind(c);c.query=(...args:any[])=>{if(active)count++;return query(...args);};c.phase3Instrumented=true;}});
 for(const path of ['task-templates','task-instances?limit=50&offset=0','home',`metrics/${metric.id}/trend?range=year&grain=1mo`,'POST records']){
  const times:number[]=[],counts:number[]=[];for(let n=0;n<3;n++){count=0;active=true;const start=performance.now();const r=path==='POST records'?await f.req('POST','records',{id:crypto.randomUUID(),module_id:DEFAULT_MODULE_IDS[0],record_type_id:DEFAULT_TEMPLATE_IDS[0],schema_version:1,occurred_at:'2026-10-20T09:00:00Z',timezone:'Asia/Shanghai',status:'confirmed',values:{topic:'synthetic write benchmark',duration_minutes:10},task_ids:[]}):await f.req('GET',path);times.push(performance.now()-start);active=false;assert.equal(r.statusCode,200,r.body);counts.push(count);}
  results.push({records:size,instances,path,samples_ms:times.map(n=>+n.toFixed(2)),sql_queries:counts});
 }
 }finally{await f.close();}
}
mkdirSync('.runtime/test-artifacts/v02-phase3',{recursive:true});writeFileSync('.runtime/test-artifacts/v02-phase3/benchmark.json',JSON.stringify({environment:{node:process.version,platform:process.platform,arch:process.arch},results},null,2));console.log(JSON.stringify(results));
