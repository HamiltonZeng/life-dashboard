import {test} from 'node:test';
import assert from 'node:assert/strict';
import {computePayloadSignature,savePendingMutation,prepareRecordMutationEnvelope,getPendingMutation,clearAllBrowserStorageForTest,saveRecordDraft,getStorageIssue} from '../apps/web/src/storage.js';
import {api,isUnknownNetworkError,ApiClientError} from '../apps/web/src/api.js';
const payload={id:'30000000-0000-4000-8000-000000000001',module_id:'10000000-0000-4000-8000-000000000001',record_type_id:'20000000-0000-4000-8000-000000000001',schema_version:1,occurred_at:'2026-10-19T01:00:00Z',timezone:'Asia/Shanghai',status:'confirmed' as const,values:{topic:'fixture'},task_ids:[]};
test('M2/M4: frozen pending survives edited values, event time and timezone',()=>{
  clearAllBrowserStorageForTest();const signature=computePayloadSignature({...payload,mode:'create'});
  savePendingMutation({draftKey:'fixture',operationId:'original',recordId:payload.id,mode:'create',payloadSignature:signature,frozenPayload:payload,lastError:{code:'UNKNOWN',message:''},savedAt:'2026-10-19'});
  for(const change of [{values:{topic:'new'}},{occurred_at:'2026-10-20T01:00:00Z'},{timezone:'UTC'}]){
    const modified={...payload,...change};const sig=computePayloadSignature({...modified,mode:'create'});assert.notEqual(sig,signature);
    const prepared=prepareRecordMutationEnvelope({draftKey:'fixture',mode:'create',candidateRecordId:'other',candidatePayload:modified,signature:sig,allocateUuid:()=>{throw Error('must not allocate');}});
    assert.equal(prepared.operationId,'original');assert.deepEqual(prepared.payload,payload);assert.equal(getPendingMutation('fixture')?.operationId,'original');
  }
  clearAllBrowserStorageForTest();
});
test('M3: blocked and corrupted browser storage never claims successful persistence',()=>{
  const old=(globalThis as any).window;
  try{
    (globalThis as any).window={localStorage:{getItem:()=>null,setItem:()=>{throw Error('quota');}}};
    assert.equal(saveRecordDraft({draftKey:'x'} as any),false);assert.match(getStorageIssue()!,/未保存/);
    let wrote=false;(globalThis as any).window={localStorage:{getItem:()=>'{invalid',setItem:()=>{wrote=true;}}};
    assert.equal(saveRecordDraft({draftKey:'x'} as any),false);assert.equal(wrote,false);
  }finally{if(old===undefined)delete (globalThis as any).window;else (globalThis as any).window=old;}
});
test('M6: malformed or incomplete successful write response is unknown, 500 is unknown',async()=>{
  const previous=globalThis.fetch;
  try{
    for(const body of ['invalid','{}','{"data":{}}','{"data":{"id":"wrong","version":1}}']){
      globalThis.fetch=async()=>new Response(body,{status:200});
      await assert.rejects(api.createRecord(payload,'original'),(e:any)=>e.code==='BAD_RECEIPT'&&isUnknownNetworkError(e));
    }
    assert.equal(isUnknownNetworkError(new ApiClientError(500,{code:'INTERNAL_ERROR',message:''})),true);
  }finally{globalThis.fetch=previous;}
});
test('valid template acknowledgement uses schema_version rather than an absent row version',async()=>{
  const old=globalThis.fetch;
  try{globalThis.fetch=async(_url,init)=>new Response(JSON.stringify({data:{...JSON.parse(init!.body as string),schema_version:1},operation_id:(init!.headers as Record<string,string>)['Idempotency-Key']}),{status:200});
    const row=await api.createRecordType({id:payload.record_type_id,module_id:payload.module_id,name:'fixture',fields:[]},'key');assert.equal(row.schema_version,1);
  }finally{globalThis.fetch=old;}
});
