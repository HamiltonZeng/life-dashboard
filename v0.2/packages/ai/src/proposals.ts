import {actionProposal,aiContextInput} from '../../contracts/src/action-proposal.js';
import {requireThat} from '../../domain/src/index.js';
// Offline validation only. No model invocation or application endpoint in v0.2.
export function validateActionProposal(raw:unknown,contextRaw:unknown,contextId:string){
 const p=actionProposal.parse(raw),c=aiContextInput.parse(contextRaw);
 requireThat(p.context_ref===contextId,'INVALID_REFERENCE','Context mismatch');
 const allow=(ids:string[],id:string)=>requireThat(ids.includes(id),'INVALID_REFERENCE','Candidate references an object outside the allowed context');
 for(const a of p.proposals){
  if(a.action_type==='record.create'){allow(c.module_ids,a.target.module_id);allow(c.record_type_ids,a.target.record_type_id);for(const id of a.data.task_ids)allow(c.task_instance_ids,id);}
  if(a.action_type==='task_template.create'){allow(c.module_ids,a.data.module_id);if(a.data.rule)allow(c.record_type_ids,a.data.rule.record_type_id);}
  if(a.action_type==='task_template.change'){allow(c.task_template_ids,a.target.id);if(a.data.rule)allow(c.record_type_ids,a.data.rule.record_type_id);}
  if(a.action_type==='metric.explain')allow(c.metric_ids,a.target.id);
  if(a.action_type==='metric.propose'){allow(c.module_ids,a.data.module_id);allow(c.record_type_ids,a.data.record_type_id);}
  if(a.action_type==='achievement_series.propose'){allow(c.module_ids,a.data.module_id);allow(c.record_type_ids,a.data.record_type_id);}
  if(a.action_type==='profile.propose'){
   for(const id of a.data.field_remove_ids??[])allow(c.profile_field_ids,id);
   for(const f of a.data.field_upserts??[]){allow(c.module_ids,f.module_id);allow(c.profile_field_ids,f.id);if(f.kind==='observation')allow(c.record_type_ids,f.binding.record_type_id);if(f.kind==='derived')allow(c.metric_ids,f.binding.metric_id);}
  }
 }
 return p;
}
