import {test} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {calculateMetric,taskProgress,validateValues,windowBounds,validateFields} from '../packages/domain/src/index.js';
import {recordInput, type MetricInput, type Field} from '../packages/contracts/src/index.js';
const metric:MetricInput={id:randomUUID(),module_id:randomUUID(),record_type_id:randomUUID(),name:'时长',unit:'分钟',aggregation:'sum',field_key:'n',window:'week',timezone:'Asia/Shanghai'};
const field:Field={key:'n',label:'时长',type:'decimal',required:true,unit:'分钟',options:[],minimum:0,maximum:null};
test('decimal aggregation is exact; missing values are unknown, observed zero remains zero',()=>{
  const fact=(n:unknown)=>({id:randomUUID(),record_type_id:metric.record_type_id,occurred_at:'2026-10-19T00:00:00Z',values:{n},task_ids:[]});
  const now=new Date('2026-10-19T12:00:00Z');
  assert.equal(calculateMetric(metric,[],now).value,null);
  assert.equal(calculateMetric(metric,[fact(null)],now).sample_count,0);
  assert.equal(calculateMetric(metric,[fact('0')],now).value,'0');
  assert.equal(calculateMetric(metric,[fact('0.1'),fact('0.2')],now).value,'0.3');
  assert.equal(calculateMetric({...metric,aggregation:'avg'},[fact('0.1'),fact('0.3')],now).value,'0.2');
  assert.equal(calculateMetric({...metric,aggregation:'count',field_key:null},[fact(null)],now).value,'1');
  assert.equal(calculateMetric(metric,Array.from({length:1000},()=>fact('999999999999.999999')),now).value,'999999999999999.999');
  assert.equal(calculateMetric({...metric,field_key:'constructor'},[fact(null)],now).value,null);
});
test('week starts Monday locally; day boundaries respect DST',()=>{
  assert.deepEqual(windowBounds('week','Asia/Shanghai',new Date('2026-10-18T17:00:00Z')),{start:'2026-10-18T16:00:00.000Z',end:'2026-10-25T16:00:00.000Z',period:'2026-10-19'});
  const day=windowBounds('day','America/New_York',new Date('2026-03-08T16:00:00Z'));
  assert.equal((Date.parse(day.end!)-Date.parse(day.start!))/3600000,23);
});
test('required record fields, decimals, calendar dates and unknown fields are enforced',()=>{
  assert.throws(()=>validateValues([field],{},true));
  assert.doesNotThrow(()=>validateValues([field],{},false));
  assert.doesNotThrow(()=>validateValues([{...field,key:'constructor',required:false}],{},true));
  assert.throws(()=>validateValues([field],{n:0.1},true));
  assert.throws(()=>validateValues([field],{n:'-1'},true));
  assert.throws(()=>validateValues([field],{n:'1',completed:true},true));
  assert.throws(()=>validateValues([{...field,type:'date',minimum:null}],{n:'2026-02-30'},true));
  assert.throws(()=>validateFields([field,field]));
  assert.throws(()=>validateFields([{...field,type:'single_select'}]));
});
test('task threshold applies per linked record rather than summing records',()=>{
  const task={id:randomUUID(),module_id:metric.module_id,title:'练习',record_type_id:metric.record_type_id,completion_mode:'record_required' as const,acceptance:{kind:'field_gte' as const,field_key:'n',threshold:'10'},timezone:'Asia/Shanghai',business_date:null};
  const facts=[1,2].map(()=>({id:randomUUID(),record_type_id:metric.record_type_id,occurred_at:new Date().toISOString(),values:{n:'5'},task_ids:[task.id]}));
  assert.equal(taskProgress(task,facts).status,'partial');
  facts[0].values.n='10';assert.equal(taskProgress(task,facts).status,'completed');
});
test('record contract rejects factual injection fields and invalid timezone',()=>{
  const r={id:randomUUID(),module_id:randomUUID(),record_type_id:randomUUID(),schema_version:1,occurred_at:new Date().toISOString(),timezone:'Mars/Test',status:'confirmed',values:{},task_ids:[]};
  assert.equal(recordInput.safeParse(r).success,false);
  assert.equal(recordInput.safeParse({...r,timezone:'Asia/Shanghai',unlocked:true}).success,false);
});
