import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {fixture,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from '../v02-phase2/support.js';
const module_id=DEFAULT_MODULE_IDS[0],record_type_id=DEFAULT_TEMPLATE_IDS[0];
test('R03 old observation must conflict if its binding changed, with no facts or awards',async()=>{
 const f=await fixture();try{
 const source=await f.ok('GET','record-types/'+record_type_id),alternate=await f.ok('POST','record-types',{id:randomUUID(),module_id,name:'synthetic alternate',fields:source.fields});
 const field={id:randomUUID(),module_id,key:'observed',label:'synthetic observation',kind:'observation',type:'integer',unit:'分钟',value:null,options:[],binding:{record_type_id,field_key:'duration_minutes'}};
 await f.ok('PATCH','profile',{base_version:1,field_upserts:[field]});const old=(await f.ok('GET','profile')).module_fields[0];
 const body={id:randomUUID(),field_id:field.id,binding_fingerprint:old.binding_fingerprint,occurred_at:'2026-10-20T09:00:00Z',timezone:'Asia/Shanghai',value:10,context_values:{topic:'synthetic'}};
 await f.ok('PATCH','profile',{base_version:2,field_upserts:[{...field,binding:{record_type_id:alternate.id,field_key:'duration_minutes'}}]});
 const before=await f.ok('GET','export');const result=await f.req('POST','profile/observations',body);assert.equal(result.statusCode,409,result.body);assert.equal(result.json().error.code,'BINDING_CONFLICT');assert.deepEqual((await f.ok('GET','export')).data,before.data);
 }finally{await f.close();}
});
test('R02 default materialization processes 101 equal-timestamp templates completely and once',async()=>{
 const f=await fixture();try{for(let i=0;i<101;i++)await f.template({title:'synthetic capacity '+i});await f.pool.query('UPDATE task_templates SET created_at=$1',['2026-10-20T12:00:00Z']);f.setNow('2026-11-01T12:00:00Z');
 const results=await Promise.all([f.ok('POST','task-instances/materialize',{}),f.ok('POST','task-instances/materialize',{})]);for(const r of results)assert.equal(r.instances.length,101);
 const rows=(await f.pool.query("SELECT template_id,count(*) n FROM task_instance_details WHERE period_start='2026-10-31T16:00:00Z' GROUP BY template_id")).rows;assert.equal(rows.length,101);assert.ok(rows.every(r=>r.n==='1'));
 const archived=results[0].instances[0].template_id;
 await Promise.all([f.ok('PATCH','task-templates/'+archived,{base_version:1,status:'archived'}),f.template({title:'synthetic concurrent addition'}),f.ok('POST','task-instances/materialize',{})]);
 const final=await f.ok('POST','task-instances/materialize',{});assert.equal(final.instances.length,101);assert.ok(!final.instances.some((t:any)=>t.template_id===archived));assert.equal(new Set(final.instances.map((t:any)=>t.id)).size,101);
 assert.equal((await f.pool.query('SELECT count(*) FROM wallet_ledger')).rows[0].count,'0');

 }finally{await f.close();}
});
test('R04 unpinned long-term tasks cannot displace current daily tasks on home',async()=>{
 const f=await fixture();try{await f.template({category:'main'});await f.template({category:'weekly'});await f.template({category:'monthly'});const daily=await f.template();const home=await f.ok('GET','home');assert.deepEqual(home.tasks.map((t:any)=>t.id),[daily.instance.id]);
 }finally{await f.close();}
});
