import {scheduledPeriod} from '../../../packages/domain/src/phase2/schedule.js';
import {randomUUID} from 'node:crypto';
import {DateTime} from 'luxon';
import {Decimal} from 'decimal.js';
import type {Client} from '../../../packages/db/src/client.js';
import * as schema from '../../../packages/contracts/src/phase2.js';
import {DomainError,requireThat,validateValues,type Fact} from '../../../packages/domain/src/index.js';
import {REWARD_POLICY,periodAt,quotaPeriod,ruleProgress} from '../../../packages/domain/src/phase2/rules.js';
import type {Core} from './phase2-core.js';

export async function validateMeasure(core:Core,c:Client,user:string,module:string,rule:any) {
 const type=await core.type(c,user,module,rule.record_type_id);
 if(rule.kind==='linked_field_gte'||rule.kind==='sum'||rule.aggregation==='sum'){
  const field=type.fields.find((f:any)=>f.key===rule.field_key&&['integer','decimal'].includes(f.type));
  requireThat(field&&(!rule.unit||field.unit===rule.unit),'INVALID_BINDING','Compatible numeric field and unit required');
 }
 if(rule.threshold!==undefined)requireThat(new Decimal(rule.threshold).gt(0),'INVALID_RULE','Threshold must be positive');
 for(const filter of rule.filters??[]){
  const field=type.fields.find((f:any)=>f.key===filter.field_key);requireThat(field,'INVALID_BINDING','Filter references unknown field');
  if(filter.operator==='eq')validateValues([{...field,required:false}],{[field.key]:filter.value},false);
  if(filter.operator!=='eq'){let valid=false;try{valid=filter.value!==null&&['number','string'].includes(typeof filter.value)&&new Decimal(filter.value).isFinite();}catch{}requireThat(['integer','decimal'].includes(field.type)&&valid,'INVALID_BINDING','Numeric filter required');}
 }
}
async function validateTemplate(core:Core,c:Client,user:string,d:schema.TaskTemplateInput){
 await core.module(c,user,d.module_id);
 requireThat(d.completion_mode==='manual'?d.rule===null:d.rule!==null,'INVALID_RULE','Completion mode and rule disagree');
 requireThat(d.category==='main'||d.due_at===null,'INVALID_PERIOD','Only main tasks have a due date');
 if(d.schedule)scheduledPeriod(d,core.now());
 if(d.rule)await validateMeasure(core,c,user,d.module_id,d.rule);
 if(d.due_at)requireThat(Date.parse(d.due_at)>core.now().getTime(),'INVALID_PERIOD','Due date must be in the future');
}
export async function templateView(c:Client,user:string,id:string){
 const row=(await c.query('SELECT * FROM task_templates WHERE user_id=$1 AND id=$2 AND phase2',[user,id])).rows[0];
 requireThat(row,'NOT_FOUND','Task template not found',404);
 const instance=(await c.query('SELECT task_id FROM task_instance_details WHERE user_id=$1 AND template_id=$2 ORDER BY period_start DESC LIMIT 1',[user,id])).rows[0];
 return {...row,current_instance_id:instance?.task_id??null};
}
function taskView(t:any,d:any,q:any,net:string){
 const date=(v:any)=>v?new Date(v).toISOString():null;
 return {...t,category:d?.category??'main',color:d?.snapshot.color??'blue',template_version:d?.template_version??t.rule_version,period:d?{key:d.period_key,start:date(d.period_start),end:date(d.period_end),timezone:d.snapshot.timezone}:null,locked_rule:d?.snapshot.rule??null,progress:d?.progress??null,reward_summary:d?{source:t.reward_price_source??'system_fallback',policy_version:d.reward_policy_version,candidate_amount:String(d.reward_candidate),net_amount:net,eligibility:q?(q.eligible?'eligible':q.denial_reason):'pending',quota_period:q?.quota_period??d.quota_period,reversed:Boolean(q?.eligible&&q.original_grant_id&&net==='0')}:{policy_version:null,candidate_amount:'0',net_amount:'0',eligibility:'legacy',quota_period:null,reversed:false}};
}
export async function instanceViews(c:Client,user:string,ids?:string[]){
 const rows=(await c.query('SELECT t.*,(SELECT q.source FROM reward_quotes q WHERE q.user_id=t.user_id AND q.template_id=t.template_id AND q.template_version=d.template_version) reward_price_source,to_jsonb(d) details FROM tasks t LEFT JOIN task_instance_details d ON d.user_id=t.user_id AND d.task_id=t.id WHERE t.user_id=$1 AND ($2::uuid[] IS NULL OR t.id=ANY($2)) ORDER BY t.created_at,t.id',[user,ids??null])).rows;
 if(!rows.length)return [];
 const selected=rows.map(t=>t.id);
 const qs=new Map((await c.query('SELECT * FROM reward_qualifications WHERE user_id=$1 AND task_id=ANY($2::uuid[])',[user,selected])).rows.map(q=>[q.task_id,q]));
 const nets=new Map((await c.query('SELECT task_id,sum(amount)::text amount FROM wallet_ledger WHERE user_id=$1 AND task_id=ANY($2::uuid[]) GROUP BY task_id',[user,selected])).rows.map(r=>[r.task_id,r.amount]));
 return rows.map(({details,...t})=>taskView(t,details,qs.get(t.id),nets.get(t.id)??'0'));
}
export async function instanceView(c:Client,user:string,id:string){const row=(await instanceViews(c,user,[id]))[0];requireThat(row,'NOT_FOUND','Task not found',404);return row;}
export async function materializeOne(core:Core,c:Client,user:string,templateId:string){
 let t=await templateView(c,user,templateId);requireThat(t.status==='enabled','TEMPLATE_INACTIVE','Template is archived',409);await core.module(c,user,t.module_id);
 const now=core.now();
 const last=(await c.query('SELECT * FROM task_instance_details WHERE user_id=$1 AND template_id=$2 ORDER BY period_start DESC LIMIT 1',[user,templateId])).rows[0];
 // The locked instance wins until its end; only then can a queued definition
 // take over. Availability must be evaluated against that effective definition.
 if(last&&(!last.period_end||last.period_end.getTime()>now.getTime()))return {instance:await instanceView(c,user,last.task_id),reused:true};
 let activatedAt:string|null=null;
 if(t.next_definition&&Date.parse(t.effective_at)<=now.getTime()){
  activatedAt=new Date(t.effective_at).toISOString();
  t=(await c.query('UPDATE task_templates SET definition=next_definition,next_definition=NULL,effective_at=NULL,schedule_timezone=next_definition->>\'timezone\' WHERE user_id=$1 AND id=$2 RETURNING *',[user,templateId])).rows[0];
  await core.event(c,user,'task_template',t.id,t.version,t);
 }
 const d=t.definition as schema.TaskTemplateInput,scheduled=scheduledPeriod(d,now);
 if(!scheduled.period){
  const checks=[scheduled.next_check_at,t.next_definition&&t.effective_at?new Date(t.effective_at).toISOString():null].filter((at):at is string=>Boolean(at)&&Date.parse(at!)>now.getTime()).sort();
  return {instance:null,reused:false,next_check_at:checks[0]??null};
 }
 if(last&&d.category==='main')return {instance:await instanceView(c,user,last.task_id),reused:true};
 const p=scheduled.period;
 if(activatedAt&&Date.parse(p.start)<Date.parse(activatedAt))p.start=activatedAt;
 if(last?.period_end&&Date.parse(p.start)<last.period_end.getTime())p.start=last.period_end.toISOString();
 if(t.generation_cursor&&Date.parse(p.start)<Date.parse(t.generation_cursor))p.start=new Date(t.generation_cursor).toISOString();
 requireThat(!p.end||Date.parse(p.start)<Date.parse(p.end),'INVALID_PERIOD','No non-overlapping current period',409);
 const key=d.category==='main'?'main':p.start;
 const old=(await c.query('SELECT task_id FROM task_instance_details WHERE user_id=$1 AND template_id=$2 AND period_key=$3',[user,templateId,key])).rows[0];
 if(old)return {instance:await instanceView(c,user,old.task_id),reused:true};
 await c.query('INSERT INTO reward_accounts(user_id,timezone) SELECT id,timezone FROM users WHERE id=$1 ON CONFLICT DO NOTHING',[user]);
 const account=(await c.query('SELECT timezone FROM reward_accounts WHERE user_id=$1',[user])).rows[0];
 const taskId=randomUUID(),rule=d.rule,recordType=rule?.record_type_id??null;
 const acceptance=rule?.kind==='linked_field_gte'?{kind:'field_gte',field_key:rule.field_key,threshold:rule.threshold}:rule?{kind:'exists'}:null;
 const definition={id:taskId,module_id:d.module_id,title:d.title,completion_mode:d.completion_mode,record_type_id:recordType,acceptance,business_date:rule?.kind.startsWith('linked_')&&d.category==='daily'?DateTime.fromISO(p.start).setZone(d.timezone).toISODate():null,timezone:d.timezone};
 await c.query('INSERT INTO tasks(id,user_id,module_id,template_id,rule_version,definition,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)',[taskId,user,d.module_id,templateId,t.version,JSON.stringify(definition),now]);
 const lockedQuote=(await c.query('SELECT amount,source FROM reward_quotes WHERE user_id=$1 AND template_id=$2 AND template_version=$3',[user,templateId,t.version])).rows[0];
 const deadline=p.end?DateTime.fromISO(p.end).plus({days:REWARD_POLICY.grace_days}).toUTC().toISO():null;
 await c.query('INSERT INTO task_instance_details(user_id,task_id,template_id,template_version,category,period_key,period_start,period_end,snapshot,reward_policy_version,reward_candidate,quota_period,reward_deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[user,taskId,templateId,t.version,d.category,key,p.start,p.end,JSON.stringify(d),REWARD_POLICY.version,lockedQuote?.amount??REWARD_POLICY[d.category].amount,d.category==='main'?null:quotaPeriod(d.category,account.timezone,now),deadline]);
 await c.query('UPDATE task_templates SET generation_cursor=$3 WHERE user_id=$1 AND id=$2',[user,templateId,p.end]);
 const view=await instanceView(c,user,taskId);await core.event(c,user,'task',taskId,1,view);return {instance:view,reused:false};
}
export async function executeTasks(core:Core,c:Client,user:string,method:string,path:string,raw:unknown):Promise<any|undefined>{
 const [kind,id,action]=path.split('/');
 if(kind==='task-templates'&&method==='POST'&&!id){
  const d=schema.taskTemplateInput.parse(raw);await validateTemplate(core,c,user,d);
  await c.query('INSERT INTO task_templates(id,user_id,module_id,definition,phase2,schedule_timezone,created_at) VALUES($1,$2,$3,$4,true,$5,$6)',[d.id,user,d.module_id,JSON.stringify(d),d.timezone,core.now()]);
  await core.event(c,user,'task_template',d.id,1,d);const made=await materializeOne(core,c,user,d.id);
  return {template:await templateView(c,user,d.id),instance:made.instance};
 }
 if(kind==='task-templates'&&method==='PATCH'&&id){
  const d=schema.taskTemplatePatch.parse(raw),old=await templateView(c,user,id);
  if(old.version!==d.base_version)throw new DomainError('VERSION_CONFLICT','Template version changed',409,{current:old});await core.module(c,user,old.module_id);
  const {base_version,effective_from,status,...changes}=d;
  requireThat(old.definition.category!=='main'||Object.keys(changes).length===0,'INSTANCE_LOCKED','Main instance snapshot cannot be silently changed',409);
  const next={...(old.next_definition??old.definition),...changes};if(Object.keys(changes).length)await validateTemplate(core,c,user,next);
  const last=(await c.query('SELECT period_end FROM task_instance_details WHERE user_id=$1 AND template_id=$2 ORDER BY period_start DESC LIMIT 1',[user,id])).rows[0];
  const floor=Math.max(core.now().getTime(),last?.period_end?.getTime()??core.now().getTime());
  const effective=effective_from?new Date(effective_from):new Date(floor);requireThat(effective.getTime()>=floor,'INVALID_EFFECTIVE_DATE','Changes must take effect after the current instance ends');
  const row=(await c.query('UPDATE task_templates SET version=version+1,status=$3,next_definition=$4,effective_at=$5 WHERE user_id=$1 AND id=$2 RETURNING *',[user,id,status??old.status,Object.keys(changes).length?JSON.stringify(next):old.next_definition,Object.keys(changes).length?effective:old.effective_at])).rows[0];
  await core.event(c,user,'task_template',id,row.version,row);return {template:await templateView(c,user,id),instance:old.current_instance_id?await instanceView(c,user,old.current_instance_id):null};
 }
 if(path==='task-instances/materialize'&&method==='POST'){
  const d=schema.materializeInput.parse(raw);const ids=d.template_ids??(await c.query("SELECT t.id FROM task_templates t JOIN modules m ON m.id=t.module_id AND m.user_id=t.user_id WHERE t.user_id=$1 AND t.phase2 AND t.status='enabled' AND m.status='enabled' ORDER BY t.created_at,t.id",[user])).rows.map(r=>r.id);
  const results=[];for(const id of ids)results.push(await materializeOne(core,c,user,id));const ends=results.map(r=>r.instance?.period?.end??('next_check_at' in r?r.next_check_at:null)).filter((v:any)=>v&&Date.parse(v)>core.now().getTime()).sort();return {instances:results.map(r=>r.instance).filter(Boolean),reused:results.map(r=>r.reused),total_templates:ids.length,server_time:core.now().toISOString(),next_check_at:ends[0]??null,scope:d.template_ids?'explicit':'all'};
 }
 if(kind==='tasks'&&id&&method==='POST'&&['complete','revoke','cancel'].includes(action)){
  const detail=(await c.query('SELECT * FROM task_instance_details WHERE user_id=$1 AND task_id=$2',[user,id])).rows[0];if(!detail){if(action==='revoke')throw new DomainError('INVALID_TASK_TRANSITION','Only new manual completions can be revoked',409);return undefined;}
  const data=action!=='complete'?schema.revokeTaskInput.parse(raw):schema.revokeTaskInput.omit({reason:true}).parse(raw),old=await instanceView(c,user,id);await core.module(c,user,old.module_id);
  if(old.version!==data.base_version)throw new DomainError('VERSION_CONFLICT','Task version changed',409,{current:old});
  requireThat(!['cancelled','skipped'].includes(old.status),'INVALID_TASK_TRANSITION','Closed task cannot be completed',409);
  if(action==='complete'){requireThat(old.definition.completion_mode!=='record_required','RECORD_REQUIRED','Qualifying evidence is required');if(old.status==='completed')return old;}
  else if(action==='revoke')requireThat(old.status==='completed'&&old.completion_origin==='manual','INVALID_TASK_TRANSITION','Only manual completion can be revoked',409);
  const status=action==='cancel'?'cancelled':action==='complete'?'completed':detail.period_end&&detail.period_end<core.now()?'ended':'pending';
  const row=(await c.query("UPDATE tasks SET status=$3,completion_origin=$4,completed_at=$5,needs_review=false,version=version+1,updated_at=$6 WHERE user_id=$1 AND id=$2 RETURNING *",[user,id,status,action==='complete'?'manual':null,action==='complete'?core.now():null,core.now()])).rows[0];
  await c.query('UPDATE task_instance_details SET manual_revoked=$3 WHERE user_id=$1 AND task_id=$2',[user,id,action!=='complete']);
  await c.query('INSERT INTO task_history(id,user_id,task_id,version,event,reason,snapshot,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),user,id,row.version,action,'reason' in data?data.reason:null,JSON.stringify(old),core.now()]);
  await core.event(c,user,'task',id,row.version,row);return instanceView(c,user,id);
 }
}
export async function recomputeTasks(core:Core,c:Client,user:string,facts:Fact[]){
 const rows=(await c.query('SELECT t.*,d.snapshot,d.period_start,d.period_end,d.progress,d.manual_revoked FROM tasks t JOIN task_instance_details d ON d.user_id=t.user_id AND d.task_id=t.id WHERE t.user_id=$1 ORDER BY t.created_at,t.id',[user])).rows;
 for(const t of rows){
  if(['cancelled','skipped'].includes(t.status))continue;
  const p=ruleProgress(t.snapshot.rule,facts,t.id,{start:t.period_start.toISOString(),end:t.period_end?.toISOString()??null,timezone:t.snapshot.timezone},core.now());
  const ended=t.period_end&&t.period_end<=core.now();
  const satisfied=t.completion_origin==='manual'&&t.status==='completed'||!t.manual_revoked&&t.snapshot.completion_mode!=='manual'&&p.satisfied;
  const status=satisfied?'completed':ended?'ended':p.source_record_ids.length?'partial':'pending';
  const review=satisfied?false:t.needs_review||t.status==='completed';
  const {satisfied:_,...progress}=p;
  if(t.status!==status||t.needs_review!==review||t.progress.value!==progress.value||t.progress.target!==progress.target||JSON.stringify(t.progress.source_record_ids)!==JSON.stringify(progress.source_record_ids)||JSON.stringify(t.progress.distinct_dates)!==JSON.stringify(progress.distinct_dates)){
   const row=(await c.query("UPDATE tasks SET status=$3,needs_review=$4,completed_at=CASE WHEN $3='completed' THEN coalesce(completed_at,$5) ELSE NULL END,version=version+1,updated_at=$5 WHERE user_id=$1 AND id=$2 RETURNING *",[user,t.id,status,review,core.now()])).rows[0];
   await c.query('UPDATE task_instance_details SET progress=$3 WHERE user_id=$1 AND task_id=$2',[user,t.id,JSON.stringify(progress)]);
   await c.query('INSERT INTO task_history(id,user_id,task_id,version,event,reason,snapshot,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),user,t.id,row.version,'recompute',review?'evidence_changed':null,JSON.stringify(t),core.now()]);
   await core.event(c,user,'task',t.id,row.version,await instanceView(c,user,t.id));
  }
 }
}
