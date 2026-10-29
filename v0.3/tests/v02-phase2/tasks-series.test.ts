import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from './support.js';
import {periodAt} from '../../packages/domain/src/phase2/rules.js';

test('C1 period boundaries include Monday, natural months and DST',()=>{
 const spring=periodAt('daily','America/New_York',new Date('2026-03-08T12:00:00Z'));assert.equal((Date.parse(spring.end!)-Date.parse(spring.start))/3600000,23);
 const fall=periodAt('daily','America/New_York',new Date('2026-11-01T12:00:00Z'));assert.equal((Date.parse(fall.end!)-Date.parse(fall.start))/3600000,25);
 assert.deepEqual(periodAt('monthly','Asia/Shanghai',new Date('2026-02-20T12:00:00Z')),{start:'2026-01-31T16:00:00.000Z',end:'2026-02-28T16:00:00.000Z'});
 const week=periodAt('weekly','Asia/Shanghai',new Date('2026-10-25T12:00:00Z'));assert.equal(week.start,'2026-10-18T16:00:00.000Z');
});
test('C1 concurrent materialization and idempotency produce exactly one locked instance',async()=>{
 const f=await fixture();try{
  const made=await f.template();const payload={template_ids:[made.template.id]},key=randomUUID();
  const responses=await Promise.all(Array.from({length:8},()=>f.req('POST','task-instances/materialize',payload,key)));
  for(const r of responses){assert.equal(r.statusCode,200,r.body);assert.deepEqual(r.json(),responses[0].json());assert.equal(r.json().data.instances[0].id,made.instance.id);}
  assert.equal((await f.req('POST','task-instances/materialize',{template_ids:[]},key)).statusCode,409);
  f.setNow('2026-10-21T12:00:00Z');const next=await Promise.all(Array.from({length:6},()=>f.ok('POST','task-instances/materialize',payload)));
  assert.equal(new Set(next.map(r=>r.instances[0].id)).size,1);assert.notEqual(next[0].instances[0].id,made.instance.id);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM task_instance_details')).rows[0].n,2);
  const homeBefore=(await f.pool.query('SELECT count(*)::int n FROM tasks')).rows[0].n;await f.ok('GET','home');assert.equal((await f.pool.query('SELECT count(*)::int n FROM tasks')).rows[0].n,homeBefore);
 }finally{await f.close();}
});
test('C1 future template/timezone changes cannot overlap instances or change old snapshots',async()=>{
 const f=await fixture();try{
  const a=await f.template({timezone:'Pacific/Kiritimati'});
  assert.equal((await f.req('PATCH','task-templates/'+a.template.id,{base_version:1,timezone:'America/Adak',effective_from:f.now().toISOString()})).statusCode,422);
  const patched=await f.ok('PATCH','task-templates/'+a.template.id,{base_version:1,timezone:'America/Adak',title:'future title',color:'#12aBcD'});assert.equal(patched.instance.definition.title,a.instance.definition.title);
  f.setNow(new Date(Date.parse(a.instance.period.end)+1000).toISOString());const b=(await f.ok('POST','task-instances/materialize',{template_ids:[a.template.id]})).instances[0];
  assert.equal(b.period.timezone,'America/Adak');assert.ok(Date.parse(b.period.start)>=Date.parse(a.instance.period.end));assert.equal(b.definition.title,'future title');
  const raw=(await f.pool.query('SELECT snapshot FROM task_instance_details WHERE task_id=$1',[a.instance.id])).rows[0].snapshot;assert.equal(raw.timezone,'Pacific/Kiritimati');
  assert.equal((await f.req('PATCH','task-templates/'+a.template.id,{base_version:1,color:'blue'})).statusCode,409);
  const v=await f.ok('GET','task-templates');assert.equal(v[0].version,2);
  assert.equal((await f.req('POST','task-templates',{...a.template.definition,id:randomUUID(),color:'red;url(x)'})).statusCode,400);
 }finally{await f.close();}
});
test('C1 count, distinct_days, sum and half-open evidence rules are deterministic',async()=>{
 const f=await fixture();try{
  const type=DEFAULT_TEMPLATE_IDS[0],base={record_type_id:type,threshold:'2',filters:[]};
  const count=await f.template({category:'weekly',completion_mode:'record_required',rule:{kind:'count',...base}});
  const days=await f.template({category:'weekly',completion_mode:'record_required',rule:{kind:'distinct_days',...base}});
  const sum=await f.template({category:'weekly',completion_mode:'record_required',rule:{kind:'sum',...base,threshold:'25',field_key:'duration_minutes',unit:'分钟'}});
  await f.record('2026-10-19T01:00:00Z',10);await f.record('2026-10-19T02:00:00Z',10);
  let list=await f.ok('GET','task-instances');assert.equal(list.find((r:any)=>r.id===count.instance.id).status,'completed');assert.equal(list.find((r:any)=>r.id===days.instance.id).status,'partial');
  await f.record('2026-10-20T01:00:00Z',5);list=await f.ok('GET','task-instances');for(const t of [count,days,sum])assert.equal(list.find((r:any)=>r.id===t.instance.id).status,'completed');
  assert.equal(list.find((r:any)=>r.id===sum.instance.id).progress.value,'25');assert.equal(list.find((r:any)=>r.id===days.instance.id).progress.value,'2');
  await f.record(count.instance.period.end,100);list=await f.ok('GET','task-instances');assert.equal(list.find((r:any)=>r.id===sum.instance.id).progress.value,'25');
  const closed=await f.template({completion_mode:'record_required',rule:{kind:'count',...base,threshold:'100'}});f.setNow('2026-10-22T01:00:00Z');await f.ok('POST','task-instances/materialize',{template_ids:[]});list=await f.ok('GET','task-instances');assert.equal(list.find((r:any)=>r.id===closed.instance.id).status,'ended');
 }finally{await f.close();}
});
test('C1 manual completion latest-version no-op, revoke reason and inactive references',async()=>{
 const f=await fixture();try{
  const made=await f.template();const done=await f.ok('POST',`tasks/${made.instance.id}/complete`,{base_version:made.instance.version});
  const again=await f.ok('POST',`tasks/${made.instance.id}/complete`,{base_version:done.version});assert.equal(again.version,done.version);assert.equal(again.completed_at,done.completed_at);
  assert.equal((await f.req('POST',`tasks/${made.instance.id}/revoke`,{base_version:done.version,reason:''})).statusCode,400);
  const undone=await f.ok('POST',`tasks/${made.instance.id}/revoke`,{base_version:done.version,reason:'synthetic correction'});assert.equal(undone.status,'pending');assert.equal((await f.pool.query("SELECT count(*)::int n FROM task_history WHERE event='revoke'")).rows[0].n,1);
  await f.record('2026-10-20T01:00:00Z');assert.equal((await f.ok('GET','task-instances')).find((r:any)=>r.id===undone.id).status,'pending');
  await f.ok('PATCH',`modules/${DEFAULT_MODULE_IDS[0]}`,{base_version:1,status:'archived'});assert.equal((await f.req('POST',`tasks/${undone.id}/complete`,{base_version:undone.version})).statusCode,409);
 }finally{await f.close();}
});
test('C1 1/3/10 distinct-day milestones cross levels and evidence recovery reuses awards',async()=>{
 const f=await fixture();try{
  const records=[];for(let i=0;i<10;i++)records.push(await f.record(`2026-10-${String(10+i).padStart(2,'0')}T01:00:00Z`));
  await f.record('2026-10-19T02:00:00Z');
  const input={id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],name:'distinct days',record_type_id:DEFAULT_TEMPLATE_IDS[0],aggregation:'distinct_days',field_key:null,unit:'天',timezone:'Asia/Shanghai',milestones:['10','1','3'].map(threshold=>({id:randomUUID(),threshold}))};
  await f.ok('POST','achievement-series',input);let series=(await f.ok('GET','achievement-series'))[0];assert.equal(series.progress.value,'10');assert.deepEqual(series.milestones.map((m:any)=>m.threshold),['1','3','10']);
  const awardIds=series.milestones.map((m:any)=>m.award.id);assert.equal((await f.ok('GET','achievement-summary')).effective_awards_count,3);
  const original=records[0];await f.ok('DELETE',`records/${original.id}`,{base_version:1});series=(await f.ok('GET','achievement-series'))[0];assert.equal(series.milestones[2].award.state,'needs_review');assert.equal((await f.ok('GET','achievement-summary')).effective_awards_count,2);
  await f.record(original.occurred_at);series=(await f.ok('GET','achievement-series'))[0];assert.deepEqual(series.milestones.map((m:any)=>m.award.id),awardIds);assert.equal((await f.ok('GET','achievement-summary')).effective_awards_count,3);
  assert.equal((await f.req('POST','achievement-series',{...input,id:randomUUID(),milestones:[{id:randomUUID(),threshold:'1.0'},{id:randomUUID(),threshold:'1'}]})).statusCode,422);
 }finally{await f.close();}
});
test('C1 combined filters are applied before pagination and numeric filter errors are explicit',async()=>{
 const f=await fixture();try{
 const a=await f.template({color:'green'}),b=await f.template({color:'green'});await f.template({category:'weekly',color:'green'});await f.template({color:'blue'});
 await f.ok('PATCH','home-preferences',{base_version:1,task_pins:[{kind:'template',id:a.template.id},{kind:'instance',id:b.instance.id}]});
 const r=await f.req('GET',`task-instances?module_id=${DEFAULT_MODULE_IDS[0]}&category=daily&status=pending&color=green&pinned=true&limit=1&offset=1`);assert.equal(r.statusCode,200);assert.equal(r.json().page.total,2);assert.equal(r.json().data.length,1);assert.equal(r.json().data[0].color,'green');
 const invalid=await f.req('POST','task-templates',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],title:'invalid filter fixture',category:'daily',timezone:'Asia/Shanghai',completion_mode:'record_required',rule:{kind:'count',record_type_id:DEFAULT_TEMPLATE_IDS[0],threshold:'1',filters:[{field_key:'duration_minutes',operator:'gte',value:'not-a-number'}]}});assert.equal(invalid.statusCode,422);
 }finally{await f.close();}
});
