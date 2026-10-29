import {Decimal} from 'decimal.js';
import {DateTime} from 'luxon';
import type {Fact} from '../index.js';
import {requireThat} from '../index.js';
import type {TaskRule,TaskTemplateInput} from '../../../contracts/src/phase2.js';
export const REWARD_POLICY={version:'reward-policy-v1',grace_days:7,main:{amount:100,limit:1,window:'month'},daily:{amount:10,limit:3,window:'day'},weekly:{amount:50,limit:3,window:'week'},monthly:{amount:200,limit:2,window:'month'}} as const;
export function periodAt(category:TaskTemplateInput['category'],zone:string,now:Date,dueAt:string|null=null) {
 const t=DateTime.fromJSDate(now,{zone});requireThat(t.isValid,'INVALID_TIMEZONE','Timezone is invalid');
 if(category==='main')return {start:now.toISOString(),end:dueAt};
 const unit=category==='daily'?'day':category==='weekly'?'week':'month',start=t.startOf(unit);
 return {start:start.toUTC().toISO()!,end:start.plus({[unit+'s']:1}).toUTC().toISO()!};
}
export function quotaPeriod(category:TaskTemplateInput['category'],zone:string,at:Date) {
 const unit=REWARD_POLICY[category].window;
 return DateTime.fromJSDate(at,{zone}).startOf(unit).toISODate()!;
}
export function matchesFilters(fact:Fact,filters:{field_key:string;operator:string;value:any}[]=[]) {
 return filters.every(f=>{
  const actual=fact.values[f.field_key];
  if(f.operator==='eq')return actual===f.value;
  if(actual===null||actual===undefined||actual==='')return false;
  try{const a=new Decimal(actual as any),b=new Decimal(f.value);return f.operator==='gte'?a.gte(b):a.lte(b);}catch{return false;}
 });
}
export function measure(aggregation:'count'|'distinct_days'|'sum',facts:Fact[],zone:string,field:string|null) {
 const selected=(aggregation==='sum'?facts.filter(f=>f.values[field!]!==null&&f.values[field!]!==undefined&&f.values[field!]!==''):facts).slice().sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at)||a.id.localeCompare(b.id));
 const dates=[...new Set(selected.map(f=>DateTime.fromISO(f.occurred_at).setZone(zone).toISODate()!))].sort();
 const value=aggregation==='count'?String(selected.length):aggregation==='distinct_days'?String(dates.length):selected.reduce((n,f)=>n.plus(f.values[field!] as any),new Decimal(0)).toString();
 return {value,source_record_ids:selected.map(f=>f.id),distinct_dates:dates};
}
export function ruleProgress(rule:TaskRule|null,facts:Fact[],taskId:string,period:{start:string;end:string|null;timezone:string},now:Date) {
 if(!rule)return {satisfied:false,value:null,target:null,source_record_ids:[] as string[],distinct_dates:[] as string[]};
 let selected=facts.filter(f=>f.record_type_id===rule.record_type_id&&Date.parse(f.occurred_at)>=Date.parse(period.start)&&(!period.end||Date.parse(f.occurred_at)<Date.parse(period.end))&&Date.parse(f.occurred_at)<=now.getTime());
 if(rule.kind==='linked_exists'||rule.kind==='linked_field_gte') {
  selected=selected.filter(f=>f.task_ids.includes(taskId));
  if(rule.kind==='linked_field_gte')selected=selected.filter(f=>{const value=f.values[rule.field_key];return value!==null&&value!==undefined&&value!==''&&new Decimal(value as any).gte(rule.threshold);});
  return {...measure('count',selected,period.timezone,null),target:'1',satisfied:selected.length>0};
 }
 selected=selected.filter(f=>matchesFilters(f,rule.filters));
 const result=measure(rule.kind,selected,period.timezone,rule.kind==='sum'?rule.field_key:null);
 return {...result,target:rule.threshold,satisfied:new Decimal(result.value).gte(rule.threshold)};
}
