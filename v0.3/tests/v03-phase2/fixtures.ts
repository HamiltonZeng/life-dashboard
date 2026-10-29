import {randomUUID} from 'node:crypto';
import {PlanningService} from '../../apps/api/src/ai/service.js';
import {createPool} from '../../packages/db/src/client.js';
import {migrate} from '../../packages/db/src/migrate.js';
import {seed,LOCAL_USER_ID,DEFAULT_MODULE_IDS} from '../../packages/db/src/seed.js';
import {gatewayConfig,type Gateway} from '../../packages/ai/src/v03/gateway.js';
import {guardSynthetic} from '../v02-phase3/guard.js';
import {buildApp} from '../../apps/api/src/app.js';
import {DateTime} from 'luxon';
import assert from 'node:assert/strict';
export const user=LOCAL_USER_ID,module=DEFAULT_MODULE_IDS[1];
export const field=(key:string,label:string,type='decimal',unit:string|null='公里',required=true)=>({key,label,type,required,unit,options:[],minimum:null,maximum:null});
export const requestReport=(kind='daily',extra:any={})=>({kind,period:'current',start_date:null,end_date:null,timezone:'Asia/Shanghai',module_ids:[],force_new_revision:false,...extra});
export const schedule=(kind='daily',extra:any={})=>({base_version:1,enabled:true,local_time:'08:00',timezone:'Asia/Shanghai',coverage:'previous_complete',weekday:kind==='weekly'?1:null,month_day:kind==='monthly'?1:null,short_month_policy:'last_day',catch_up:'latest_only',module_ids:[],...extra});
export class WorkflowGateway implements Gateway {
 calls:{purpose:string;input:any}[]=[];
 change:(value:any,c:any)=>any=(v)=>v;
 async generate(c:any,_signal:AbortSignal){this.calls.push({purpose:c.purpose,input:c.input});let value:any;
 if(c.purpose==='report')value={schema_version:'report-narrative/1.0',snapshot_id:c.input.snapshot_id,summary:'记录反映了实际进展。',selected_fact_ids:['record_count'],highlights:[{kind:'observation',text:'记录数量为 {{record_count}}。',fact_refs:['record_count']}],concerns:[],suggestions:[{kind:'suggestion',text:'建议继续记录实际活动。',fact_refs:['record_days']}],limitations:['分析只覆盖已记录的活动。']};
 else if(c.purpose==='reward_quote')value={schema_version:'reward-quote/1.1',policy_version:'reward-policy-ai-v1',quotes:c.input.requests.map((r:any)=>({template_local_ref:r.template_local_ref,rule_hash:r.rule_hash,category:r.category,amount:({main:100,daily:10,weekly:50,monthly:200} as any)[r.category],rationale:'根据规则难度和类别上限报价。'}))};
 else {const x=c.input,text=x.messages.at(-1).text,evidence_refs=[x.evidence_refs[0]],ref=(id:string)=>({kind:'existing',id}),action=(action_type:string,data:any,local_ref='record')=>({action_type,local_ref,depends_on:[],evidence_refs,data});
 const type=x.record_types.find((t:any)=>t.name==='跑步'),prov=(key:string,value:any,quote:string,unit:string|null='公里')=>({field_key:key,source_type:'user_statement',evidence_ref:evidence_refs[0],quote,original_value:value,original_unit:unit});
 const time={occurred_at:DateTime.fromISO(x.received_at).setZone(x.timezone).startOf('day').toUTC().toISO(),timezone:x.timezone,time_precision:'day',time_basis:'relative_date'};
 let actions:any[]=[];
 if(/新任务/.test(text))actions=[action('task_template.create',{module_ref:ref(module),goal_ref:null,title:'合成每日跑步',category:'daily',timezone:x.timezone,completion_mode:'record_required',rule:{kind:'sum',record_type_ref:ref(type.id),threshold:'3',filters:[],field_key:'distance',unit:'公里'},color:'green',schedule:{active_from:DateTime.fromISO(x.received_at).setZone(x.timezone).toISODate(),active_until:null,weekdays:null,preferred_local_time:null},due_at:null},'new_task')];
 else if(/纠正/.test(text))actions=[action('record.correct',{record_ref:ref(x.records[0].id),values_patch:{distance:'2'},occurred_at:null,timezone:null,provenance:[prov('distance','2','2公里')]},'correction')];
 else if(/体重/.test(text))actions=[action('profile.patch',{updates:[{field_ref:ref(x.profile_fields.find((f:any)=>f.key==='weight').id),value:'65',evidence_ref:evidence_refs[0]}]},'profile')];
 else if(/调整/.test(text))actions=[action('task_template.change',{template_ref:ref((x.task_templates.find((t:any)=>t.definition.title==='今日跑步')??x.task_templates.find((t:any)=>t.definition.category==='daily')).id),changes:{title:'未来跑步',rule:{...(x.task_templates.find((t:any)=>t.definition.title==='今日跑步')??x.task_templates.find((t:any)=>t.definition.category==='daily')).definition.rule,record_type_id:undefined,record_type_ref:ref(type.id),threshold:'5'}}},'future')];
 else if(/日程/.test(text)){const {base_version,...config}=schedule();actions=[action('report_schedule.change',{kind:'daily',...config},'schedule')];}
 else if(/新模块/.test(text))actions=[action('module.create',{name:'合成音乐',description:'明确创建的新模块',icon:'music',color:'violet'},'music'),{...action('record_type.create',{module_ref:{kind:'local',local_ref:'music'},name:'练琴',fields:[field('minutes','时长','integer','分钟')]},'practice'),depends_on:['music']}];
 else if(/报告/.test(text)&&!/跑了/.test(text))actions=[action('report.generate',(({force_new_revision,...d})=>d)(requestReport()),'report')];
 else if(/缺项/.test(text)){value={schema_version:'ai-decision/1.0',context_ref:x.id,intent:'clarify',summary:'需要真实时长。',assumptions:[],clarification:{question:'跑了多久？',choices:['20分钟'],blocking_fields:['minutes']},actions:[]};return {value:JSON.parse(JSON.stringify(this.change(value,c))),model:'synthetic-offline',usage:{input:100,output:200}};}
 else {let provenance=[prov('distance','3','3公里'),prov('minutes',20,'20分钟','分钟')];
  if(x.answers.length){provenance[1]={...prov('minutes',20,'20分钟','分钟'),evidence_ref:x.evidence.find((e:any)=>e.ref.startsWith('answer:')).ref};}
  actions=[action('record.create',{module_ref:ref(module),record_type_ref:ref(type.id),...time,values:{distance:'3',minutes:20},task_refs:[],provenance,estimated_values:[]})];
  if(/报告/.test(text))actions.push(action('report.generate',(({force_new_revision,...d})=>d)(requestReport()),'report'));
 }
 value={schema_version:'ai-decision/1.0',context_ref:x.id,intent:'act',summary:'按用户明确意图准备方案。',assumptions:[],clarification:null,actions};
 // Schema's intent vocabulary is shared by all action purposes.
 value.intent='plan';
 }
 return {value:JSON.parse(JSON.stringify(this.change(value,c))),model:'synthetic-offline',usage:{input:100,output:200}};
 }
}
export async function fixture(options:any={}){
 guardSynthetic();const pool=createPool();await migrate(pool);await pool.query('TRUNCATE users CASCADE');await seed(pool);const gateway=options.gateway??new WorkflowGateway();let now=new Date('2026-10-21T04:00:00Z');
 const service=new PlanningService(pool,{gateway,config:{...gatewayConfig({}),enabled:true,configured:true,apiKey:'synthetic-only',model:'synthetic-offline',maxInput:100000,dailyInput:1000000,dailyOutput:100000,...options.config},now:()=>now});
 const app=await buildApp(pool,{planning:service,profile:'mvp',origin:'http://localhost:18380',now:()=>now});
 const login=await app.inject({method:'POST',url:'/api/v1/session',headers:{origin:'http://localhost:18380'},payload:{login_secret:process.env.LOCAL_LOGIN_SECRET}});assert.equal(login.statusCode,200,login.body);let cookie=String(login.headers['set-cookie']).split(';')[0];
 const req=async(method:string,path:string,body?:any,key:string=randomUUID())=>app.inject({method:method as any,url:'/api/v1/'+path,headers:{cookie,origin:'http://localhost:18380','idempotency-key':key},payload:body});
 const ok=async(method:string,path:string,body?:any,key?:string)=>{const r=await req(method,path,body,key);assert.ok(r.statusCode<300,r.body);return r.json().data;};
 await ok('PATCH','ai/preferences',{base_version:1,automatic_mode:'clear_commands',readable_module_ids:[module],auto_config_objects_limit:12,auto_record_count_limit:5});
 const type=await ok('POST','record-types',{id:randomUUID(),module_id:module,name:'跑步',fields:[field('distance','距离'),field('minutes','时长','integer','分钟')]});
 const metric=await ok('POST','metrics',{id:randomUUID(),module_id:module,record_type_id:type.id,name:'跑步总距离',unit:'公里',aggregation:'sum',field_key:'distance',window:'all_time',timezone:'Asia/Shanghai',display_precision:2});
 const task=await ok('POST','task-templates',{id:randomUUID(),module_id:module,title:'今日跑步',category:'daily',timezone:'Asia/Shanghai',completion_mode:'record_required',rule:{kind:'sum',record_type_id:type.id,threshold:'3',filters:[],field_key:'distance',unit:'公里'},color:'green',due_at:null});
 await ok('POST','achievement-series',{id:randomUUID(),module_id:module,record_type_id:type.id,name:'累计跑步',aggregation:'sum',field_key:'distance',unit:'公里',timezone:'Asia/Shanghai',filters:[],history_policy:'include_existing',milestones:[{id:randomUUID(),threshold:'3',label:'首次跑步'}]});
 const conv=await ok('POST','ai/conversations',{entrypoint:'record_create',title:null});
 const send=async(text='今天跑了3公里20分钟',extra:any={})=>{const accepted=await ok('POST','ai/conversations/'+conv.id+'/messages',{schema_version:'client-command/1.0',client_message_id:randomUUID(),text,entrypoint:'record_create',execution:'auto',selected_refs:[],...extra});await service.tick();return service.turn(user,accepted.run_id);};
 const apply=async(turn:any)=>{assert.equal(turn.status,'awaiting_confirmation',JSON.stringify(turn));const p=await ok('POST','ai/proposals/'+turn.proposal.candidate_id+'/preview',{candidate_version:1});return ok('POST','ai/proposals/'+p.candidate_id+'/apply',{candidate_version:1,content_hash:p.content_hash,confirmation_token:p.confirmation_token});};
 const relogin=async()=>{const r=await req('POST','session',{login_secret:process.env.LOCAL_LOGIN_SECRET});cookie=String(r.headers['set-cookie']).split(';')[0];};
 return {relogin,pool,service,gateway,app,req,ok,type,metric,task,conv,send,apply,setNow:(value:string)=>{now=new Date(value);},close:async()=>{await app.close();await pool.end();}};
}
