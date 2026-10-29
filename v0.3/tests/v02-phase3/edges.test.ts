import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS,LOCAL_USER_ID} from '../v02-phase2/support.js';
import {Service} from '../../apps/api/src/service.js';
import {selectHomeTasks} from '../../packages/domain/src/phase2/home-tasks.js';
import {guardSynthetic} from './guard.js';
const module_id=DEFAULT_MODULE_IDS[0],record_type_id=DEFAULT_TEMPLATE_IDS[0];
test('R03 missing precondition, field/type/unit changes, explicit adoption and old successful protocol replay',async()=>{
 const f=await fixture();try{
 const source=await f.ok('POST','record-types',{id:randomUUID(),module_id,name:'binding revisions synthetic',fields:[{key:'x',label:'x',type:'integer',unit:'次',required:false},{key:'y',label:'y',type:'integer',unit:'次',required:false},{key:'z',label:'z',type:'decimal',unit:'米',required:false}]});
 let field:any={id:randomUUID(),module_id,key:'obs',label:'synthetic',kind:'observation',type:'integer',unit:'次',value:null,options:[],binding:{record_type_id:source.id,field_key:'x'}};
 let p=await f.ok('PATCH','profile',{base_version:1,field_upserts:[field]});
 const draft:any={id:randomUUID(),field_id:field.id,occurred_at:'2026-10-20T09:00:00Z',timezone:'Asia/Shanghai',value:10,context_values:{}};
 const before=await f.ok('GET','export');assert.equal((await f.req('POST','profile/observations',draft)).statusCode,428);assert.deepEqual((await f.ok('GET','export')).data,before.data);
 // Generate the exact old successful receipt using the frozen d9ab408 service (no fingerprint).
 const Old=(await import(new URL('../../.runtime/phase2-compat/v0.2/apps/api/src/service.ts',import.meta.url).href)).Service;
 const old=new Old(f.pool,f.now),key=randomUUID(),receipt=await old.mutate(LOCAL_USER_ID,key,'POST','profile/observations',draft);
 let fingerprint=(await f.ok('GET','profile')).module_fields[0].binding_fingerprint;
 for(const change of [{binding:{record_type_id:source.id,field_key:'y'}},{binding:{record_type_id:source.id,field_key:'z'},type:'decimal',unit:'米'}]){
  field={...field,...change};p=await f.ok('PATCH','profile',{base_version:p.version,field_upserts:[field]});const snapshot=await f.ok('GET','export');
  const r=await f.req('POST','profile/observations',{...draft,id:randomUUID(),binding_fingerprint:fingerprint});assert.equal(r.statusCode,409,r.body);assert.equal(r.json().error.code,'BINDING_CONFLICT');assert.deepEqual((await f.ok('GET','export')).data,snapshot.data);
  fingerprint=(await f.ok('GET','profile')).module_fields[0].binding_fingerprint;
 }
 const current=new Service(f.pool,f.now);assert.deepEqual(await current.mutate(LOCAL_USER_ID,key,'POST','profile/observations',draft),JSON.parse(JSON.stringify(receipt)));
 const adopted=await f.ok('POST','profile/observations',{...draft,id:randomUUID(),binding_fingerprint:fingerprint,value:'12.5'});assert.equal(adopted.record.values.z,'12.5');
 assert.equal((await f.pool.query('SELECT count(*) FROM records')).rows[0].count,'2');
 }finally{await f.close();}
});
for(const count of [51,100])test(`R02 ${count} templates, archive/add, explicit limit and long offline gap`,async()=>{
 const f=await fixture('2030-01-31T12:00:00Z');try{
 const templates=[];for(let i=0;i<count;i++)templates.push(await f.template({category:i%2?'monthly':'daily'}));
 const first=templates[0];await f.ok('PATCH','task-templates/'+first.template.id,{base_version:1,status:'archived'});await f.template({title:'added concurrently before next request'});
 f.setNow('2031-03-01T12:00:00Z');const r=await f.ok('POST','task-instances/materialize',{});assert.equal(r.total_templates,count);assert.equal(new Set(r.instances.map((t:any)=>t.id)).size,count);assert.ok(r.instances.every((t:any)=>Date.parse(t.period.start)<=f.now().getTime()&&Date.parse(t.period.end)>f.now().getTime()));
 const again=await f.ok('POST','task-instances/materialize',{});assert.deepEqual(again.instances.map((t:any)=>t.id),r.instances.map((t:any)=>t.id));assert.ok(again.reused.every(Boolean));
 assert.equal((await f.req('POST','task-instances/materialize',{template_ids:templates.map(t=>t.template.id)})).statusCode,400);
 assert.equal((await f.pool.query('SELECT count(*) FROM wallet_ledger')).rows[0].count,'0');
 const snap=await f.ok('GET','export');await f.ok('GET','home');await f.ok('GET','task-instances');await f.ok('GET','profile');assert.deepEqual((await f.ok('GET','export')).data,snap.data);
 }finally{await f.close();}
});
test('R02 DST day has correct next deadline and exact boundary is exclusive',async()=>{
 const f=await fixture('2030-03-10T06:59:59Z');try{const t=await f.template({timezone:'America/New_York'});let r=await f.ok('POST','task-instances/materialize',{});assert.equal(Date.parse(r.next_check_at)-Date.parse(t.instance.period.start),23*3600000);f.setNow(r.next_check_at);r=await f.ok('POST','task-instances/materialize',{});assert.notEqual(r.instances[0].id,t.instance.id);assert.equal(r.instances[0].period.start,t.instance.period.end);}finally{await f.close();}
});
test('R04 valid ordered pins, deduplication, legacy day and invalid terminal pins before five-item cap',()=>{
 const now=new Date('2030-02-01T12:00:00Z');const row=(id:string,extra:any={})=>({id,template_id:'t'+id,module_status:'enabled',template_status:'enabled',phase2:true,category:'daily',status:'pending',definition:{},period_start:'2030-01-31T16:00:00Z',period_end:'2030-02-01T16:00:00Z',...extra});
 const rows=[row('old',{period_end:now.toISOString()}),row('done',{category:'main',status:'completed',period_end:null}),row('off',{module_status:'disabled'}),row('arch',{template_status:'archived'}),row('main',{category:'main',period_end:null}),...Array.from({length:6},(_,i)=>row('d'+i)),row('legacy',{phase2:false,definition:{business_date:'2030-02-01'}}),row('legacy-old',{phase2:false,definition:{business_date:'2030-01-31'}})];
 const pins=['old','done','off','arch','main','d0','legacy-old'].map(id=>({kind:'instance',id}));const r=selectHomeTasks(rows,pins,now,'Asia/Shanghai');assert.deepEqual(r.tasks.map(t=>t.id),['main','d0','d1','d2','d3']);assert.equal(r.total,8);
});
test('test guard rejects every mismatched safety variable before connecting or resetting',()=>{
 const keys=['NODE_ENV','PHASE3_ACCEPTANCE','ACCEPTANCE_PROJECT','DATABASE_HOST','DATABASE_NAME'];guardSynthetic();for(const key of keys){const old=process.env[key];try{process.env[key]='main';assert.throws(guardSynthetic);}finally{process.env[key]=old;}}
});
test('T2 grouped trend evaluation preserves the frozen engine outputs, zones, null/zero and source versions',async()=>{
 const {calculateTrend}=await import('../../packages/domain/src/phase2/trends.js');
 const old=await import(new URL('../../.runtime/phase2-compat/v0.2/packages/domain/src/phase2/trends.ts',import.meta.url).href);
 const facts=Array.from({length:40},(_,i)=>({id:randomUUID(),version:i+1,module_id,record_type_id,occurred_at:new Date(Date.parse('2026-03-20T12:00:00Z')-i*17*3600000).toISOString(),values:{duration_minutes:i%7===0?null:i%5},task_ids:[]}));
 for(const timezone of ['America/New_York','Asia/Shanghai'])for(const aggregation of ['count','sum','avg','latest'] as const)for(const range of ['last_7_days','month','quarter','year']){
 const id=randomUUID(),metric={id,version:1,definition:{id,module_id,record_type_id,name:'synthetic equivalence',unit:'分钟',aggregation,field_key:aggregation==='count'?null:'duration_minutes',window:'all_time' as const,timezone}};
 assert.deepEqual(calculateTrend(metric,facts,{range},new Date('2026-03-20T12:00:00Z')),old.calculateTrend(metric,facts,{range},new Date('2026-03-20T12:00:00Z')));
 }
});
