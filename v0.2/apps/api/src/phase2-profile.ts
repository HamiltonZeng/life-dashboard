import {bindingFingerprint,bindingDescriptor} from './observation-binding.js';
import type {Client} from '../../../packages/db/src/client.js';
import type {Core} from './phase2-core.js';
import {observationInput} from '../../../packages/contracts/src/phase2.js';
import {calculateMetric,requireThat,DomainError} from '../../../packages/domain/src/index.js';
export async function validateBinding(core:Core,c:Client,user:string,f:any){
 if(f.kind==='observation'){
  const t=await core.type(c,user,f.module_id,f.binding.record_type_id),field=t.fields.find((x:any)=>x.key===f.binding.field_key);
  requireThat(field&&field.type===f.type&&field.unit===f.unit,'INVALID_BINDING','Observation requires the same numeric type and unit as its source field');
 }else if(f.kind==='derived'){
  const m=(await c.query('SELECT * FROM metric_definitions WHERE user_id=$1 AND id=$2 AND module_id=$3 AND archived_at IS NULL',[user,f.binding.metric_id,f.module_id])).rows[0];
  requireThat(m&&m.definition.unit===f.unit,'INVALID_BINDING','Derived field requires an active metric with the same unit');
 }
}
export async function hydrateFields(core:Core,c:Client,user:string,fields:any[]){
 const facts=await core.facts(c,user),active=new Set((await c.query("SELECT id FROM modules WHERE user_id=$1 AND status='enabled'",[user])).rows.map(r=>r.id));
 const metrics=new Map((await c.query('SELECT * FROM metric_definitions WHERE user_id=$1 AND archived_at IS NULL',[user])).rows.map(m=>[m.id,m]));
 return fields.map(f=>{
  if(!f.binding)return f;
  if(!active.has(f.module_id))return {...f,value:null,source_ref:null,unavailable:true};
  if(f.kind==='observation'){
   const sources=facts.filter((r:any)=>r.module_id===f.module_id&&r.record_type_id===f.binding.record_type_id&&Date.parse(r.occurred_at)<=core.now().getTime()&&r.values[f.binding.field_key]!==null&&r.values[f.binding.field_key]!==undefined).sort((a:any,b:any)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at)||a.id.localeCompare(b.id));
   const r:any=sources[0];return {...f,value:r?.values[f.binding.field_key]??null,source_ref:r?{record_id:r.id,version:r.version,occurred_at:r.occurred_at,record_type_id:r.record_type_id,field_key:f.binding.field_key}:null};
  }
  const m=metrics.get(f.binding.metric_id);
  if(!m||m.module_id!==f.module_id)return {...f,value:null,source_ref:null,unavailable:true};
  const computed=calculateMetric(m.definition,facts,core.now());return {...f,value:computed.value,source_ref:{metric_id:m.id,source_record_ids:computed.source_record_ids,evaluated_at:core.now().toISOString()}};
 });
}
export async function executeObservation(core:Core,c:Client,user:string,raw:unknown){
 const d=observationInput.parse(raw),f=(await c.query("SELECT * FROM profile_fields WHERE user_id=$1 AND id=$2 AND kind='observation'",[user,d.field_id])).rows[0];
 requireThat(f,'INVALID_REFERENCE','Observation field not found');await core.module(c,user,f.module_id);
 if(!d.binding_fingerprint)throw new DomainError('BINDING_PRECONDITION_REQUIRED','Reload the observation field and explicitly confirm its binding before submitting',428,{current:bindingDescriptor(f)});
 if(d.binding_fingerprint!==bindingFingerprint(f))throw new DomainError('BINDING_CONFLICT','Observation binding changed; review the latest mapping before confirming',409,{current:bindingDescriptor(f)});
 await validateBinding(core,c,user,f);
 requireThat(Date.parse(d.occurred_at)<=core.now().getTime(),'INVALID_OCCURRENCE','Observation cannot be in the future');
 requireThat((d.source_record_id===undefined)===(d.source_base_version===undefined),'INVALID_REFERENCE','Correction requires source ID and version together');
 requireThat(!(f.binding.field_key in d.context_values),'INVALID_FIELDS','Context cannot replace the bound value');
 const type=await core.type(c,user,f.module_id,f.binding.record_type_id);let old:any;
 if(d.source_record_id){old=(await c.query('SELECT r.*,ARRAY(SELECT task_id FROM record_tasks l WHERE l.user_id=r.user_id AND l.record_id=r.id) task_ids FROM records r WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL',[user,d.source_record_id])).rows[0];requireThat(old&&old.module_id===f.module_id&&old.record_type_id===f.binding.record_type_id,'INVALID_REFERENCE','Correction source is incompatible');}
 const body={id:d.id,module_id:f.module_id,record_type_id:type.id,schema_version:type.schema_version,occurred_at:d.occurred_at,timezone:d.timezone,status:'confirmed',values:{...(old?.values??{}),...d.context_values,[f.binding.field_key]:d.value},task_ids:old?.task_ids??[]};
 const {id,...update}=body;
 const record=await core.execute(c,user,old?'PUT':'POST',old?`records/${old.id}`:'records',old?{...update,base_version:d.source_base_version}:body);
 return {record};
}
