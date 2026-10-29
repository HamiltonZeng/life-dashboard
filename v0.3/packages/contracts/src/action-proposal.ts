import {z} from 'zod';
import {uuid,timezone} from './primitives.js';
import {recordInput,metricInput} from './index.js';
import {taskTemplateInput,taskTemplatePatch,achievementSeriesInput,phase2ProfileInput} from './phase2.js';
const refs=z.array(z.string().min(1).max(100)).max(30);
export const aiContextInput=z.strictObject({panel:z.enum(['home','tasks','metrics','achievements','records','profile']),module_ids:z.array(uuid).max(10),record_type_ids:z.array(uuid).max(20),metric_ids:z.array(uuid).max(20),task_template_ids:z.array(uuid).max(20),task_instance_ids:z.array(uuid).max(20).default([]),series_ids:z.array(uuid).max(20),profile_field_ids:z.array(uuid).max(30),source_record_ids:z.array(uuid).max(30),timezone});
const base={local_ref:z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),source_refs:refs,missing_fields:z.array(z.string().min(1).max(64)).max(30)};
export const proposalAction=z.discriminatedUnion('action_type',[
 z.strictObject({...base,action_type:z.literal('record.create'),target:z.strictObject({module_id:uuid,record_type_id:uuid,base_version:z.null()}),data:recordInput.omit({id:true,module_id:true,record_type_id:true,status:true})}),
 z.strictObject({...base,action_type:z.literal('task_template.create'),data:taskTemplateInput.omit({id:true})}),
 z.strictObject({...base,action_type:z.literal('task_template.change'),target:z.strictObject({id:uuid}),data:taskTemplatePatch}),
 z.strictObject({...base,action_type:z.literal('metric.explain'),target:z.strictObject({id:uuid}),data:z.strictObject({explanation:z.string().min(1).max(4000)})}),
 z.strictObject({...base,action_type:z.literal('metric.propose'),data:metricInput.omit({id:true})}),
 z.strictObject({...base,action_type:z.literal('achievement_series.propose'),data:achievementSeriesInput.omit({id:true})}),
 z.strictObject({...base,action_type:z.literal('profile.propose'),data:phase2ProfileInput}),
 z.strictObject({...base,action_type:z.literal('ask_clarification'),data:z.strictObject({question:z.string().min(1).max(1000)})})
]);
export const actionProposal=z.strictObject({schema_version:z.literal('action-proposal/1.0'),context_ref:uuid,intent:z.enum(['home.assist','tasks.propose','metrics.analyze','achievements.propose','records.propose','profile.propose']),proposals:z.array(proposalAction).min(1).max(20).refine(a=>new Set(a.map(p=>p.local_ref)).size===a.length),warnings:z.array(z.string().max(1000)).max(20)});
export const proposalGenerateInput=z.strictObject({context_ref:uuid,prompt:z.string().min(1).max(4000)});
export const proposalPreviewInput=z.strictObject({candidate_id:uuid});
export const proposalApplyInput=z.strictObject({candidate_id:uuid,context_ref:uuid,selected_local_refs:refs.min(1).refine(a=>new Set(a).size===a.length)});
export const internalRewardQuote=z.strictObject({schema_version:z.literal('reward-quote/1.0'),task_id:uuid,task_rule_version:z.int().positive(),amount:z.int().nonnegative().max(10000),rationale:z.string().min(1).max(2000),provider:z.string().min(1).max(80),model:z.string().min(1).max(100),quote_version:z.int().positive()});
