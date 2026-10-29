import {DateTime} from 'luxon';
import {parseDto} from '../../../../packages/contracts/src/v03/index.js';
import {reportPeriod} from '../../../../packages/domain/src/phase2/report-time.js';
import {randomUUID} from 'node:crypto';
import type {Client} from '../../../../packages/db/src/client.js';
import {requireThat} from '../../../../packages/domain/src/index.js';
import type {CompiledAction} from '../../../../packages/ai/src/v03/compiler.js';
import {explicitFact,verifyFields,verifiedTime,verifyValue,defaultObservationTime} from './sources.js';
import {readProfile} from '../user-home.js';
import type {PlanningService} from './service.js';
const j=JSON.stringify;
export async function executeExtended(service:PlanningService,c:Client,user:string,a:CompiledAction,context:any,parent:string):Promise<boolean>{
 const d=a.data,core=service.core;
 if(a.entity_type==='module'){await core.executeInTransaction(c,user,'POST','modules',{id:a.id,...d});return true;}
 if(a.entity_type==='record'){
  requireThat(explicitFact(context.original_text)||a.action_type==='record.correct','CLARIFICATION_REQUIRED','仅可记录已明确发生的事实；计划或假设不会保存为记录。',409);
  const old=a.action_type==='record.correct'?(await c.query('SELECT r.*,ARRAY(SELECT task_id FROM record_tasks t WHERE t.user_id=r.user_id AND t.record_id=r.id) task_ids FROM records r WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL',[user,d.record_ref])).rows[0]:null;
  if(old)a.before={values:old.values,occurred_at:new Date(old.occurred_at).toISOString(),version:old.version,record:old};
  const frozen=old?context.records.find((r:any)=>r.id===old.id):null;
  if(old)requireThat(frozen&&frozen.version===old.version,'VERSION_CONFLICT','来源记录已变化。',409);
  if(old&&!context.selected_refs?.some((r:any)=>r.entity_type==='record'&&r.id===old.id)){const text=[context.original_text,...context.answers].join(' '),anchor=DateTime.fromISO(context.received_at,{zone:context.timezone});let date:string|null=null;if(/今天|昨天|前天/.test(text))date=anchor.plus({days:/前天/.test(text)?-2:/昨天/.test(text)?-1:0}).toISODate();else date=text.match(/\d{4}-\d{2}-\d{2}/)?.[0]??null;let candidates=(await c.query("SELECT id,occurred_at FROM records WHERE user_id=$1 AND record_type_id=$2 AND deleted_at IS NULL AND status='confirmed' ORDER BY occurred_at DESC,id LIMIT 1001",[user,old.record_type_id])).rows;if(date)candidates=candidates.filter(r=>DateTime.fromJSDate(r.occurred_at,{zone:context.timezone}).toISODate()===date);else if(/最近|上一条|上次/.test(text))candidates=candidates.slice(0,1);requireThat(candidates.length===1&&candidates[0].id===old.id,'CLARIFICATION_REQUIRED','存在多条候选记录，请先在记录详情选择要纠正的一条，或补充唯一的发生日期。',409);}
  const module=old?.module_id??d.module_ref,type=await core.type(c,user,module,old?.record_type_id??d.record_type_ref),values=old?{...old.values,...d.values_patch}:d.values;
  requireThat(d.provenance.every((p:any)=>context.evidence_refs.includes(p.evidence_ref)),'INVALID_PROVENANCE','字段证据不在冻结上下文中。');
  const provenance=verifyFields(old?d.values_patch:d.values,d.provenance,context,type.fields);
  const oldSource=old?(await c.query('SELECT * FROM record_sources WHERE user_id=$1 AND record_id=$2 AND version=$3',[user,old.id,old.version])).rows[0]:null;
  if(old)a.before.source=oldSource;
  if(old&&d.occurred_at)requireThat(d.time_precision&&d.time_basis,'CLARIFICATION_REQUIRED','改时间需要同时确认精度与依据。',409);
  const time=old&&!d.occurred_at?{occurred_at:new Date(old.occurred_at).toISOString(),time_precision:oldSource?.time_precision??'approximate',time_basis:oldSource?.time_basis??'authorized_context'}:verifiedTime(d,context);
  const taskIds:string[]=[];for(const ref of old?.task_ids??d.task_refs){if(typeof ref==='string')taskIds.push(ref);else{const instance=(await c.query('SELECT task_id FROM task_instance_details WHERE user_id=$1 AND template_id=$2 ORDER BY period_start DESC LIMIT 1',[user,ref.template_instance_ref])).rows[0];requireThat(instance,'CLARIFICATION_REQUIRED','所选未来模板尚无当前实例，请移除关联或调整日期。',409);taskIds.push(instance.task_id);}}
  if(time.time_precision!=='instant')for(const taskId of taskIds){const task=(await c.query('SELECT definition FROM tasks WHERE user_id=$1 AND id=$2',[user,taskId])).rows[0];requireThat(!task?.definition?.requires_exact_time,'CLARIFICATION_REQUIRED','该任务需要精确时刻。');}
  const payload={module_id:module,record_type_id:type.id,schema_version:type.schema_version,occurred_at:time.occurred_at,timezone:d.timezone??old?.timezone??context.timezone,status:'confirmed',values,task_ids:taskIds};
  const row:any=await core.executeInTransaction(c,user,old?'PUT':'POST',old?'records/'+old.id:'records',old?{...payload,base_version:old.version}:{...payload,id:a.id});
  const keep=(oldSource?.provenance??[]).filter((p:any)=>!(p.field_key in (d.values_patch??{})));
  for(const estimate of d.estimated_values??[])requireThat(estimate.evidence_refs.every((ref:string)=>context.evidence_refs.includes(ref)),'INVALID_PROVENANCE','估算来源无效。');
  await c.query('INSERT INTO record_sources(user_id,record_id,version,provenance,estimated_values,time_precision,time_basis,source_run_id,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[user,row.id,row.version,j([...keep,...provenance]),j(d.estimated_values??oldSource?.estimated_values??[]),time.time_precision,time.time_basis,parent,context.received_at]);
  return true;
 }
 if(a.entity_type==='profile'){
  requireThat(!/(?:如果|假如|是不是|是否|吗|？|预计)/.test(context.original_text),'CLARIFICATION_REQUIRED','资料更新需要明确自述，不能使用假设或提问。',409);
  const profile=await readProfile(c,user),staticFields=[];a.generated_records=[];a.before=profile.module_fields.filter((f:any)=>d.updates.some((u:any)=>u.field_ref===f.id));
  requireThat(profile.version===context.profile_version,'VERSION_CONFLICT','个人资料已变化。',409);
  for(const update of d.updates){const f=profile.module_fields.find((f:any)=>f.id===update.field_ref),frozen=context.profile_fields.find((f:any)=>f.id===update.field_ref);requireThat(f&&frozen&&f.kind!=='derived','INVALID_REFERENCE','派生字段不可写，或字段未获授权。');
   const source=context.evidence.find((e:any)=>e.ref===update.evidence_ref);requireThat(source?.kind==='user','INVALID_PROVENANCE','资料更新需要当前用户的明确自述。');
   // Require an actual value occurrence, not merely a valid evidence identity.
   verifyValue(update.value,{evidence_ref:update.evidence_ref,source_type:'user_statement',quote:source.text,original_value:update.value,original_unit:f.unit},context,f);
   if(f.kind==='observation'){
    const type=await core.type(c,user,f.module_id,f.binding.record_type_id),valueFields=type.fields.filter((x:any)=>x.key!==f.binding.field_key&&x.required);requireThat(valueFields.length===0,'CLARIFICATION_REQUIRED','观测模板还有必填字段，请补充后用记录入口保存。',409);
    const time=update.occurred_at?verifiedTime({...update,timezone:context.timezone},context):defaultObservationTime(context);
    const recordId=randomUUID();a.generated_records!.push(recordId);await core.executeInTransaction(c,user,'POST','profile/observations',{id:recordId,field_id:f.id,binding_fingerprint:frozen.binding_fingerprint,value:update.value,occurred_at:time.occurred_at,timezone:context.timezone,context_values:{}});
    await c.query("INSERT INTO record_sources(user_id,record_id,version,provenance,estimated_values,time_precision,time_basis,source_run_id,received_at) VALUES($1,$2,1,$3,'[]',$6,$7,$4,$5)",[user,recordId,j([{field_key:f.binding.field_key,source_type:'user_statement',evidence_ref:update.evidence_ref,quote:source.text,original_value:update.value,original_unit:f.unit}]),parent,context.received_at,time.time_precision,time.time_basis]);
   }else{const {binding_fingerprint,source_ref,unavailable,...field}=f;staticFields.push({...field,value:update.value});}
  }
  if(staticFields.length)await core.executeInTransaction(c,user,'PATCH','profile',{base_version:profile.version,field_upserts:staticFields});
  return true;
 }
 if(a.action_type==='task_template.change'){
  const old=context.task_templates.find((t:any)=>t.id===d.template_ref);requireThat(old,'INVALID_REFERENCE','任务模板不可用。');
  a.before={template:old,definition:old.definition,next_definition:old.next_definition,effective_at:old.effective_at,version:old.version};
  const changes=structuredClone(d.changes);if(changes.rule){changes.rule.record_type_id=changes.rule.record_type_ref;delete changes.rule.record_type_ref;}
  await saveQuote(c,user,a,old.version+1,parent);await core.executeInTransaction(c,user,'PATCH','task-templates/'+d.template_ref,{base_version:old.version,...changes});return true;
 }
 if(a.entity_type==='report'){parseDto('ReportGenerateInput',{...d,force_new_revision:false});await service.reports.scope(c,user,d.module_ids);reportPeriod(d,new Date(context.received_at));return true;}
 if(a.entity_type==='report_schedule'){
  const {kind,...config}=d,old=(await service.reports.schedules(user,c)).find(s=>s.kind===kind)!;
  a.before=old;
  requireThat(old.version===(context.report_schedules.find((s:any)=>s.kind===kind)?.version??1),'VERSION_CONFLICT','报告日程已变化。',409);
  a.result=await service.reports.saveSchedule(c,user,kind,{base_version:old.version,...config,preview_token:null},true);return true;
 }
 return false;
}
export async function saveQuote(c:Client,user:string,a:CompiledAction,version:number,parent:string){if(a.reward_quote){const q=a.reward_quote;await c.query('INSERT INTO reward_quotes(user_id,template_id,template_version,rule_hash,category,amount,source,rationale,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,template_id,template_version) DO NOTHING',[user,a.id,version,q.rule_hash,q.category,q.amount,q.source,q.rationale,parent]);}}
