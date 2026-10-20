import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,LOCAL_USER_ID,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from './support.js';
import {exportUserData,restoreUserData} from '../../packages/db/src/backup.js';
const module_id=DEFAULT_MODULE_IDS[0],record_type_id=DEFAULT_TEMPLATE_IDS[0];
test('observation sources, explicit context, version conflicts and derived read-only fields',async()=>{
 const f=await fixture();try{
 const metric=await f.ok('POST','metrics',{id:randomUUID(),module_id,record_type_id,name:'total',unit:'分钟',aggregation:'sum',field_key:'duration_minutes',window:'all_time',timezone:'Asia/Shanghai'});
 const field={id:randomUUID(),module_id,key:'observed_minutes',label:'观察',kind:'observation',type:'integer',value:null,unit:'分钟',options:[],binding:{record_type_id,field_key:'duration_minutes'}};
 const derived={...field,id:randomUUID(),key:'derived_minutes',kind:'derived',type:'decimal',binding:{metric_id:metric.id}};
 await f.ok('PATCH','profile',{base_version:1,field_upserts:[field,derived]});
 assert.equal((await f.pool.query('SELECT count(*) FROM records')).rows[0].count,'0');
 const task=await f.template({completion_mode:'record_required',rule:{kind:'sum',record_type_id,field_key:'duration_minutes',unit:'分钟',threshold:'20'}});
 const body={id:randomUUID(),field_id:field.id,occurred_at:'2026-10-20T09:00:00Z',timezone:'Asia/Shanghai',value:20};
 assert.equal((await f.req('POST','profile/observations',body)).statusCode,422);
 const op=randomUUID(),d=await f.ok('POST','profile/observations',{...body,context_values:{topic:'synthetic observation'}},op);
 assert.equal(d.record.version,1);assert.ok(d.impact.changes.some((x:any)=>x.entity_type==='wallet_entry'));
 const p=await f.ok('GET','profile');assert.equal(p.module_fields.find((x:any)=>x.id===field.id).source_ref.record_id,d.record.id);assert.equal(p.module_fields.find((x:any)=>x.id===derived.id).value,'20');
 assert.equal((await f.ok('GET','wallet')).balance,'10');
 const correction={...body,id:randomUUID(),source_record_id:d.record.id,source_base_version:1,value:5};
 await f.ok('POST','profile/observations',correction);assert.equal((await f.ok('GET','wallet')).balance,'0');
 assert.equal((await f.req('POST','profile/observations',{...correction,id:randomUUID()})).statusCode,409);
 assert.equal((await f.req('PATCH','profile',{base_version:2,field_upserts:[{...derived,value:'99'}]})).statusCode,400);
 assert.equal((await f.req('PATCH','profile',{base_version:2,field_upserts:[{...field,unit:'小时'}]})).statusCode,422);
 assert.equal((await f.req('POST','profile/observations',{...body,id:randomUUID(),field_id:derived.id})).statusCode,422);
 const current=await f.ok('GET','tasks/'+task.instance.id);assert.equal(current.needs_review,true);
 }finally{await f.close();}
});
test('per-user quotas, append-only reversal chains, restore and idempotency replay',async()=>{
 const f=await fixture();try{
 const ts=[];for(let i=0;i<5;i++)ts.push(await f.template({timezone:i%2?'Pacific/Kiritimati':'America/Adak'}));
 const commands=ts.map(t=>({id:t.instance.id,key:randomUUID(),body:{base_version:t.instance.version}}));
 await Promise.all(commands.map(t=>f.ok('POST',`tasks/${t.id}/complete`,t.body,t.key)));
 assert.equal((await f.ok('GET','wallet')).balance,'30');
 const eligible=(await f.pool.query('SELECT * FROM reward_qualifications WHERE eligible ORDER BY created_at,id')).rows;assert.equal(eligible.length,3);
 assert.equal((await f.pool.query('SELECT count(DISTINCT quota_period) FROM reward_qualifications')).rows[0].count,'1');
 const id=eligible[0].task_id;let t=await f.ok('GET','tasks/'+id);
 await f.ok('POST',`tasks/${id}/revoke`,{base_version:t.version,reason:'synthetic correction'});assert.equal((await f.ok('GET','wallet')).balance,'20');
 t=await f.ok('GET','tasks/'+id);await f.ok('POST',`tasks/${id}/complete`,{base_version:t.version});assert.equal((await f.ok('GET','wallet')).balance,'30');
 const ledger=await f.ok('GET','wallet/ledger');assert.equal(ledger.length,5);
 const chain=(await f.pool.query('SELECT * FROM wallet_ledger WHERE task_id=$1 ORDER BY ordinal',[id])).rows;assert.deepEqual(chain.map(r=>r.kind),['grant','reversal','reinstatement']);assert.equal(chain[2].root_entry_id,chain[0].id);assert.equal(chain[2].previous_entry_id,chain[1].id);
 await assert.rejects(f.pool.query('UPDATE wallet_ledger SET reason=$1 WHERE id=$2',['tamper',chain[0].id]),/append-only/);
 await assert.rejects(f.pool.query('DELETE FROM wallet_ledger WHERE id=$1',[chain[0].id]),/append-only/);
 const before=await exportUserData(f.pool,LOCAL_USER_ID);await f.pool.query('TRUNCATE users CASCADE');await restoreUserData(f.pool,before);
 const response=await f.app.inject({method:'POST',url:'/api/v1/session',headers:{origin:'http://codex.test'},payload:{login_secret:process.env.LOCAL_LOGIN_SECRET}});const cookie=String(response.headers['set-cookie']).split(';')[0];
 const original=commands[0];const replay=await f.req('POST',`tasks/${original.id}/complete`,original.body,original.key,{cookie});assert.equal(replay.statusCode,200,replay.body);
 assert.deepEqual((await exportUserData(f.pool,LOCAL_USER_ID)).data,before.data);
 }finally{await f.close();}
});
test('late qualification is permanently denied, profile timezone cannot reset caps, GET has no writes',async()=>{
 const f=await fixture();try{
 const old=await f.template();f.setNow('2026-10-29T12:00:00Z');
 await f.ok('POST',`tasks/${old.instance.id}/complete`,{base_version:old.instance.version});
 assert.equal((await f.ok('GET','wallet')).balance,'0');assert.equal((await f.pool.query('SELECT denial_reason FROM reward_qualifications')).rows[0].denial_reason,'expired');
 await f.ok('PATCH','profile',{base_version:1,timezone:'Pacific/Kiritimati'});
 assert.equal((await f.ok('GET','wallet')).quota_timezone,'Asia/Shanghai');
 const before=await exportUserData(f.pool,LOCAL_USER_ID);for(const path of ['home','profile','wallet','wallet/ledger','achievement-summary','task-instances'])await f.ok('GET',path);
 assert.deepEqual((await exportUserData(f.pool,LOCAL_USER_ID)).data,before.data);
 }finally{await f.close();}
});
test('each category cap is independent, cancellation is terminal and late evidence retains original bucket',async()=>{
 const f=await fixture();try{
 for(const [category,limit,amount] of [['main',1,100],['weekly',3,50],['monthly',2,200]] as const){
  for(let i=0;i<limit+1;i++){const t=await f.template({category});await f.ok('POST',`tasks/${t.instance.id}/complete`,{base_version:t.instance.version});}
  assert.equal((await f.pool.query('SELECT count(*) FROM reward_qualifications WHERE category=$1 AND eligible',[category])).rows[0].count,String(limit));
 }
 assert.equal((await f.ok('GET','wallet')).balance,'650');
 const t=await f.template();const complete=await f.ok('POST',`tasks/${t.instance.id}/complete`,{base_version:t.instance.version});
 await f.ok('POST',`tasks/${t.instance.id}/cancel`,{base_version:complete.version,reason:'synthetic cancel'});
 assert.equal((await f.req('POST',`tasks/${t.instance.id}/complete`,{base_version:complete.version+1})).statusCode,409);
 await f.record('2026-10-20T09:00:00Z');assert.equal((await f.ok('GET','tasks/'+t.instance.id)).status,'cancelled');assert.equal((await f.ok('GET','wallet')).balance,'650');
 const late=await f.template({completion_mode:'record_required',rule:{kind:'count',record_type_id,threshold:'1'}});
 f.setNow('2026-10-27T16:00:00Z'); // deadline Shanghai day-end +7 days, inclusive
 await f.record('2026-10-20T11:00:00Z');
 const q=(await f.pool.query('SELECT * FROM reward_qualifications WHERE task_id=$1',[late.instance.id])).rows[0];assert.equal(q.eligible,true);assert.equal(q.quota_period,'2026-10-20');
 }finally{await f.close();}
});
test('typed home pins, panel/home trend identity and observations share a read-only snapshot',async()=>{
 const f=await fixture();try{
 const metric=await f.ok('POST','metrics',{id:randomUUID(),module_id,record_type_id,name:'count',unit:'次',aggregation:'count',field_key:null,window:'all_time',timezone:'Asia/Shanghai'}),t=await f.template();
 const pin={metric_id:metric.id,range:'last_7_days',grain:'1d'};
 await f.ok('PATCH','home-preferences',{base_version:1,task_pins:[{kind:'template',id:t.template.id}],pinned_trends:[pin]});await f.record('2026-10-20T09:00:00Z');
 const h=await f.ok('GET','home');assert.equal(h.tasks[0].id,t.instance.id);assert.deepEqual(h.trends[0].result,await f.ok('GET',`metrics/${metric.id}/trend`));
 await f.ok('PATCH','home-preferences',{base_version:2,task_pins:[]});assert.deepEqual((await f.ok('GET','home-preferences')).pinned_task_ids,[]);
 }finally{await f.close();}
});
test('full graph backup preserves bindings, milestone awards, recurring snapshots, ledger and command receipts',async()=>{
 const f=await fixture();try{
 const metric=await f.ok('POST','metrics',{id:randomUUID(),module_id,record_type_id,name:'count',unit:'次',aggregation:'count',field_key:null,window:'all_time',timezone:'Asia/Shanghai'});
 const field={id:randomUUID(),module_id,key:'minutes',label:'来源',kind:'observation',type:'integer',value:null,unit:'分钟',options:[],binding:{record_type_id,field_key:'duration_minutes'}};
 await f.ok('PATCH','profile',{base_version:1,field_upserts:[field]});
 await f.ok('POST','achievement-series',{id:randomUUID(),module_id,name:'fixture milestones',record_type_id,aggregation:'distinct_days',unit:'天',timezone:'Asia/Shanghai',milestones:[{id:randomUUID(),threshold:'1'},{id:randomUUID(),threshold:'3'}]});
 const task=await f.template({completion_mode:'record_required',rule:{kind:'count',record_type_id,threshold:'1'}});
 await f.ok('PATCH','home-preferences',{base_version:1,task_pins:[{kind:'template',id:task.template.id}],pinned_trends:[{metric_id:metric.id,range:'last_7_days',grain:'1d'}]});
 const body={id:randomUUID(),field_id:field.id,occurred_at:'2026-10-20T09:00:00Z',timezone:'Asia/Shanghai',value:30,context_values:{topic:'synthetic full graph'}},key=randomUUID();await f.ok('POST','profile/observations',body,key);
 const before=await exportUserData(f.pool,LOCAL_USER_ID);for(const table of ['profile_fields','series_awards','wallet_ledger','reward_qualifications','task_instance_details'])assert.ok(before.counts[table]>0,table);
 await f.pool.query('TRUNCATE users CASCADE');await restoreUserData(f.pool,before);
 const login=await f.app.inject({method:'POST',url:'/api/v1/session',headers:{origin:'http://codex.test'},payload:{login_secret:process.env.LOCAL_LOGIN_SECRET}}),cookie=String(login.headers['set-cookie']).split(';')[0];
 assert.equal((await f.req('POST','profile/observations',body,key,{cookie})).statusCode,200);assert.deepEqual((await exportUserData(f.pool,LOCAL_USER_ID)).data,before.data);
 const {Service}=await import('../../apps/api/src/service.js');const reopened=new Service(f.pool,f.now);const home=await reopened.configuration(LOCAL_USER_ID,'home');assert.equal(home.wallet.balance,'10');assert.equal(home.achievement_summary.effective_awards_count,1);assert.equal(home.profile.module_fields[0].source_ref.record_id,body.id);
 }finally{await f.close();}
});
test('legacy persisted pins survive unrelated preference edits after migration',async()=>{
 const f=await fixture();try{
 const t=await f.template();await f.pool.query('INSERT INTO home_preferences(user_id,pinned_task_ids) VALUES($1,$2)',[LOCAL_USER_ID,JSON.stringify([t.instance.id])]);
 await f.ok('PATCH','home-preferences',{base_version:1,minimal_mode:true});const p=await f.ok('GET','home-preferences');assert.deepEqual(p.pinned_task_ids,[t.instance.id]);assert.deepEqual(p.task_pins,[{kind:'instance',id:t.instance.id}]);
 }finally{await f.close();}
});
