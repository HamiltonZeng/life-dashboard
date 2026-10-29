import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {calculateTrend} from '../../packages/domain/src/phase2/trends.js';
import {fixture,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from './support.js';
const id=randomUUID(),template=randomUUID();
const metric={id,version:1,definition:{id,module_id:randomUUID(),record_type_id:template,name:'test',unit:'unit',aggregation:'sum' as const,field_key:'n',window:'all_time' as const,timezone:'Asia/Shanghai'}};
const fact=(date:string,value:string)=>({id:randomUUID(),record_type_id:template,occurred_at:date+'T12:00:00+08:00',values:{n:value},task_ids:[]});
test('C2 exact daily mean, null/zero, negative half rounding and incomplete buckets',()=>{
 const q={range:'month',grain:'3d'},now=new Date('2026-10-03T14:00:00Z');
 const t=calculateTrend(metric,[fact('2026-10-01','10'),fact('2026-10-02','15')],q,now);assert.equal(t.buckets[0].value,'12.5');assert.equal(t.buckets[0].display_value,'13');assert.equal(t.buckets[0].valid_days,2);assert.equal(t.buckets[0].expected_days,3);assert.equal(t.daily_values[2].value,null);assert.equal(t.buckets[0].incomplete,true);
 assert.equal(calculateTrend(metric,[fact('2026-10-01','0')],q,now).buckets[0].value,'0');
 assert.equal(calculateTrend(metric,[fact('2026-10-01','-1'),fact('2026-10-02','-2')],q,now).buckets[0].display_value,'-2');
 const avg={...metric,definition:{...metric.definition,aggregation:'avg' as const}};
 const uneven=calculateTrend(avg,[fact('2026-10-01','10'),fact('2026-10-01','10'),fact('2026-10-02','15')],q,now);assert.equal(uneven.buckets[0].value,'12.5','Average is over daily values, not all raw records');
});
test('C2 every range/grain, natural months and latest never carries forward',()=>{
 const combos={last_7_days:['1d'],month:['1d','2d','3d'],quarter:['3d','4d','5d','6d','7d'],year:['7d','14d','21d','1mo']};
 for(const [range,grains] of Object.entries(combos))for(const grain of grains){const r=calculateTrend(metric,[],{range,grain},new Date('2026-10-20T12:00:00Z'));assert.equal(r.buckets.reduce((n,b)=>n+b.expected_days,0),r.daily_values.length);assert.ok(r.buckets.every(b=>b.value===null));}
 const months=calculateTrend(metric,[],{range:'year',grain:'1mo'},new Date('2026-10-20T12:00:00Z'));assert.equal(months.buckets[1].expected_days,28);assert.equal(months.buckets.length,10);
 const latest=calculateTrend({...metric,definition:{...metric.definition,aggregation:'latest'}},[fact('2026-10-01','70')],{range:'month'},new Date('2026-10-03T12:00:00Z'));assert.equal(latest.daily_values[1].value,null);
 assert.throws(()=>calculateTrend(metric,[],{range:'month',grain:'7d'}),{code:'INVALID_GRAIN'});
});
test('C2 exclusions are one-pass, range-level, reversible and view-only',()=>{
 const facts=['1','1','1','1','100'].map((v,i)=>fact('2026-10-0'+(i+1),v)),now=new Date('2026-10-05T12:00:00Z'),query={range:'month',variance_enabled:'true'};
 const a=calculateTrend(metric,facts,{...query,grain:'1d'},now),b=calculateTrend(metric,facts,{...query,grain:'3d'},now);assert.deepEqual(a.exclusions.applied_dates,['2026-10-05']);assert.deepEqual(a.exclusions,b.exclusions);assert.equal(a.daily_values[4].value,'100');assert.equal(a.daily_values[4].excluded,true);
 const all=calculateTrend(metric,facts,{...query,include_all:'true'},now);assert.deepEqual(all.exclusions.applied_dates,[]);assert.equal(all.coverage.included_days,5);assert.equal(all.daily_values[4].marked_for_exclusion,true);
 const few=calculateTrend(metric,facts.slice(0,2),query,now);assert.equal(few.exclusions.fallback_reason,'insufficient_samples');
 const zero=calculateTrend(metric,facts.slice(0,4),{...query,minimum_days:3},now);assert.equal(zero.exclusions.fallback_reason,'zero_variance');
 const fallback=calculateTrend(metric,facts,{range:'month',exclude_dates:'2026-10-01,2026-10-02,2026-10-03,2026-10-04'},now);assert.equal(fallback.exclusions.fallback_reason,'too_few_remaining');assert.deepEqual(fallback.exclusions.applied_dates,[]);
});
test('C2 trend API uses real scoped records and filtering does not mutate any user data',async()=>{
 const f=await fixture();try{
  const m=await f.ok('POST','metrics',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],record_type_id:DEFAULT_TEMPLATE_IDS[0],name:'trend',unit:'分钟',aggregation:'sum',field_key:'duration_minutes',window:'all_time',timezone:'Asia/Shanghai',display_precision:2});
  await f.record('2026-10-19T01:00:00Z',10);await f.record('2026-10-20T01:00:00Z',15);
  const before=await f.ok('GET','export'),t=await f.ok('GET',`metrics/${m.id}/trend?range=month&grain=3d&exclude_dates=2026-10-19`);assert.equal(t.precision,2);assert.equal(t.coverage.valid_days,2);assert.ok(t.source_refs.every((r:any)=>r.version===1));assert.deepEqual((await f.ok('GET','export')).data,before.data);
  assert.equal((await f.req('GET',`metrics/${m.id}/trend?range=month&grain=7d`)).statusCode,422);assert.equal((await f.req('GET',`metrics/${randomUUID()}/trend`)).statusCode,404);
 }finally{await f.close();}
});
