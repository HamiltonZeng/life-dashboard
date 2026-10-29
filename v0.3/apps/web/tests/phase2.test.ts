import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateMutationReceipt,ApiClientError} from '../src/api.js';import {submitPhase2Command} from '../src/phase2-submit.js';import {clearAllBrowserStorageForTest,getPendingConfigMutation} from '../src/storage.js';
import {createInitialState,createInitialTrendControlState} from '../src/state.js';import {buildLocalFallbackTrend,renderTrendSvgChart,renderWalletSummaryCard} from '../src/phase2-views.js';
test('composite receipt validation rejects wrong operation, missing versions and mismatched instance ownership',()=>{
 const tpl={id:'template',version:1},instance={id:'task',version:2,template_id:'template'},r={operation_id:'op',data:{template:tpl,instance}};validateMutationReceipt('POST','/task-templates',{id:'template'},r,'op');
 for(const bad of [{...r,operation_id:'wrong'},{...r,data:{template:tpl,instance:null}},{...r,data:{template:tpl,instance:{...instance,version:undefined}}},{...r,data:{template:tpl,instance:{...instance,template_id:'foreign'}}}])assert.throws(()=>validateMutationReceipt('POST','/task-templates',{id:'template'},bad,'op'));
 assert.throws(()=>validateMutationReceipt('POST','/task-instances/materialize',{}, {operation_id:'op',data:{instances:[instance],reused:['yes']}},'op'));
});
test('unknown observation command preserves exact payload across edits and allocates a new key only after confirmation',async()=>{
 clearAllBrowserStorageForTest();let calls:any[]=[];const send=async(p:any,key:string)=>{calls.push({p,key});if(calls.length===1)throw new ApiClientError(0,{code:'NETWORK_ERROR',message:'lost acknowledgement'});return {version:1};};
 await assert.rejects(submitPhase2Command('write-observation','observation:field','record',{id:'record',value:'10'},send));assert.ok(getPendingConfigMutation('observation:field'));
 const confirmed=await submitPhase2Command('write-observation','observation:field','record',{id:'record',value:'15'},send);assert.equal(confirmed.hadNewEdits,true);assert.deepEqual(calls[0],calls[1]);assert.equal(getPendingConfigMutation('observation:field'),null);
 await submitPhase2Command('write-observation','observation:field','next-record',{id:'next-record',value:'15'},send);assert.notEqual(calls[1].key,calls[2].key);
});
test('definite conflicts release pending envelope but do not imply successful writes',async()=>{
 clearAllBrowserStorageForTest();await assert.rejects(submitPhase2Command('write-observation','observation:conflict','record',{id:'record',source_base_version:1},async()=>{throw new ApiClientError(409,{code:'VERSION_CONFLICT',message:'changed'});}));assert.equal(getPendingConfigMutation('observation:conflict'),null);
});
test('no fabricated trend or wallet on missing API data, null segments stay disconnected and zero is accessible',()=>{
 const state=createInitialState();const control=createInitialTrendControlState();const data:any={metrics:[{id:'metric',version:1,definition:{aggregation:'sum',window:'all_time',timezone:'Asia/Shanghai',unit:'分钟'},computed:{value:'10000',source_record_ids:['record']}}]};assert.equal(buildLocalFallbackTrend('metric',state,data,control),null);assert.ok(!renderWalletSummaryCard(state).includes('data-wallet-balance="0"'));
 const trend:any={metric_id:'m',unit:'kg',precision:0,start_date:'2026-10-01',end_date:'2026-10-03',buckets:[0,null,15].map((v,i)=>({start_date:'2026-10-0'+(i+1),end_date:'2026-10-0'+(i+1),value:v===null?null:String(v),display_value:v===null?null:String(v),valid_days:v===null?0:1,expected_days:1,incomplete:false,source_record_ids:[],excluded_dates:[]}))};const html=renderTrendSvgChart(trend);assert.ok(html.includes('data-point-value="0"'));assert.ok(html.includes('data-point-null="true"'));assert.ok(!html.includes('data-trend-segment="true"'));assert.ok(html.includes('tabindex="0"'));
});
