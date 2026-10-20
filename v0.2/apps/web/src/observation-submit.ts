import type {Phase2EventContext} from './main.js';
import {api,ApiClientError,generateUuid,isUnknownNetworkError} from './api.js';
import {extractConfigFormDraft} from './forms.js';
import {saveConfigDraft,clearConfigDraft,getStorageIssue,getPendingConfigMutation} from './storage.js';
import {submitPhase2Command} from './phase2-submit.js';
import type {ObservationWriteInput} from './types.js';
export async function submitObservation(form:HTMLFormElement,ctx:Phase2EventContext){
 const {state,data,renderModalRegionOnly,refreshBootstrapAndNotify,describeApiError}=ctx;

      const obs=state.observationForm;if(!obs)return;
      const fd=new FormData(form),field=(state.profile?.module_fields??[]).find(f=>f.id===obs.fieldId);
      if(!field)return;
      const key=`phase2:observation:${field.id}`;
      const mode=String(fd.get('obs_mode')??'new');
      const value=String(fd.get('value')??'').trim();
      const context_values:Record<string,string|number|boolean|null>={};
      const tpl=data.record_types.find(t=>t.id===field.binding?.record_type_id);
      for(const f of tpl?.fields??[]){if(f.key===field.binding?.field_key)continue;const raw=fd.get('ctx_'+f.key);if(raw===null)continue;const v=String(raw);context_values[f.key]=f.type==='integer'?Number(v):f.type==='boolean'?v==='true':v;}
      obs.rawValue=value;obs.occurredAt=String(fd.get('occurred_at')??'');obs.timezone=String(fd.get('timezone')??'');obs.mode=mode==='correct'?'correct':'new';
      obs.contextValues=Object.fromEntries(Object.entries(context_values).map(([k,v])=>[k,String(v)]));
      const payload:ObservationWriteInput={id:obs.entityId,field_id:field.id,binding_fingerprint:obs.bindingFingerprint,occurred_at:obs.occurredAt,timezone:obs.timezone,value:field.type==='integer'?Number(value):value,context_values};
      if(mode==='correct'){payload.source_record_id=String(fd.get('source_record_id')??'');payload.source_base_version=Number(fd.get('source_base_version'));}
      const draft=extractConfigFormDraft(form,state);if(draft&&!saveConfigDraft(draft)){obs.validationError={code:'LOCAL_STORAGE_FAILED',message:getStorageIssue()??'未保存本机，尚未发送'};renderModalRegionOnly(true);return;}
      state.submittingModal=true;obs.submissionStatus='submitting';obs.validationError=null;obs.conflictError=null;renderModalRegionOnly(true);
      try{
        const saved=await submitPhase2Command('write-observation',key,obs.entityId,payload,(p,key)=>api.writeProfileObservation(p,key));
        obs.submissionStatus='confirmed_server';obs.operationId=null;
        if(saved.hadNewEdits){obs.entityId=generateUuid();if(draft)saveConfigDraft({...draft,entityId:obs.entityId});obs.lastImpactSummary='上次提交已确认；你后来编辑的内容仍未提交。请核对后再次保存。';}
        else{clearConfigDraft('observation:'+field.id);state.activeModal=null;state.observationForm=null;}
        await refreshBootstrapAndNotify(saved.hadNewEdits?'已确认上次观测，后续编辑尚未提交':'观测来源记录已保存，相关数值、任务、成就和钱包已重算',true,true);
      }catch(error){
        if(error instanceof ApiClientError&&['BINDING_CONFLICT','BINDING_PRECONDITION_REQUIRED'].includes(error.code))obs.bindingConflict=(error.details as any)?.current;
        const d=describeApiError(error);obs.submissionStatus=isUnknownNetworkError(error)?'unknown_network':error instanceof ApiClientError&&error.status===409?'conflict_pending':'validation_error';
        if(obs.submissionStatus==='conflict_pending')obs.conflictError={code:d.code??'VERSION_CONFLICT',message:d.message};else obs.validationError={code:d.code??'ERROR',message:d.message};
        obs.operationId=getPendingConfigMutation(key)?.operationId??null;
        renderModalRegionOnly(true);
      }finally{state.submittingModal=false;renderModalRegionOnly(true);}
      return;
    
}
