import {randomUUID} from 'node:crypto';
import {digest,type CompiledAction} from '../../../../packages/ai/src/v03/compiler.js';
import {schemaFor,parseSchema} from '../../../../packages/contracts/src/v03/index.js';
import {requireThat} from '../../../../packages/domain/src/index.js';
import {ModelJobs} from './budget.js';
import type {PlanningService} from './service.js';
const caps:Record<string,number>={main:100,daily:10,weekly:50,monthly:200};
export function quoteRule(d:any){return {category:d.category,rule:d.rule,completion_mode:d.completion_mode,timezone:d.timezone,schedule:d.schedule??null};}
export async function quoteActions(service:PlanningService,user:string,parent:string,actions:CompiledAction[],context:any,owner:string){
 const tasks=actions.filter(a=>a.entity_type==='task_template'&&!a.reused);if(!tasks.length)return;
 const requests=tasks.map(a=>{const definition=a.action_type==='task_template.change'?{...(context.task_templates.find((t:any)=>t.id===a.id)?.next_definition??context.task_templates.find((t:any)=>t.id===a.id)?.definition),...a.data.changes}:a.data;return {template_local_ref:a.local_ref,rule_hash:digest(quoteRule(definition)),category:definition.category,definition};});
 let quotes:any[]|null=null;
 try{requireThat(service.config.rewardPricing,'FEATURE_DISABLED','独立报价已由服务器关闭。',409);requireThat(requests.length<=4,'AI_BUDGET_EXCEEDED','单批报价最多四个模板。',409);
  const result=await new ModelJobs(service.pool,service.gateway,service.config).call(user,parent,randomUUID(),'reward_quote',schemaFor('internal-reward-quote'),{policy_version:'reward-policy-ai-v1',requests},value=>{
   const parsed=parseSchema<any>('internal-reward-quote',value);requireThat(parsed.quotes.length===requests.length&&new Set(parsed.quotes.map((q:any)=>q.template_local_ref)).size===requests.length,'AI_INVALID_OUTPUT','报价条数不匹配。');
   for(const q of parsed.quotes){const r=requests.find(r=>r.template_local_ref===q.template_local_ref);requireThat(r&&r.rule_hash===q.rule_hash&&r.category===q.category,'AI_INVALID_OUTPUT','报价绑定的规则不匹配。');}return parsed;
  },()=>service.authorizeRunContext(user,parent,owner,context));quotes=result.value.quotes;
 }catch(e){if(['CANCELLED','AI_NOT_AUTHORIZED'].includes((e as any).code))throw e;}
 for(const a of tasks){const req=requests.find(r=>r.template_local_ref===a.local_ref)!,q=quotes?.find(q=>q.template_local_ref===a.local_ref);a.reward_quote={rule_hash:req.rule_hash,category:req.category,amount:q?.amount??caps[req.category],source:q?'ai':'system_fallback',rationale:q?.rationale??'报价不可用，采用类别上限内的系统固定规则。'};}
}
