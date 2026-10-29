import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DateTime} from 'luxon';
import {guardSynthetic} from '../v02-phase3/guard.js';
import {createPool} from '../../packages/db/src/client.js';
import {migrate} from '../../packages/db/src/migrate.js';
import {seed,LOCAL_USER_ID,DEFAULT_MODULE_IDS} from '../../packages/db/src/seed.js';
import {PlanningService} from '../../apps/api/src/ai/service.js';
import {Service} from '../../apps/api/src/service.js';
import {gatewayConfig} from '../../packages/ai/src/v03/gateway.js';
import {StubGateway,message} from './fixtures.js';
const user=LOCAL_USER_ID,moduleId=DEFAULT_MODULE_IDS[0];
const question=(always=false)=>new StubGateway((p,_c,n)=>n===1||always?{...p,intent:'clarify',actions:[],clarification:{question:'计划多少天？',choices:['30天'],blocking_fields:['target_date']}}:p);
async function fixture(stub=new StubGateway(),overrides:any={}){
 guardSynthetic();const pool=createPool();await migrate(pool);await pool.query('TRUNCATE users CASCADE');await seed(pool);
 let at=new Date();const now=()=>at;
 const config={...gatewayConfig({}),rewardPricing:false,enabled:true,configured:true,apiKey:'synthetic-closeout-only',model:'synthetic-offline',maxInput:100000,dailyInput:1000000,...overrides};
 const service=new PlanningService(pool,{gateway:stub,config,now});
 await service.patchPreferences(user,randomUUID(),{base_version:1,automatic_mode:'clear_commands',readable_module_ids:[moduleId],auto_config_objects_limit:12,auto_record_count_limit:5});
 const conv=(await service.createConversation(user,randomUUID(),{entrypoint:'home',title:null})).data;
 const send=async(text?:string)=>(await service.accept(user,conv.id,randomUUID(),message(text))).data;
 const answer=async(run:string,text:string,op=randomUUID())=>{const t=await service.turn(user,run);const body={run_version:t.version,question_id:t.clarification.question_id,answer_text:text};return {body,op,result:await service.clarify(user,run,op,body)};};
 const count=async(table:string)=>(await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
 return {pool,service,stub,config,now,setNow:(date:Date)=>{at=date;},send,answer,count,close:()=>pool.end()};
}
async function applied(f:Awaited<ReturnType<typeof fixture>>){const a=await f.send();await f.service.tick();const t=await f.service.turn(user,a.run_id);assert.equal(t.status,'completed',JSON.stringify(t));return {receipt:t.application,daily:t.application.id_map.find((x:any)=>x.local_ref==='english_daily').id};}
test('F01 latest clarification restrictions require confirmation despite a write-producing model',async t=>{
 for(const reply of ['30天，每天20分钟，但先不要创建，先让我看看方案','30天，每天20分钟，先预览，确认后再执行','30天，每天20分钟，不要创建，先看方案','30天，每天20分钟，只要一个任务，不超过一项'])await t.test(reply,async()=>{
  const f=await fixture(question());try{const a=await f.send('帮我安排英语学习');await f.service.tick();const answer=await f.answer(a.run_id,reply);assert.deepEqual(await f.service.clarify(user,a.run_id,answer.op,answer.body),answer.result);await f.service.tick();const turn=await f.service.turn(user,a.run_id);assert.equal(turn.status,'awaiting_confirmation',JSON.stringify(turn));assert.equal(turn.application,null);assert.equal(await f.count('goals'),0);assert.equal(f.stub.calls,2);assert.deepEqual(await f.service.clarify(user,a.run_id,answer.op,answer.body),answer.result);assert.equal(await f.count('goals'),0);
  const context=(await f.pool.query('SELECT context FROM ai_context_snapshots WHERE run_id=$1 ORDER BY created_at DESC LIMIT 1',[a.run_id])).rows[0].context;assert.equal(context.effective_intent.version,2);assert.equal(context.effective_intent.mode,'preview');
 }finally{await f.close();}});
});
test('F01 explicit cancellation in a clarification stops before another paid attempt',async()=>{
 const f=await fixture(question());try{const a=await f.send('帮我安排英语学习');await f.service.tick();const answer=await f.answer(a.run_id,'取消本次请求');assert.equal(answer.result.data.status,'cancelled');assert.equal(await f.service.tick(),false);assert.equal((await f.service.turn(user,a.run_id)).status,'cancelled');assert.equal(f.stub.calls,1);assert.equal(await f.count('goals'),0);assert.equal(await f.count('ai_usage'),1);assert.deepEqual(await f.service.clarify(user,a.run_id,answer.op,answer.body),answer.result);}finally{await f.close();}
});
test('F02 an edit after undo preview invalidates the token and leaves the entire application untouched',async()=>{
 const f=await fixture();try{const {receipt,daily}=await applied(f),id=receipt.application_id;
 const preview=(await f.service.undoPreview(user,id,randomUUID(),{base_version:1})).data;
 await f.service.core.mutate(user,randomUUID(),'PATCH','task-templates/'+daily,{base_version:1,title:'用户在撤销预览后修改的新计划'});
 const before=(await f.pool.query('SELECT version,status,definition,next_definition,effective_at FROM task_templates WHERE id=$1',[daily])).rows[0];
 await assert.rejects(f.service.undo(user,id,randomUUID(),{preview_version:preview.preview_version,confirmation_token:preview.confirmation_token}),(e:any)=>e.code==='VERSION_CONFLICT'&&e.status===409);
 assert.deepEqual((await f.pool.query('SELECT version,status,definition,next_definition,effective_at FROM task_templates WHERE id=$1',[daily])).rows[0],before);assert.equal((await f.pool.query('SELECT count(*)::int n FROM goals WHERE archived_at IS NOT NULL')).rows[0].n,0);assert.equal((await f.pool.query('SELECT undone_at FROM ai_applications WHERE id=$1',[id])).rows[0].undone_at,null);
 const fresh=(await f.service.undoPreview(user,id,randomUUID(),{base_version:1})).data;assert.ok(fresh.modifications.some((m:any)=>m.id===daily&&m.version===2&&m.pending_label==='用户在撤销预览后修改的新计划'));
 const op=randomUUID(),body={preview_version:fresh.preview_version,confirmation_token:fresh.confirmation_token},result=await f.service.undo(user,id,op,body);assert.equal(result.data.status,'undone');assert.deepEqual(await f.service.undo(user,id,op,body),result);assert.equal((await f.pool.query('SELECT version FROM change_log WHERE entity_id=$1 ORDER BY seq DESC LIMIT 1',[daily])).rows[0].version,3);
 }finally{await f.close();}
});
test('F02 edits before preview and changes to reference identities appear in the confirmed difference',async()=>{
 const f=await fixture();try{const {receipt,daily}=await applied(f),id=receipt.application_id;
 await f.service.core.mutate(user,randomUUID(),'PATCH','task-templates/'+daily,{base_version:1,title:'预览前已修改'});
 let preview=(await f.service.undoPreview(user,id,randomUUID(),{base_version:1})).data;assert.ok(preview.modifications.some((m:any)=>m.id===daily));
 const type=receipt.id_map.find((x:any)=>x.entity_type==='record_type').id;
 const createMetric=async()=>f.service.core.mutate(user,randomUUID(),'POST','metrics',{id:randomUUID(),module_id:moduleId,record_type_id:type,name:'外部引用',unit:'分钟',aggregation:'sum',field_key:'duration_minutes',window:'all_time',timezone:'Asia/Shanghai'});
 await createMetric();await assert.rejects(f.service.undo(user,id,randomUUID(),{preview_version:preview.preview_version,confirmation_token:preview.confirmation_token}),(e:any)=>e.code==='VERSION_CONFLICT');
 preview=(await f.service.undoPreview(user,id,randomUUID(),{base_version:1})).data;
 await createMetric();await assert.rejects(f.service.undo(user,id,randomUUID(),{preview_version:preview.preview_version,confirmation_token:preview.confirmation_token}),(e:any)=>e.code==='VERSION_CONFLICT');
 }finally{await f.close();}
});
test('F03 five-minute human wait and a new worker preserve the same run and remaining execution budget',async()=>{
 const f=await fixture(question());try{const generate=f.stub.generate.bind(f.stub);f.stub.generate=async(...args)=>{const result=await generate(...args);if(f.stub.calls===1)f.setNow(new Date(f.now().getTime()+10000));return result;};
 const a=await f.send('帮我安排英语学习');await f.service.tick();let row=await f.service.runRow(user,a.run_id);assert.equal(row.deadline_at,null);assert.ok(row.detail.execution_remaining_ms>0&&row.detail.execution_remaining_ms<=f.config.runMs-10000);
 f.setNow(new Date(f.now().getTime()+5*60000));await f.answer(a.run_id,'30天，每天20分钟');f.setNow(new Date(f.now().getTime()+5*60000));
 const restarted=new PlanningService(f.pool,{gateway:f.stub,config:f.config,now:f.now});await restarted.tick();const turn=await restarted.turn(user,a.run_id);assert.equal(turn.status,'completed',JSON.stringify(turn));assert.equal(f.stub.calls,2);assert.equal(await f.count('ai_usage'),2);
 }finally{await f.close();}
});
test('F03 clarification cannot reset request count, quota or a real model deadline',async t=>{
 await t.test('two attempts stay exhausted across human waits',async()=>{const f=await fixture(question(true));try{const a=await f.send('帮我安排英语学习');await f.service.tick();f.setNow(new Date(f.now().getTime()+300000));await f.answer(a.run_id,'30天');await f.service.tick();f.setNow(new Date(f.now().getTime()+300000));await assert.rejects(f.answer(a.run_id,'每天20分钟'),(e:any)=>e.code==='AI_BUDGET_EXCEEDED');assert.equal(f.stub.calls,2);assert.equal(await f.count('ai_usage'),2);}finally{await f.close();}});
 await t.test('daily quota survives the human wait',async()=>{const f=await fixture(question(),{dailyOutput:250,maxOutput:200});try{const a=await f.send('帮我安排英语学习');await f.service.tick();f.setNow(new Date(f.now().getTime()+300000));await f.answer(a.run_id,'30天，每天20分钟');await f.service.tick();const turn=await f.service.turn(user,a.run_id);assert.equal(turn.status,'failed');assert.equal(turn.error.code,'AI_BUDGET_EXCEEDED');assert.equal(f.stub.calls,1);assert.equal(await f.count('ai_usage'),1);}finally{await f.close();}});
 await t.test('unknown in-flight execution still times out',async()=>{const stub=new StubGateway();stub.generate=async()=>new Promise(()=>{});const f=await fixture(stub,{attemptMs:10,runMs:30});try{const a=await f.send();await f.service.tick();const turn=await f.service.turn(user,a.run_id);assert.equal(turn.status,'failed');assert.equal(turn.error.code,'AI_TIMEOUT');assert.equal(await f.count('goals'),0);}finally{await f.close();}});
});
test('F04 renewal activates after expiry and leaves the locked original instance unchanged',async()=>{
 const f=await fixture();try{let at=DateTime.fromISO('2026-10-21T12:00:00+08:00');f.setNow(at.toJSDate());const core=new Service(f.pool,f.now),id=randomUUID();
 const schedule={active_from:at.toISODate(),active_until:at.toISODate(),weekdays:null,preferred_local_time:null};
 const created:any=await core.mutate(user,randomUUID(),'POST','task-templates',{id,module_id:moduleId,title:'续期测试',category:'daily',timezone:'Asia/Shanghai',completion_mode:'manual',rule:null,color:'blue',due_at:null,schedule});
 const original=(await f.pool.query('SELECT snapshot,period_start,period_end,template_version FROM task_instance_details WHERE task_id=$1',[created.data.instance.id])).rows[0];
 await core.mutate(user,randomUUID(),'PATCH','task-templates/'+id,{base_version:1,schedule:{...schedule,active_until:at.plus({days:10}).toISODate()}});
 const same:any=await core.mutate(user,randomUUID(),'POST','task-instances/materialize',{template_ids:[id]});assert.equal(same.data.instances[0].id,created.data.instance.id);
 f.setNow(at.plus({days:2}).toJSDate());const next:any=await core.mutate(user,randomUUID(),'POST','task-instances/materialize',{template_ids:[id]});assert.equal(next.data.instances.length,1);assert.equal(next.data.instances[0].template_version,2);assert.ok(next.data.next_check_at);assert.equal((await f.pool.query('SELECT next_definition FROM task_templates WHERE id=$1',[id])).rows[0].next_definition,null);
 assert.deepEqual((await f.pool.query('SELECT snapshot,period_start,period_end,template_version FROM task_instance_details WHERE task_id=$1',[created.data.instance.id])).rows[0],original);
 }finally{await f.close();}
});
test('F04 a rest day does not block a due weekday change, and future changes provide a wakeup',async()=>{
 const f=await fixture();try{const at=DateTime.fromISO('2026-10-21T12:00:00+08:00');f.setNow(at.toJSDate());const core=new Service(f.pool,f.now),id=randomUUID();
 const schedule={active_from:at.toISODate(),active_until:at.plus({days:1}).toISODate(),weekdays:[3],preferred_local_time:null};
 await core.mutate(user,randomUUID(),'POST','task-templates',{id,module_id:moduleId,title:'适用星期切换',category:'daily',timezone:'Asia/Shanghai',completion_mode:'manual',rule:null,color:'blue',due_at:null,schedule});
 const effective=at.plus({days:2}).startOf('day');await core.mutate(user,randomUUID(),'PATCH','task-templates/'+id,{base_version:1,effective_from:effective.toUTC().toISO(),schedule:{...schedule,active_until:at.plus({days:10}).toISODate(),weekdays:[5]}});
 f.setNow(at.plus({days:1}).toJSDate());const waiting:any=await core.mutate(user,randomUUID(),'POST','task-instances/materialize',{template_ids:[id]});assert.equal(waiting.data.instances.length,0);assert.equal(Date.parse(waiting.data.next_check_at),effective.toMillis());
 f.setNow(at.plus({days:2}).toJSDate());const ready:any=await core.mutate(user,randomUUID(),'POST','task-instances/materialize',{template_ids:[id]});assert.equal(ready.data.instances.length,1);assert.equal(ready.data.instances[0].template_version,2);
 }finally{await f.close();}
});
