import {ApiClientError,generateUuid,isUnknownNetworkError} from './api.js';
import {computeConfigPayloadSignature,getPendingConfigMutation,prepareConfigMutationEnvelope,savePendingConfigMutation,clearPendingConfigMutation,getStorageIssue} from './storage.js';
import type {ConfigMutationKind} from './types.js';
// Persist the exact command before sending. Later edits never alter a pending operation.
export async function submitPhase2Command<T,R>(kind:ConfigMutationKind,key:string,entityId:string,payload:T,send:(frozen:T,operation:string)=>Promise<R>){
 const signature=computeConfigPayloadSignature(kind,payload),old=getPendingConfigMutation<T>(key);
 const prepared=prepareConfigMutationEnvelope({kind,draftKey:key,candidateEntityId:entityId,candidatePayload:payload,signature,allocateUuid:generateUuid});
 const pending={kind,draftKey:key,entityId:prepared.entityId,operationId:prepared.operationId,payloadSignature:old?.payloadSignature??signature,frozenPayload:prepared.payload,savedAt:old?.savedAt??new Date().toISOString(),lastError:{code:'AWAITING_RECEIPT',message:'等待确认'}};
 if(!savePendingConfigMutation(pending))throw new ApiClientError(400,{code:'LOCAL_STORAGE_FAILED',message:getStorageIssue()??'本机保存失败，尚未发送'});
 try{const result=await send(prepared.payload,prepared.operationId);clearPendingConfigMutation(key);return {result,payload:prepared.payload,hadNewEdits:Boolean(old&&old.payloadSignature!==signature)};}
 catch(error){if(!isUnknownNetworkError(error))clearPendingConfigMutation(key);throw error;}
}
