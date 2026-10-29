import {randomUUID,createHash} from 'node:crypto';
import {canonicalJson} from '../../../db/src/backup.js';
import {PHASE1_ACTIONS,parseDecision,type Decision,type Action} from '../../../contracts/src/v03/index.js';
import {DomainError,requireThat} from '../../../domain/src/index.js';
export const digest=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
export interface CompiledAction {local_ref:string;entity_type:string;id:string;data:any;reused:boolean;action_type?:string;reward_quote?:any;result?:any;before?:any;generated_records?:string[]}
export function explicitCreation(text:string){
 // Quoted examples, negations and questions never grant automatic write authority.
 if(/[“”「」『』"`]|(?:不要|别|不需要|假如|如果|例如|举例|听说|能否|是否|怎么|如何|吗[？?]?$|[？?])/.test(text))return false;
 return /(?:帮我(?:安排|规划|创建|制定|设置)|请(?:安排|规划|创建|制定|设置)|(?:新建|创建|安排|制定|设置)(?:一个|一套|学习|英语|目标|计划|未来)|我要(?:建立|制定|创建))/.test(text);
}
export function effectiveIntent(context:{original_text:string;answers?:string[];execution?:string}){
 const texts=[context.original_text,...(context.answers??[])];
 // Restrictions are monotonic within one intent. Later clarification must not
 // silently expand an earlier preview/confirmation grant.
 const asksForPreview=/(?:预览|看.*方案|看一下|先.*看|确认后|preview)/i;
 const cancelCommand=/^(?:(?:请|帮我|现在|先)\s*)*(?:取消|放弃|停止)(?:本次|这次|这个|此次|所有|全部)?(?:请求|操作|规划|计划|创建|执行|生成)?(?:了|吧)?[！!\s]*$/;
 const noCreation=/^(?:请)?(?:不用|不要|不需要|别|不想|我不想|不)(?:再|继续)?(?:创建|安排|执行|生成)(?:了|吧)?[！!\s]*$/;
 const englishCancel=/^(?:please\s+)?(?:cancel|stop|abort)(?:\s+(?:this|the|my))?(?:\s+(?:request|plan|operation))?[.!\s]*$/i;
 const cancelled=texts.some(text=>text.split(/[，,。；;\n]/).some(part=>{
  const command=part.trim();
  return cancelCommand.test(command)||englishCancel.test(command)||(!asksForPreview.test(text)&&noCreation.test(command));
 }));
 const restricted=texts.some(text=>/(?:不要|别|不需要|不用|不想|不创建|不建|取消|放弃|停止|暂缓|先不|暂不|先.*(?:看|预览)|只(?:看|预览|要)|仅|确认后|等我确认|未经确认|不(?:要)?(?:直接|自动)|最多|不超过|缩小|改为|改成)/.test(text)||/preview|do not|don.t|cancel|stop|abort|only|confirm|not create|no creation/i.test(text));
 return {version:texts.length,mode:cancelled?'cancelled':context.execution==='preview'||restricted||!explicitCreation(context.original_text)?'preview':'auto'};
}
export function compileDecision(raw:unknown,context:any):{decision:Decision;actions:CompiledAction[];counts:any;confirmation_required:boolean}{
 const intent=effectiveIntent(context);
 requireThat(intent.mode!=='cancelled','CANCELLED','用户已取消本次请求。',409);
 let decision=parseDecision(raw);
 if(/连续/.test(context.original_text)&&!context.answers?.some((a:string)=>/累计/.test(a))&&decision.actions.some(a=>a.action_type==='achievement_series.create'&&a.data.aggregation==='distinct_days')){
  decision={...decision,actions:[],intent:'clarify',clarification:{question:'第一阶段支持累计不同学习日，暂不支持连续天数。是否改为累计学习日？',choices:['改为累计学习日','先不创建'],blocking_fields:['achievement_series.aggregation']}};
 }
 requireThat(decision.context_ref===context.id,'INVALID_REFERENCE','Context identity mismatch');

 requireThat(!decision.clarification||decision.actions.length===0,'CLARIFICATION_REQUIRED','追问时不能同时写入部分方案。');
 const refs=new Map(decision.actions.map(a=>[a.local_ref,a]));
 requireThat(refs.size===decision.actions.length,'INVALID_REFERENCE','重复的方案引用');
 const visiting=new Set<string>(),done=new Set<string>(),sorted:Action[]=[];
 function visit(ref:string){
  const action=refs.get(ref);requireThat(action,'INVALID_REFERENCE','悬空依赖');requireThat(!visiting.has(ref),'INVALID_REFERENCE','循环依赖');
  if(done.has(ref))return;visiting.add(ref);action.depends_on.forEach(visit);visiting.delete(ref);done.add(ref);sorted.push(action);
 }
 decision.actions.forEach(a=>visit(a.local_ref));
 const mapping=new Map<string,{id:string;entity_type:string}>();
 const allowed=(type:string,id:string)=>context.entities.some((e:any)=>e.entity_type===type&&e.id===id);
 const inspect=(v:any,a:Action,key=''):any=>{
  if(v===null||typeof v!=='object')return v;
  if(Array.isArray(v))return v.map(x=>inspect(x,a,key));
  if(v.kind==='local'||v.kind==='existing'){
   const type=key==='module_ref'?'module':key==='goal_ref'?'goal':key==='record_type_ref'?'record_type':key==='template_ref'?'task_template':key==='record_ref'?'record':key==='field_ref'?'profile_field':key==='task_refs'?'task':null;
   requireThat(type,'INVALID_REFERENCE','未知引用位置');
   if(v.kind==='existing'){requireThat(allowed(type,v.id),'INVALID_REFERENCE','引用不在授权上下文中');return v.id;}
   requireThat(a.depends_on.includes(v.local_ref),'INVALID_REFERENCE','缺少显式依赖');const m=mapping.get(v.local_ref);
   if(key==='task_refs'&&m?.entity_type==='task_template')return {template_instance_ref:m.id};
   requireThat(m&&m.entity_type===type,'INVALID_REFERENCE','引用类型错误');return m.id;
  }
  return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,inspect(x,a,k)]));
 };
 const actions:CompiledAction[]=[];
 const milestoneRefs=new Set(refs.keys());
 for(const a of sorted){
  requireThat(a.evidence_refs.every(e=>context.evidence_refs.includes(e)),'INVALID_REFERENCE','来源不在授权消息中');
  const data=inspect(a.data,a),type=a.action_type.split('.')[0];let id:string=randomUUID(),reused=false;
  if(a.action_type==='task_template.change')id=data.template_ref;
  if(a.action_type==='record.correct')id=data.record_ref;
  if(type==='profile')id=context.user_id??id;
  if(type==='report_schedule')id=context.schedule_ids?.[data.kind]??id;
  if(a.action_type==='goal.create'){requireThat(data.title.trim().length>0&&data.description.trim().length>0,'INVALID_RULE','目标名称和原意图不能为空。');}
  if(type==='goal')requireThat(!data.target_date||data.start_date<=data.target_date,'INVALID_PERIOD','目标日期顺序错误');
  if(type==='achievement_series'){
   requireThat(data.history_policy==='from_activation','CONFIRMATION_REQUIRED','第一阶段不补授予历史成就。',409);
   data.milestones=data.milestones.map((m:any)=>{requireThat(!milestoneRefs.has(m.local_ref),'INVALID_REFERENCE','重复里程碑引用');milestoneRefs.add(m.local_ref);return {...m,id:randomUUID()};});
  }
  if(type==='record_type'){
   const same=context.record_types.find((t:any)=>t.module_id===data.module_ref&&t.name===data.name&&digest(t.fields)===digest(data.fields));
   if(same){id=same.id;reused=true;}
  }
  if(type==='metric'){
   const same=context.metrics.find((t:any)=>{const d=t.definition;return t.module_id===data.module_ref&&t.record_type_id===data.record_type_ref&&(d.display_precision??0)===data.display_precision&&['name','unit','aggregation','field_key','window','timezone'].every(k=>d[k]===data[k]);});
   if(same){id=same.id;reused=true;}
  }
  mapping.set(a.local_ref,{id,entity_type:type});actions.push({local_ref:a.local_ref,entity_type:type,id,data,reused,action_type:a.action_type});
 }
 const counts={objects:actions.filter(a=>!a.reused).length+actions.reduce((n,a)=>n+(a.data.milestones?.length??0),0),tasks:actions.filter(a=>a.entity_type==='task_template').length,metrics:actions.filter(a=>a.entity_type==='metric'&&!a.reused).length,series:actions.filter(a=>a.entity_type==='achievement_series').length};
 const over=counts.objects>context.preferences.auto_config_objects_limit||counts.tasks>4||counts.metrics>2||counts.series>1||actions.some(a=>(a.data.milestones?.length??0)>5);
 const facts=actions.filter(a=>a.action_type==='record.create');requireThat(facts.length<=context.preferences.auto_record_count_limit,'INVALID_RULE','单次记录数量超过上限。');
 const risky=actions.some(a=>['record.correct','profile.patch','task_template.change'].includes(a.action_type??'')||(a.entity_type==='report_schedule'&&a.data.enabled));
 const factText=[context.original_text,...(context.answers??[])].join(' ');
 const factAuto=!/[“”「」『』"`？?]|(?:打算|计划|明天|后天|如果|假如|例如|听说|能否|是否|怎么|如何|预计|准备|将要|不要|先不|只看|预览)/.test(factText)&&/(?:记一下|记录|记下|保存|跑了|吃了|喝了|学了|完成了|体重|今天|昨天|刚刚)/.test(context.original_text);
 const restricted=context.execution==='preview'||(context.answers??[]).some((x:string)=>/(?:只|先不|不要|预览|确认|取消|最多|不超过)/.test(x));
 const autoFact=facts.length>0&&factAuto&&!restricted&&actions.every(a=>a.action_type==='record.create'||a.action_type==='report.generate');
 const confirmation_required=risky||context.preferences.automatic_mode==='preview_all'||(!autoFact&&intent.mode!=='auto')||over;
 return {decision,actions,counts,confirmation_required};
}
