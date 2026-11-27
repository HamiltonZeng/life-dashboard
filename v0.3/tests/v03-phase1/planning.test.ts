import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {guardSynthetic} from '../v02-phase3/guard.js';
import {createPool} from '../../packages/db/src/client.js';
import {migrate} from '../../packages/db/src/migrate.js';
import {seed,LOCAL_USER_ID,DEFAULT_MODULE_IDS} from '../../packages/db/src/seed.js';
import {PlanningService} from '../../apps/api/src/ai/service.js';
import {buildApp} from '../../apps/api/src/app.js';
import {gatewayConfig} from '../../packages/ai/src/v03/gateway.js';
import {exportUserData,restoreUserData,backupChecksum} from '../../packages/db/src/backup.js';
import {StubGateway,message} from './fixtures.js';
const user=LOCAL_USER_ID;
async function fixture(gateway=new StubGateway(),extra:any={}){
 guardSynthetic();const pool=createPool();await migrate(pool);await pool.query('TRUNCATE users CASCADE');await seed(pool);
 const config={...gatewayConfig({}),rewardPricing:false,enabled:true,configured:true,apiKey:'synthetic-test-key',model:'synthetic-offline',maxInput:100000,dailyInput:1000000,...extra};
 const service=new PlanningService(pool,{gateway,config});
 const app=await buildApp(pool,{planning:service,profile:'mvp',origin:'http://localhost:18380'});
 const login=await app.inject({method:'POST',url:'/api/v1/session',headers:{origin:'http://localhost:18380'},payload:{login_secret:process.env.LOCAL_LOGIN_SECRET}});
 assert.equal(login.statusCode,200,login.body);const cookie=String(login.headers['set-cookie']).split(';')[0];
 const req=async(method:string,path:string,body?:any,key:string=randomUUID())=>app.inject({method:method as any,url:'/api/v1/'+path,headers:{cookie,origin:'http://localhost:18380','idempotency-key':key},payload:body});
 const ok=async(method:string,path:string,body?:any,key?:string)=>{const r=await req(method,path,body,key);assert.ok(r.statusCode<300,r.body);return r.json().data;};
 await ok('PATCH','ai/preferences',{base_version:1,automatic_mode:'clear_commands',readable_module_ids:[DEFAULT_MODULE_IDS[0]],auto_config_objects_limit:12,auto_record_count_limit:5});
 const conv=await ok('POST','ai/conversations',{entrypoint:'home',title:null});
 const send=async(body=message(),key?:string)=>ok('POST',`ai/conversations/${conv.id}/messages`,body,key);
 return {pool,service,gateway,app,req,ok,conv,send,close:async()=>{await app.close();await pool.end();}};
}
test('P1-A02/A07/A10/A12 atomic English plan, real receipts, manual facts and replay',async()=>{
 const f=await fixture();try{
  const body=message(),key=randomUUID(),a=await f.send(body,key);assert.equal(a.status,'queued');assert.deepEqual(await f.send(body,key),a);assert.deepEqual(await f.send(body),a);
  assert.equal((await f.req('POST',`ai/conversations/${f.conv.id}/messages`,{...body,text:'另一条内容'},key)).statusCode,409);
  await f.service.tick();let turn=await f.ok('GET','ai/runs/'+a.run_id);assert.equal(turn.status,'completed',JSON.stringify(turn));assert.ok(turn.application);assert.equal(turn.application.id_map.length,6);assert.equal(f.gateway.calls,1);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM records')).rows[0].n,0);assert.equal((await f.pool.query('SELECT count(*)::int n FROM wallet_ledger')).rows[0].n,0);
  const id=(kind:string)=>turn.application.id_map.find((m:any)=>m.entity_type===kind).id;
  const plan=await f.ok('GET','goals/'+id('goal'));assert.equal(plan.plans[0].objects.length,6);
  const type=id('record_type');await f.ok('POST','records',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],record_type_id:type,schema_version:1,occurred_at:new Date().toISOString(),timezone:'Asia/Shanghai',status:'confirmed',values:{duration_minutes:20},task_ids:[]});
  const bootstrap=await f.ok('GET','bootstrap');assert.equal(bootstrap.metrics.find((m:any)=>m.id===id('metric')).computed.value,'20');
  const instances=await f.ok('GET','task-instances');assert.equal(instances.find((t:any)=>t.category==='daily').status,'completed');const summary=await f.ok('GET','achievement-summary');assert.equal(summary.effective_awards_count,1);
  const wallet=await f.ok('GET','wallet');assert.equal(wallet.balance,'10');
  const events=await f.req('GET','ai/runs/'+a.run_id+'/events');assert.equal(events.statusCode,200);assert.match(events.body,/application.committed/);
  const restoredService=new PlanningService(f.pool,{gateway:f.gateway,config:f.service.config});assert.equal(await restoredService.tick(),false);assert.deepEqual((await restoredService.turn(user,a.run_id)).application,turn.application);
  assert.deepEqual((await f.ok('POST','ai/runs/'+a.run_id+'/cancel',{base_version:turn.version})).application,turn.application);
 }finally{await f.close();}
});
test('P1-A06/A11 preview binds hash/token, reuse and compensation undo preserve facts',async()=>{
 const f=await fixture();try{
  let prefs=await f.ok('GET','ai/preferences');await f.ok('PATCH','ai/preferences',{...(({user_id,version,...rest}:any)=>rest)(prefs),base_version:prefs.version,automatic_mode:'preview_all'});
  const a=await f.send();await f.service.tick();const turn=await f.ok('GET','ai/runs/'+a.run_id);assert.equal(turn.status,'awaiting_confirmation');assert.equal((await f.pool.query('SELECT count(*)::int n FROM goals')).rows[0].n,0);
  const p=await f.ok('POST',`ai/proposals/${turn.proposal.candidate_id}/preview`,{candidate_version:1});
  const input={candidate_version:1,content_hash:p.content_hash,confirmation_token:null};assert.equal((await f.req('POST',`ai/proposals/${p.candidate_id}/apply`,input)).statusCode,409);
  const receipt=await f.ok('POST',`ai/proposals/${p.candidate_id}/apply`,{...input,confirmation_token:p.confirmation_token});assert.deepEqual(await f.ok('POST',`ai/proposals/${p.candidate_id}/apply`,{...input,confirmation_token:p.confirmation_token}),receipt);
  const type=receipt.id_map.find((m:any)=>m.entity_type==='record_type').id;
  await f.ok('POST','records',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],record_type_id:type,schema_version:1,occurred_at:new Date().toISOString(),timezone:'Asia/Shanghai',status:'confirmed',values:{duration_minutes:20},task_ids:[]});
  const undo=await f.ok('POST',`ai/applications/${receipt.application_id}/undo-preview`,{base_version:1});assert.equal(undo.mode,'compensation');assert.ok(undo.dependencies.length);
  await f.ok('POST',`ai/applications/${receipt.application_id}/undo`,{preview_version:undo.preview_version,confirmation_token:undo.confirmation_token});
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM records')).rows[0].n,1);assert.equal((await f.pool.query('SELECT archived_at FROM record_types WHERE id=$1',[type])).rows[0].archived_at,null);
 }finally{await f.close();}
});
test('P1-A03 compatible templates and metrics are reused without renaming facts',async()=>{
 const f=await fixture();try{const a=await f.send();await f.service.tick();const first=await f.ok('GET','ai/runs/'+a.run_id);const b=await f.send();await f.service.tick();const second=await f.ok('GET','ai/runs/'+b.run_id);assert.equal(second.status,'completed',JSON.stringify(second));for(const kind of ['record_type','metric'])assert.equal(first.application.id_map.find((x:any)=>x.entity_type===kind).id,second.application.id_map.find((x:any)=>x.entity_type===kind).id);}finally{await f.close();}
});
test('P1-A04 clarification continues the same run with zero partial objects',async()=>{
 const stub=new StubGateway((p,c,n)=>n===1?{...p,intent:'clarify',actions:[],clarification:{question:'目标计划持续多少天？',choices:['30天'],blocking_fields:['target_date']}}:p),f=await fixture(stub);
 try{const a=await f.send(message('帮我安排英语学习'));await f.service.tick();let turn=await f.ok('GET','ai/runs/'+a.run_id);assert.equal(turn.status,'needs_clarification');assert.equal((await f.pool.query('SELECT count(*)::int n FROM goals')).rows[0].n,0);
  await f.ok('POST','ai/runs/'+a.run_id+'/clarifications',{run_version:turn.version,question_id:turn.clarification.question_id,answer_text:'30天，每天20分钟'});await f.service.tick();turn=await f.ok('GET','ai/runs/'+a.run_id);assert.equal(turn.status,'completed',JSON.stringify(turn));assert.equal(stub.calls,2);
 }finally{await f.close();}
});
test('P1-A05/A08 mixed unsupported actions, forged evidence, cycles, unit and mid-batch failures are atomic',async t=>{
 const cases:Record<string,(p:any)=>any>={reward:p=>{p.actions[4].data.reward_amount=999;return p;},evidence:p=>{p.actions[0].evidence_refs=['invented'];return p;},cycle:p=>{p.actions[0].depends_on=['english_daily'];return p;},unit:p=>{p.actions[2].data.unit='公里';return p;},lateFailure:p=>{p.actions[5].data.milestones[0].threshold='0';return p;},unsupported:p=>{p.actions[0]={action_type:'module.create',local_ref:'newmodule',depends_on:[],evidence_refs:p.actions[0].evidence_refs,data:{name:'x',description:'',icon:'book',color:'blue'}};return p;}};
 for(const [name,change]of Object.entries(cases))await t.test(name,async()=>{const f=await fixture(new StubGateway(change));try{const a=await f.send();await f.service.tick();const turn=await f.ok('GET','ai/runs/'+a.run_id);assert.equal(turn.status,'failed',JSON.stringify(turn));for(const table of ['goals','metric_definitions','achievement_series','tasks','records','wallet_ledger'])assert.equal((await f.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0,table);}finally{await f.close();}});
});
test('P1-A12 cancellation before commit cannot be overwritten by a late model response',async()=>{
 let release:any,started:any;const ready=new Promise<void>(r=>started=r),stub=new StubGateway();const generate=stub.generate.bind(stub);stub.generate=async(...args)=>{started();await new Promise(r=>release=r);return generate(...args);};const f=await fixture(stub);
 try{const a=await f.send(),work=f.service.tick();await ready;const turn=await f.ok('GET','ai/runs/'+a.run_id);await f.ok('POST','ai/runs/'+a.run_id+'/cancel',{base_version:turn.version});release();await work;assert.equal((await f.ok('GET','ai/runs/'+a.run_id)).status,'cancelled');assert.equal((await f.pool.query('SELECT count(*)::int n FROM goals')).rows[0].n,0);}finally{await f.close();}
});
test('P1-A13 unknown usage reserves quota and missing credentials remain explicit',async()=>{
 const stub=new StubGateway();(stub as any).generate=async(c:any)=>({value:(await new StubGateway().generate(c,new AbortController().signal)).value,model:'synthetic',usage:null});const f=await fixture(stub,{dailyJobs:1});
 try{const a=await f.send();await f.service.tick();assert.equal((await f.ok('GET','ai/runs/'+a.run_id)).status,'completed');const usage=await f.ok('GET','ai/usage');assert.equal(usage[0].unknown_attempts,1);assert.ok(usage[0].input_tokens_charged>0);const b=await f.send();await f.service.tick();assert.equal((await f.ok('GET','ai/runs/'+b.run_id)).error.code,'AI_BUDGET_EXCEEDED');}finally{await f.close();}
});
test('P1-A14 complete backup restores receipts and pauses pending paid jobs, including old v0.2 exports',async()=>{
 const f=await fixture();try{
  const a=await f.send();await f.service.tick();await f.send();const backup=await exportUserData(f.pool,user);assert.equal(backup.schema_version,3);assert.equal(backup.counts.goals,1);const applied=(await f.service.turn(user,a.run_id)).application;
  await f.pool.query('TRUNCATE users CASCADE');await restoreUserData(f.pool,backup);assert.deepEqual((await f.service.turn(user,a.run_id)).application,applied);assert.equal(await f.service.tick(),false);
  const queued=(await f.pool.query("SELECT detail FROM ai_runs WHERE status='failed'")).rows[0];assert.equal(queued.detail.error.code,'RESTORE_PAUSED');
  const old=structuredClone(backup);old.schema_version=1;old.migrations=old.migrations.slice(0,4);for(const key of Object.keys(old.data))if(key.startsWith('ai_')||['goals','goal_revisions','plan_versions','plan_objects'].includes(key)){delete old.data[key];delete old.counts[key];}for(const key of ['record_types','achievement_series'])for(const row of old.data[key])delete row.archived_at;const {checksum,...unsigned}=old;old.checksum=backupChecksum(unsigned);
  await f.pool.query('TRUNCATE users CASCADE');await restoreUserData(f.pool,old);assert.equal((await f.pool.query('SELECT count(*)::int n FROM goals')).rows[0].n,0);
 }finally{await f.close();}
});
test('P1-A15 route DTO mismatch and cross-user conversations do not leak',async()=>{
 const f=await fixture();try{const other=randomUUID();await f.pool.query('INSERT INTO users(id,name) VALUES($1,\'other\')',[other]);await f.pool.query('INSERT INTO ai_conversations(user_id,id,entrypoint) VALUES($1,$2,\'home\')',[other,randomUUID()]);assert.equal((await f.req('POST','ai/conversations',{base_version:1})).statusCode,400);const a=await f.send();await f.service.tick();await assert.rejects(f.service.turn(other,a.run_id));const s=await f.req('POST','ai/proposals/'+randomUUID()+'/apply',{candidate_version:1,content_hash:'0'.repeat(64),confirmation_token:null,sql:'evil'});assert.equal(s.statusCode,400);}finally{await f.close();}
});
test('P1-A06 source versions, expiry and object limits require a safe preview',async()=>{
 const f=await fixture();try{
  const body={...message(),execution:'preview'};const a=await f.send(body);await f.service.tick();let turn=await f.ok('GET','ai/runs/'+a.run_id);assert.equal(turn.status,'awaiting_confirmation');const pid=turn.proposal.candidate_id;
  await f.pool.query('UPDATE modules SET version=version+1 WHERE id=$1',[DEFAULT_MODULE_IDS[0]]);const conflict=await f.req('POST',`ai/proposals/${pid}/preview`,{candidate_version:1});assert.equal(conflict.statusCode,409);
  await f.pool.query('UPDATE modules SET version=version-1 WHERE id=$1',[DEFAULT_MODULE_IDS[0]]);await f.pool.query("UPDATE ai_proposals SET expires_at=now()-interval '1 minute' WHERE id=$1",[pid]);assert.equal((await f.req('POST',`ai/proposals/${pid}/preview`,{candidate_version:1})).statusCode,409);
  const pref=await f.service.preferences(user);await f.ok('PATCH','ai/preferences',{base_version:pref.version,automatic_mode:'clear_commands',readable_module_ids:pref.readable_module_ids,auto_config_objects_limit:2,auto_record_count_limit:5});const b=await f.send();await f.service.tick();turn=await f.ok('GET','ai/runs/'+b.run_id);assert.equal(turn.status,'awaiting_confirmation');assert.equal((await f.pool.query('SELECT count(*)::int n FROM goals')).rows[0].n,0);
 }finally{await f.close();}
});
test('P1-A12 expired lease resumes without repeating committed or checkpointed business',async()=>{
 const f=await fixture();try{const a=await f.send();await f.pool.query("UPDATE ai_runs SET status='running',lease_owner=$2,lease_until=now()-interval '1 second' WHERE id=$1",[a.run_id,randomUUID()]);await f.service.tick();assert.equal((await f.ok('GET','ai/runs/'+a.run_id)).status,'completed');assert.equal(await f.service.tick(),false);assert.equal(f.gateway.calls,1);
  const events=(await f.pool.query('SELECT event_id FROM ai_run_events WHERE run_id=$1 ORDER BY event_id',[a.run_id])).rows;const last=events.at(-2).event_id;const response=await f.app.inject({method:'GET',url:'/api/v1/ai/runs/'+a.run_id+'/events',headers:{cookie:String((await f.req('POST','session',{login_secret:process.env.LOCAL_LOGIN_SECRET})).headers['set-cookie']).split(';')[0],'last-event-id':last}});assert.equal(response.statusCode,200);assert.match(response.body,/application.committed/);
 }finally{await f.close();}
});
test('P1-A09 four categories, future start and expiry do not force a current instance',async()=>{
 const f=await fixture();try{const {DateTime}=await import('luxon'),today=DateTime.now().setZone('Asia/Shanghai'),from=today.plus({days:3}).toISODate(),until=today.plus({days:9}).toISODate();
  for(const category of ['main','daily','weekly','monthly']){const result=await f.ok('POST','task-templates',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],title:'future '+category,category,timezone:'Asia/Shanghai',completion_mode:'manual',rule:null,color:'blue',due_at:null,schedule:{active_from:from,active_until:until,weekdays:category==='daily'?[1,3,5]:null,preferred_local_time:null}});assert.equal(result.instance,null);}
  const result=await f.ok('POST','task-instances/materialize',{});assert.equal(result.instances.length,0);assert.ok(result.next_check_at);const futureCore=new (await import('../../apps/api/src/service.js')).Service(f.pool,()=>today.plus({days:4}).toJSDate());const result2:any=await futureCore.mutate(user,randomUUID(),'POST','task-instances/materialize',{});assert.ok(result2.data.instances.length>=3);const oldCount=(await f.pool.query('SELECT count(*)::int n FROM tasks')).rows[0].n;
  const expiredCore=new (await import('../../apps/api/src/service.js')).Service(f.pool,()=>today.plus({days:20}).toJSDate());const result3:any=await expiredCore.mutate(user,randomUUID(),'POST','task-instances/materialize',{});assert.equal((await f.pool.query('SELECT count(*)::int n FROM tasks')).rows[0].n,oldCount);
 }finally{await f.close();}
});

test('R1 static system prompt, INVALID_REFERENCE retry with sanitized hint, AI_BAD_REQUEST no-retry, and configView diagnostics',async()=>{
 const prompts:string[]=[];
 const seenInputs:any[]=[];
 const stub=new StubGateway((p,c,n)=>{
  prompts.push(c.instructions);
  seenInputs.push(structuredClone(c.input));
  if(n===1)return {...p,context_ref:randomUUID()};
  return p;
 });
 const f=await fixture(stub);
 try{
  const cfg=await f.ok('GET','ai/config');
  assert.equal(cfg.base_url,'https://api.deepseek.com');
  assert.equal(cfg.thinking,'enabled');
  assert.equal(cfg.reasoning_effort,'high');
  assert.equal(cfg.reward_pricing,false);
  assert.equal(cfg.limits.max_input_tokens,100000);
  assert.equal(cfg.limits.max_output_tokens,12000);

  const a=await f.send();await f.service.tick();
  const turnA=await f.ok('GET','ai/runs/'+a.run_id);
  assert.equal(turnA.status,'completed',JSON.stringify(turnA));
  assert.equal(stub.calls,2);
  assert.equal(prompts[0],prompts[1]);
  assert.ok(prompts[0].includes('00000000-0000-0000-0000-000000000000'));
  assert.ok(!prompts[0].includes(seenInputs[0].id));
  assert.equal(seenInputs[1].answers.length,1);
  assert.match(seenInputs[1].answers[0],/INVALID_REFERENCE/);

  const b=await f.send();await f.service.tick();
  assert.equal(prompts[2],prompts[0]);
  assert.notEqual(seenInputs[2].id,seenInputs[0].id);

  const {DomainError}=await import('../../packages/domain/src/index.js');
  const leakInputs:any[]=[];let leakCalls=0;
  const leakGateway={generate:async(c:any)=>{leakCalls++;leakInputs.push(structuredClone(c.input));if(leakCalls===1)throw new DomainError('AI_INVALID_OUTPUT','bad Bearer secret_tok_123 sk-abc123456789 '+('x'.repeat(350)),422);return new StubGateway().generate(c,new AbortController().signal);}};
  const leakService=new PlanningService(f.pool,{gateway:leakGateway,config:f.service.config});
  const d=await f.send();await leakService.tick();
  const turnD=await f.ok('GET','ai/runs/'+d.run_id);
  assert.equal(turnD.status,'completed',JSON.stringify(turnD));
  assert.equal(leakCalls,2);
  assert.ok(!leakInputs[1].answers[0].includes('secret_tok_123'));
  assert.ok(!leakInputs[1].answers[0].includes('sk-abc123456789'));
  assert.ok(leakInputs[1].answers[0].includes('Bearer [REDACTED]'));
  assert.ok(leakInputs[1].answers[0].includes('sk-[REDACTED]'));
  assert.ok(leakInputs[1].answers[0].length<380);

  let badCalls=0;
  const badGateway={generate:async()=>{badCalls++;throw new DomainError('AI_BAD_REQUEST','bad model',422);}};
  const badService=new PlanningService(f.pool,{gateway:badGateway,config:f.service.config});
  const c=await f.send();await badService.tick();
  const turnC=await f.ok('GET','ai/runs/'+c.run_id);
  assert.equal(turnC.status,'failed');
  assert.equal(turnC.error.code,'AI_BAD_REQUEST');
  assert.equal(badCalls,1);

  const prevEnabled=process.env.V03_AI_ENABLED,prevUrl=process.env.DEEPSEEK_BASE_URL;
  process.env.V03_AI_ENABLED='1';process.env.DEEPSEEK_BASE_URL='http://insecure.example';
  try{
   const invalidService=new PlanningService(f.pool,{gateway:stub});
   const view=await invalidService.configView(user);
   assert.equal(view.configuration_error,'AI_CONFIG_INVALID');
  }finally{
   if(prevEnabled===undefined)delete process.env.V03_AI_ENABLED;else process.env.V03_AI_ENABLED=prevEnabled;
   if(prevUrl===undefined)delete process.env.DEEPSEEK_BASE_URL;else process.env.DEEPSEEK_BASE_URL=prevUrl;
  }
 }finally{await f.close();}
});

test('R1 PlanningService enforces maxInput on retry when retry hint pushes payload over limit',async()=>{
 let measuredBytes=0;
 const probeStub=new StubGateway((p,c)=>{
  measuredBytes=Buffer.byteLength(c.instructions+JSON.stringify(c.input),'utf8');
  return {...p,intent:'answer',actions:[]};
 });
 const f=await fixture(probeStub);
 try{
  await f.send();await f.service.tick();
  assert.ok(measuredBytes>20000);

  const conv2=await f.ok('POST','ai/conversations',{entrypoint:'home',title:null});
  const retryStub=new StubGateway((p,_c,n)=>n===1?{...p,context_ref:randomUUID()}:p);
  const tightService=new PlanningService(f.pool,{gateway:retryStub,config:{...f.service.config,maxInput:measuredBytes+50}});
  const b=await f.ok('POST',`ai/conversations/${conv2.id}/messages`,message());
  await tightService.tick();
  const turnB=await f.ok('GET','ai/runs/'+b.run_id);
  assert.equal(turnB.status,'failed');
  assert.equal(turnB.error.code,'AI_BUDGET_EXCEEDED');
  assert.equal(retryStub.calls,1);
  const usageRows=(await f.pool.query('SELECT attempt,reserved_input FROM ai_usage WHERE run_id=$1 ORDER BY attempt',[b.run_id])).rows;
  assert.equal(usageRows.length,1);
 }finally{await f.close();}
});

test('task acceptance preflight repairs only within the existing model budget', async t => {
 const variants = [
  ['manual with a rule', (data:any) => { data.completion_mode='manual'; }, /manual task has a record rule/],
  ['missing record rule', (data:any) => { data.rule=null; }, /missing its rule/],
  ['zero threshold', (data:any) => { data.rule.threshold='0'; }, /nonpositive threshold/],
 ] as const;
 for(const [name, mutate, feedback] of variants)await t.test(name,async()=>{
  const stub=new StubGateway((plan,context,attempt)=>{
   if(attempt===1)mutate(plan.actions.find((action:any)=>action.action_type==='task_template.create'&&action.data.rule).data);
   else{assert.match(context.input.retry_hint,feedback);assert.deepEqual(context.input.answers,[]);}
   return plan;
  });
  const f=await fixture(stub);
  try{
   const accepted=await f.send();
   await f.service.tick();
   const turn=await f.ok('GET','ai/runs/'+accepted.run_id);
   assert.equal(turn.status,'awaiting_confirmation');
   assert.equal(stub.calls,2);
   const usage=(await f.pool.query('SELECT attempt,status FROM ai_usage WHERE run_id=$1 ORDER BY attempt',[accepted.run_id])).rows;
   assert.deepEqual(usage,[{attempt:1,status:'known'},{attempt:2,status:'known'}]);
   for(const table of ['task_templates','records','wallet_ledger'])
    assert.equal((await f.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
  }finally{await f.close();}
 });

 await t.test('two invalid replies show the problem and never write a partial plan',async()=>{
  const stub=new StubGateway(plan=>{
   plan.actions.find((action:any)=>action.action_type==='task_template.create'&&action.data.rule).data.rule.threshold='0';
   return plan;
  });
  const f=await fixture(stub);
  try{
   const accepted=await f.send();
   await f.service.tick();
   const turn=await f.ok('GET','ai/runs/'+accepted.run_id);
   assert.equal(turn.status,'failed');
   assert.equal(turn.error.code,'INVALID_RULE');
   assert.match(turn.error.message,/任务验收目标必须大于零.*尚未保存/);
   assert.equal(stub.calls,2);
   for(const table of ['goals','task_templates','ai_proposals','records','wallet_ledger'])
    assert.equal((await f.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
  }finally{await f.close();}
 });
});
