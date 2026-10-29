import {z} from 'zod';
import {uuid,timezone,decimal,fieldSchema} from './primitives.js';
export const PHASE2_CONTRACT_VERSION='v0.2-phase2/1.1';
const ids=z.array(uuid).max(50).refine(a=>new Set(a).size===a.length,'Duplicate IDs');
const scalar=z.union([z.string().max(20000),z.number().finite(),z.boolean(),z.null()]);
const filters=z.array(z.strictObject({field_key:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),operator:z.enum(['eq','gte','lte']),value:scalar})).max(5).default([]);
export const taskCategory=z.enum(['main','daily','weekly','monthly']);
export const taskColor=z.union([z.enum(['blue','green','amber','violet','rose','cyan','slate']),z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
const measureBase={record_type_id:uuid,threshold:decimal,filters};
export const taskRule=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('linked_exists'),record_type_id:uuid}),
  z.strictObject({kind:z.literal('linked_field_gte'),record_type_id:uuid,field_key:z.string().min(1).max(64),threshold:decimal}),
  z.strictObject({kind:z.literal('count'),...measureBase}),
  z.strictObject({kind:z.literal('distinct_days'),...measureBase}),
  z.strictObject({kind:z.literal('sum'),...measureBase,field_key:z.string().min(1).max(64),unit:z.string().min(1).max(30)})
]);
export const taskTemplateInput=z.strictObject({id:uuid,module_id:uuid,title:z.string().trim().min(1).max(100),category:taskCategory,timezone,completion_mode:z.enum(['manual','record_optional','record_required']),rule:taskRule.nullable(),color:taskColor.default('blue'),due_at:z.iso.datetime({offset:true}).nullable().default(null),schedule:z.strictObject({active_from:z.iso.date(),active_until:z.iso.date().nullable(),weekdays:z.array(z.int().min(1).max(7)).min(1).max(7).refine(v=>new Set(v).size===v.length).nullable(),preferred_local_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()}).optional()});
export const taskTemplatePatch=taskTemplateInput.omit({id:true,module_id:true,category:true}).partial().extend({base_version:z.int().positive(),effective_from:z.iso.datetime({offset:true}).optional(),status:z.enum(['enabled','archived']).optional()}).strict();
export const materializeInput=z.strictObject({template_ids:ids.optional()});
export const revokeTaskInput=z.strictObject({base_version:z.int().positive(),reason:z.string().trim().min(1).max(500)});
export const taskInstancesQuery=z.strictObject({module_id:uuid.optional(),category:taskCategory.optional(),status:z.enum(['pending','in_progress','partial','completed','skipped','cancelled','ended']).optional(),color:taskColor.optional(),pinned:z.enum(['true','false']).optional(),period_start:z.iso.datetime({offset:true}).optional(),limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).max(100000).default(0)});
export const trendRange=z.enum(['last_7_days','month','quarter','year']);
export const trendGrain=z.enum(['1d','2d','3d','4d','5d','6d','7d','14d','21d','1mo']);
export const trendViewFilter=z.strictObject({exclude_dates:z.array(z.iso.date()).max(366).default([]),variance_enabled:z.boolean().default(false),variance_threshold:z.number().min(0).max(1).default(0.5),minimum_days:z.int().min(3).max(366).default(5),include_all:z.boolean().default(false)});
export const trendQuery=z.strictObject({range:trendRange.default('last_7_days'),grain:trendGrain.optional(),precision:z.coerce.number().int().min(0).max(6).optional(),exclude_dates:z.string().max(4100).regex(/^(\d{4}-\d{2}-\d{2}(,\d{4}-\d{2}-\d{2})*)?$/).default(''),variance_enabled:z.enum(['true','false']).default('false'),variance_threshold:z.coerce.number().min(0).max(1).default(0.5),minimum_days:z.coerce.number().int().min(3).max(366).default(5),include_all:z.enum(['true','false']).default('false')});
export const trendPin=z.strictObject({metric_id:uuid,range:trendRange,grain:trendGrain,precision:z.int().min(0).max(6).default(0),view_filter:trendViewFilter.default({exclude_dates:[],variance_enabled:false,variance_threshold:0.5,minimum_days:5,include_all:false})});
export const typedTaskPin=z.strictObject({kind:z.enum(['template','instance']),id:uuid});
const profileBase=fieldSchema.omit({required:true,minimum:true,maximum:true});
export const profileFieldKind=z.enum(['profile','observation','derived']);
export type ProfileFieldKind=z.infer<typeof profileFieldKind>;
export const phase2ProfileField=z.discriminatedUnion('kind',[
  profileBase.extend({id:uuid,module_id:uuid,kind:z.literal(profileFieldKind.enum.profile),value:scalar}),
  profileBase.extend({id:uuid,module_id:uuid,kind:z.literal(profileFieldKind.enum.observation),type:z.enum(['integer','decimal']),value:z.null().default(null),binding:z.strictObject({record_type_id:uuid,field_key:z.string().min(1).max(64)})}),
  profileBase.extend({id:uuid,module_id:uuid,kind:z.literal(profileFieldKind.enum.derived),type:z.literal('decimal'),value:z.null().default(null),binding:z.strictObject({metric_id:uuid})})
]);
export const phase2ProfileInput=z.strictObject({base_version:z.int().positive(),nickname:z.string().trim().min(1).max(60).optional(),bio:z.string().max(1000).nullable().optional(),timezone:timezone.optional(),field_upserts:z.array(phase2ProfileField).max(120).optional(),field_remove_ids:z.array(uuid).max(120).optional()});
export const phase2HomePreferencesInput=z.strictObject({base_version:z.int().positive(),minimal_mode:z.boolean().optional(),pinned_metric_ids:z.array(uuid).max(4).refine(a=>new Set(a).size===a.length).optional(),pinned_task_ids:z.array(uuid).max(5).refine(a=>new Set(a).size===a.length).optional(),task_pins:z.array(typedTaskPin).max(5).optional(),pinned_trends:z.array(trendPin).max(2).optional()});
export const observationInput=z.strictObject({id:uuid,field_id:uuid,binding_fingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional(),occurred_at:z.iso.datetime({offset:true}),timezone,value:z.union([z.number().finite(),decimal,z.null()]),source_record_id:uuid.optional(),source_base_version:z.int().positive().optional(),context_values:z.record(z.string(),scalar).refine(v=>Object.keys(v).length<=30).default({})});
export const achievementSeriesInput=z.strictObject({id:uuid,module_id:uuid,name:z.string().trim().min(1).max(80),record_type_id:uuid,aggregation:z.enum(['count','distinct_days','sum']),field_key:z.string().max(64).nullable().default(null),unit:z.string().min(1).max(30),timezone,filters,history_policy:z.enum(['include_existing','from_activation']).default('include_existing'),milestones:z.array(z.strictObject({id:uuid,threshold:decimal,label:z.string().max(80).default('')})).min(1).max(20)});
export const seriesQuery=z.strictObject({module_id:uuid.optional(),id:uuid.optional(),state:z.enum(['unlocked','needs_review','unstarted']).optional(),limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).max(100000).default(0)});
export const ledgerQuery=z.strictObject({task_id:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).max(100000).default(0)});
export const phase2Error=z.strictObject({code:z.string(),message:z.string(),details:z.unknown().optional(),request_id:z.string()});
export const rewardSummary=z.object({policy_version:z.string().nullable(),candidate_amount:z.string(),net_amount:z.string(),eligibility:z.enum(['pending','eligible','quota_full','expired','legacy']),quota_period:z.string().nullable(),reversed:z.boolean()});
export const periodDTO=z.strictObject({key:z.string(),start:z.iso.datetime({offset:true}),end:z.iso.datetime({offset:true}).nullable(),timezone});
export const progressDTO=z.object({value:z.string().nullable(),target:z.string().nullable(),source_record_ids:z.array(uuid),distinct_dates:z.array(z.iso.date())});
export const walletDTO=z.strictObject({id:uuid,version:z.int().positive(),balance:z.string().regex(/^\d+$/),effective_earned:z.string().regex(/^\d+$/),currency:z.literal('token'),policy_version:z.string(),quota_timezone:timezone});
export const dailyValueDTO=z.object({date:z.iso.date(),value:z.string().nullable(),display_value:z.string().nullable(),source_record_ids:z.array(uuid),excluded:z.boolean(),exclusion_reasons:z.array(z.enum(['manual','variance']))});
export const trendBucketDTO=z.object({start_date:z.iso.date(),end_date:z.iso.date(),value:z.string().nullable(),display_value:z.string().nullable(),valid_days:z.int().nonnegative(),expected_days:z.int().positive(),incomplete:z.boolean(),source_record_ids:z.array(uuid),excluded_dates:z.array(z.iso.date())});
export type TaskTemplateInput=z.infer<typeof taskTemplateInput>;
export type TaskRule=z.infer<typeof taskRule>;
export type TrendPin=z.infer<typeof trendPin>;
export type TrendQuery=z.infer<typeof trendQuery>;
export type TrendViewFilter=z.infer<typeof trendViewFilter>;
export type AchievementSeriesInput=z.infer<typeof achievementSeriesInput>;
export type Phase2ProfileField=z.infer<typeof phase2ProfileField>;
export type Phase2ProfileInput=z.infer<typeof phase2ProfileInput>;
