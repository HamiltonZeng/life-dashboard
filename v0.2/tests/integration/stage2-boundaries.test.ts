import {guardSynthetic} from '../v02-phase3/guard.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {buildApp} from '../../apps/api/src/app.js';
import {createPool} from '../../packages/db/src/client.js';
import {seed,LOCAL_USER_ID,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from '../../packages/db/src/seed.js';
import {AiService} from '../../packages/ai/src/service.js';
import {loadAiConfig} from '../../packages/ai/src/config.js';
import {stubAdapter,AiProviderError} from '../../packages/ai/src/adapter.js';
import {ALL_CONTENT,exampleBlueprint,extendBlueprint} from '../ai/fixtures.js';

test('S0-A regression: R1–R4 and total model deadline',async t=>{
  assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.DATABASE_HOST,'postgres-test');assert.equal(process.env.DATABASE_NAME,'life_dashboard_test');
  const pool=createPool();(guardSynthetic(),await pool.query('TRUNCATE users CASCADE'));await seed(pool);
  const token='b'.repeat(64),cookie='life_session='+token,origin='http://localhost:18080';
  await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),LOCAL_USER_ID]);
  const app=await buildApp(pool,{aiAdapter:stubAdapter([JSON.stringify(exampleBlueprint)])});
  const request=(method:string,path:string,payload?:any,key:string=randomUUID())=>app.inject({method:method as any,url:'/api/v1/'+path,headers:{origin,cookie,'idempotency-key':key},payload});
  const ok=async(method:string,path:string,payload?:any,key?:string)=>{const r=await request(method,path,payload,key);assert.equal(r.statusCode,200,r.body);return r.json().data;};
  const body={mode:'create' as const,module_id:null,prompt:'隔离测试夹具',content_types:ALL_CONTENT,apply_mode:'preview' as const,timezone:'Asia/Shanghai',reference:{record_type_ids:[],metric_ids:[]}};
  try {
    await t.test('R1: filtered batch pages handle empty matches and consistent totals',async()=>{
      const first=await request('GET',`ai/batches?module_id=${DEFAULT_MODULE_IDS[0]}`);assert.equal(first.statusCode,200,first.body);assert.equal(first.json().page.total,0);
      for(let i=0;i<2;i++) await ok('POST','ai/generations',{...body,apply_mode:'apply'});
      const all=(await request('GET','ai/batches?limit=1')).json();assert.equal(all.data.length,1);assert.equal(all.page.total,2);
      const module=all.data[0].module_id;
      const filtered=await request('GET',`ai/batches?module_id=${module}&limit=1&offset=1`);assert.equal(filtered.statusCode,200,filtered.body);assert.equal(filtered.json().data.length,0);assert.equal(filtered.json().page.total,1);
      const page=(await request('GET',`ai/batches?module_id=${module}&limit=1`)).json();assert.equal(page.data[0].module_id,module);assert.equal(page.page.total,1);
    });
    await t.test('R2: concurrent generation reservations cannot exceed one remaining slot',async()=>{
      const user=randomUUID();await pool.query("INSERT INTO users(id,name) VALUES($1,'isolated quota fixture')",[user]);await pool.query('INSERT INTO user_sync_clock(user_id) VALUES($1)',[user]);
      // Force the old pool-level count/check race. The fixed transaction must use its checked-out client.
      const original=pool.query.bind(pool);let counts=0;let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});
      const guarded=new Proxy(pool,{get(target,key){if(key==='query')return async(text:any,values:any)=>{const r=await original(text,values);if(typeof text==='string'&&text.includes('SELECT count(*)::int AS n FROM ai_generation_jobs WHERE user_id=$1 AND created_at')){if(++counts===2)release();await barrier;}return r;};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
      const adapter=stubAdapter([JSON.stringify(exampleBlueprint)]);
      const service=new AiService(guarded,{...loadAiConfig(),dailyJobLimit:1},adapter);
      const results=await Promise.allSettled([service.createGeneration(user,body,randomUUID()),service.createGeneration(user,body,randomUUID())]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(rejected.reason.code,'AI_BUDGET_EXCEEDED');
      assert.equal(adapter.calls,1);assert.equal((await pool.query('SELECT count(*)::int n FROM ai_generation_jobs WHERE user_id=$1',[user])).rows[0].n,1);
    });
    await t.test('R2: same-key replay remains available at the quota limit',async()=>{
      const user=randomUUID();await pool.query("INSERT INTO users(id,name) VALUES($1,'isolated replay fixture')",[user]);await pool.query('INSERT INTO user_sync_clock(user_id) VALUES($1)',[user]);
      const adapter=stubAdapter([JSON.stringify(exampleBlueprint)]),s=new AiService(pool,{...loadAiConfig(),dailyJobLimit:1},adapter),key=randomUUID();
      const [a,b]=await Promise.all([s.createGeneration(user,body,key),s.createGeneration(user,body,key)]);assert.equal(a.job.id,b.job.id);assert.equal(adapter.calls,1);
      await assert.rejects(s.createGeneration(user,{...body,prompt:'changed'},key),{code:'IDEMPOTENCY_MISMATCH'});
    });
    await t.test('R2: invalid preflight rolls back its reservation; provider failures retain their slot',async()=>{
      const user=randomUUID();await pool.query("INSERT INTO users(id,name) VALUES($1,'isolated failure fixture')",[user]);await pool.query('INSERT INTO user_sync_clock(user_id) VALUES($1)',[user]);
      const adapter=stubAdapter([new AiProviderError('AI_AUTH','fixture',false)]),s=new AiService(pool,{...loadAiConfig(),dailyJobLimit:1},adapter);
      await assert.rejects(s.createGeneration(user,{...body,mode:'extend',module_id:randomUUID()},randomUUID()));
      assert.equal((await pool.query('SELECT count(*)::int n FROM ai_generation_jobs WHERE user_id=$1',[user])).rows[0].n,0);assert.equal(adapter.calls,0);
      await assert.rejects(s.createGeneration(user,body,randomUUID()),{code:'AI_AUTH'});
      await assert.rejects(s.createGeneration(user,body,randomUUID()),{code:'AI_BUDGET_EXCEEDED'});assert.equal(adapter.calls,1);
    });
    await t.test('R2: provider invocation holds no user write lock; many replays do not exhaust the pool',async()=>{
      const user=randomUUID();await pool.query("INSERT INTO users(id,name) VALUES($1,'isolated lock fixture')",[user]);await pool.query('INSERT INTO user_sync_clock(user_id) VALUES($1)',[user]);
      const underlying=stubAdapter([JSON.stringify(exampleBlueprint)]);
      const adapter={...underlying,async generate(input:any){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT seq FROM user_sync_clock WHERE user_id=$1 FOR UPDATE NOWAIT',[user]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}return underlying.generate(input);}};
      const s=new AiService(pool,{...loadAiConfig(),dailyJobLimit:1},adapter),key=randomUUID();
      await s.createGeneration(user,body,key);
      const rows=await Promise.all(Array.from({length:12},()=>s.createGeneration(user,body,key)));assert.equal(new Set(rows.map(x=>x.job.id)).size,1);assert.equal(underlying.calls,1);
    });
    await t.test('R3: revoked manual and record_optional tasks cannot be completed',async()=>{
      for(const mode of ['manual','record_optional'] as const) {
        const blueprint=structuredClone(exampleBlueprint);blueprint.module=extendBlueprint().module;blueprint.tasks[0].completion_mode=mode;
        if(mode==='manual')blueprint.tasks[0].record_binding=null;
        const extended=await buildApp(pool,{aiAdapter:stubAdapter([JSON.stringify(blueprint)])});
        try {
          const r=await extended.inject({method:'POST',url:'/api/v1/ai/generations',headers:{origin,cookie,'idempotency-key':randomUUID()},payload:{...body,mode:'extend',module_id:DEFAULT_MODULE_IDS[0],apply_mode:'apply',reference:{record_type_ids:[DEFAULT_TEMPLATE_IDS[0]],metric_ids:[]}}});
          assert.equal(r.statusCode,200,r.body);const batch=r.json().data.batch;
          const recordType=batch.objects.find((o:any)=>o.kind==='record_type').id;
          await ok('POST','records',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],record_type_id:recordType,schema_version:1,occurred_at:new Date().toISOString(),timezone:'Asia/Shanghai',status:'confirmed',values:{topic:'只在隔离测试库',duration_minutes:1},task_ids:[]});
          await ok('POST',`ai/batches/${batch.id}/revoke`,{});
          const taskId=batch.objects.find((o:any)=>o.kind==='task').id;
          const task=await ok('GET',`tasks/${taskId}`);assert.equal(task.status,'cancelled');
          const before=await pool.query('SELECT seq FROM user_sync_clock WHERE user_id=$1',[LOCAL_USER_ID]);
          const complete=await request('POST',`tasks/${taskId}/complete`,{base_version:task.version});assert.equal(complete.statusCode,409,complete.body);assert.equal(complete.json().error.code,'INVALID_TASK_TRANSITION');
          assert.equal((await ok('GET',`tasks/${taskId}`)).status,'cancelled');assert.deepEqual((await pool.query('SELECT seq FROM user_sync_clock WHERE user_id=$1',[LOCAL_USER_ID])).rows,before.rows);
        } finally {await extended.close();}
      }
    });
    await t.test('R3: repeated completion is a no-op and preserves evidence timestamps',async()=>{
      const task=await ok('POST','tasks',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],title:'测试手动任务',completion_mode:'manual',record_type_id:null,acceptance:null,timezone:'Asia/Shanghai',business_date:null});
      const first=await ok('POST',`tasks/${task.id}/complete`,{base_version:task.version});
      const same=await ok('POST',`tasks/${task.id}/complete`,{base_version:first.version});assert.equal(same.version,first.version);assert.equal(same.completed_at,first.completed_at);
      assert.equal((await request('POST',`tasks/${task.id}/complete`,{base_version:task.version})).statusCode,409);
    });
    await t.test('R4: archived metrics cannot become new achievement dependencies; rejection is atomic',async()=>{
      const metric=await ok('POST','metrics',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],record_type_id:DEFAULT_TEMPLATE_IDS[0],name:'已归档计数夹具',unit:'次',aggregation:'count',field_key:null,window:'all_time',timezone:'Asia/Shanghai'});
      await pool.query('UPDATE metric_definitions SET archived_at=now() WHERE id=$1',[metric.id]);
      const id=randomUUID(),key=randomUUID();
      const response=await request('POST','achievements',{id,module_id:DEFAULT_MODULE_IDS[0],metric_id:metric.id,name:'悬挂定义不允许',operator:'gte',threshold:'1'},key);
      assert.equal(response.statusCode,422,response.body);assert.equal(response.json().error.code,'INVALID_REFERENCE');
      assert.equal((await pool.query('SELECT 1 FROM achievement_definitions WHERE id=$1',[id])).rowCount,0);
      assert.equal((await pool.query('SELECT 1 FROM mutation_receipts WHERE operation_id=$1',[key])).rowCount,0);
      const badAi=await request('POST','ai/generations',{...body,mode:'extend',module_id:DEFAULT_MODULE_IDS[0],reference:{record_type_ids:[],metric_ids:[metric.id]}});assert.equal(badAi.statusCode,422,badAi.body);
    });
    await t.test('R5: retry backoff cannot exceed the model-run total deadline',async()=>{
      const config={...loadAiConfig(),maxAttempts:3,timeoutMs:1000,taskTimeoutMs:35};
      const adapter=stubAdapter([new AiProviderError('AI_UNAVAILABLE','fixture',true)]),s=new AiService(pool,config,adapter);
      await assert.rejects(s.createGeneration(LOCAL_USER_ID,body,randomUUID()),{code:'AI_TIMEOUT'});
      assert.equal(adapter.calls,1,'No retry after total deadline expires');
    });
    await t.test('R5: an unresponsive adapter cannot keep a job generating indefinitely',async()=>{
      const base=stubAdapter([JSON.stringify(exampleBlueprint)]),adapter={...base,generate:async()=>new Promise<never>(()=>{})};
      const s=new AiService(pool,{...loadAiConfig(),taskTimeoutMs:35,maxAttempts:1},adapter);
      await assert.rejects(s.createGeneration(LOCAL_USER_ID,body,randomUUID()),{code:'AI_TIMEOUT',status:504});
      const job=(await pool.query('SELECT status,error_code FROM ai_generation_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[LOCAL_USER_ID])).rows[0];assert.equal(job.status,'failed');assert.equal(job.error_code,'AI_TIMEOUT');
    });
    await t.test('S0: retries accumulate reported usage instead of resetting prior usage',async()=>{
      const adapter=stubAdapter(['not-json',JSON.stringify(exampleBlueprint)]),s=new AiService(pool,loadAiConfig(),adapter);
      let id='';try{await s.createGeneration(LOCAL_USER_ID,body,randomUUID());assert.fail('expected invalid output');}catch(e:any){assert.equal(e.code,'BLUEPRINT_INVALID');id=e.details.job_id;}
      const retried=await s.retryGeneration(LOCAL_USER_ID,id);assert.equal(retried.job.attempts,2);assert.equal((retried.job.usage as any).total_tokens,60);
    });
  } finally {await app.close();await pool.end();}
});
