import {profileFieldKind} from '../../../../packages/contracts/src/phase2.js';
import {randomUUID} from 'node:crypto';
import type {Client} from '../../../../packages/db/src/client.js';
import {requireThat} from '../../../../packages/domain/src/index.js';
import {digest} from '../../../../packages/ai/src/v03/compiler.js';
import {readProfile} from '../user-home.js';
import type {PlanningService} from './service.js';
export const compensatable=(a:any)=>['record.correct','task_template.change','profile.patch','report.generate','report_schedule.change'].includes(a.action_type);
export async function compensationState(service:PlanningService,c:Client,user:string,a:any){
 let state:any,label='';
 if(a.action_type==='record.correct'){state=(await c.query('SELECT * FROM records WHERE user_id=$1 AND id=$2',[user,a.id])).rows[0];label='修订记录还原为原值（新增修订，不删除历史）';}
 if(a.action_type==='task_template.change'){state=(await c.query('SELECT t.*,coalesce((SELECT jsonb_agg(d ORDER BY d.period_start) FROM task_instance_details d WHERE d.user_id=t.user_id AND d.template_id=t.id),\'[]\') instances FROM task_templates t WHERE user_id=$1 AND id=$2',[user,a.id])).rows[0];label='仅将未来规则改回原计划；已有锁定实例保留';}
 if(a.action_type==='profile.patch'){const profile=await readProfile(c,user);state={profile,observations:[] as any[]};for(const id of a.generated_records??[])state.observations.push((await c.query('SELECT * FROM records WHERE user_id=$1 AND id=$2',[user,id])).rows[0]);label='恢复本次静态资料值，软删除本次新增观测并重算';}
 if(a.action_type==='report.generate'){state=(await c.query('SELECT * FROM report_jobs WHERE user_id=$1 AND id=$2',[user,a.result.job_id])).rows[0];label=state?.status==='ready'?'保留已发布报告；相关事实变化会标记过时':'取消尚未发布的报告';}
 if(a.action_type==='report_schedule.change'){state=(await c.query('SELECT * FROM report_schedules WHERE user_id=$1 AND kind=$2',[user,a.data.kind])).rows[0];label='恢复此前日程配置；已发布报告保留';}
 requireThat(state,'VERSION_CONFLICT','补偿来源已不存在。',409);
 state=JSON.parse(JSON.stringify(state));
 return {id:a.id,entity_type:a.entity_type,label,fingerprint:digest(state),state};
}
export async function compensate(service:PlanningService,c:Client,user:string,a:any,state:any){
 const core=service.core;
 if(a.action_type==='record.correct'){
  const old=a.before.record,latest=state.state;requireThat(!latest.deleted_at,'VERSION_CONFLICT','记录已删除，请手动恢复。',409);
  const row:any=await core.executeInTransaction(c,user,'PUT','records/'+a.id,{base_version:latest.version,module_id:old.module_id,record_type_id:old.record_type_id,schema_version:old.schema_version,occurred_at:old.occurred_at,timezone:old.timezone,status:old.status,values:old.values,task_ids:old.task_ids});
  if(a.before.source){const source=a.before.source;await c.query('INSERT INTO record_sources(user_id,record_id,version,provenance,estimated_values,time_precision,time_basis,source_run_id,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[user,a.id,row.version,JSON.stringify(source.provenance),JSON.stringify(source.estimated_values),source.time_precision,source.time_basis,source.source_run_id,source.received_at]);}
 }
 if(a.action_type==='task_template.change'){
  const old=a.before.template,latest=state.state,ends=latest.instances.map((d:any)=>d.period_end?Date.parse(d.period_end):0),effective=new Date(Math.max(core.now().getTime(),...ends)).toISOString();
  const row=(await c.query('UPDATE task_templates SET next_definition=$3,effective_at=$4,version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *',[user,a.id,JSON.stringify(old.next_definition??old.definition),effective])).rows[0];
  const quote=(await c.query('SELECT * FROM reward_quotes WHERE user_id=$1 AND template_id=$2 AND template_version=$3',[user,a.id,old.version])).rows[0];if(quote)await c.query('INSERT INTO reward_quotes(user_id,template_id,template_version,rule_hash,category,amount,source,rationale,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[user,a.id,row.version,quote.rule_hash,quote.category,quote.amount,quote.source,'补偿恢复原锁价。',quote.parent_id]);
  await core.event(c,user,'task_template',a.id,row.version,row);
 }
 if(a.action_type==='profile.patch'){
  const current=await readProfile(c,user),upserts=[];
  for(const old of a.before){const live=current.module_fields.find((f:any)=>f.id===old.id);requireThat(live,'VERSION_CONFLICT','资料字段已移除。',409);if(profileFieldKind.parse(old.kind)===profileFieldKind.enum.profile){requireThat(live.kind===profileFieldKind.enum.profile&&live.module_id===old.module_id&&live.key===old.key&&live.type===old.type&&live.unit===old.unit,'BINDING_CONFLICT','资料字段类型或绑定已变化。',409);upserts.push({...live,value:old.value});}}
  if(upserts.length)await core.executeInTransaction(c,user,'PATCH','profile',{base_version:current.version,field_upserts:upserts});
  for(const r of state.state.observations)if(r&&!r.deleted_at)await core.executeInTransaction(c,user,'DELETE','records/'+r.id,{base_version:r.version});
  const restored=await readProfile(c,user);for(const old of a.before)if(old.kind===profileFieldKind.enum.profile)requireThat(digest(restored.module_fields.find((f:any)=>f.id===old.id)?.value)===digest(old.value),'VERSION_CONFLICT','资料补偿未恢复预期值，已回滚。',409);
 }
 if(a.action_type==='report.generate'&&!a.before?.reused&&state.state.status!=='ready'){
  await c.query("UPDATE report_jobs SET cancel_requested=true,status='failed',lease_owner=NULL,lease_until=NULL WHERE user_id=$1 AND id=$2",[user,a.result.job_id]);await c.query("UPDATE report_revisions SET status='failed',error='{\"code\":\"CANCELLED\",\"message\":\"用户确认补偿取消。\"}' WHERE user_id=$1 AND report_id=$2 AND revision=$3",[user,a.result.report_id,a.result.revision]);
 }
 if(a.action_type==='report_schedule.change'){
  await service.reports.saveSchedule(c,user,a.data.kind,{base_version:state.state.version,...a.before.config,preview_token:null},true);
 }
}
