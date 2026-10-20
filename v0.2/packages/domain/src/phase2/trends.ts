import {DateTime} from 'luxon';
import {Decimal} from 'decimal.js';
import {calculateMetric,requireThat,type Fact} from '../index.js';
import type {MetricInput} from '../../../contracts/src/index.js';
import {trendQuery,type TrendQuery} from '../../../contracts/src/phase2.js';
const grains={last_7_days:['1d'],month:['1d','2d','3d'],quarter:['3d','4d','5d','6d','7d'],year:['7d','14d','21d','1mo']} as const;
const defaults={last_7_days:'1d',month:'1d',quarter:'7d',year:'14d'} as const;
function display(value:string|null,precision:number){if(value===null)return null;const rounded=new Decimal(value).toDecimalPlaces(precision,Decimal.ROUND_HALF_UP);return (rounded.isZero()?new Decimal(0):rounded).toFixed(precision);}
export function calculateTrend(metric:{id:string;version:number;definition:MetricInput},facts:Fact[],input:unknown,now=new Date()){
 const q=trendQuery.parse(input),def=metric.definition,zone=def.timezone,grain=q.grain??defaults[q.range],precision=q.precision??def.display_precision??0;
 requireThat((grains[q.range] as readonly string[]).includes(grain),'INVALID_GRAIN','Grain is not supported for this range');
 const today=DateTime.fromJSDate(now,{zone}).startOf('day');
 const start=q.range==='last_7_days'?today.minus({days:6}):today.startOf(q.range==='month'?'month':q.range==='quarter'?'quarter':'year');
 const finish=today.plus({days:1});
 const startMs=start.toMillis(),nowMs=now.getTime(),byDay=new Map<string,Fact[]>(),byId=new Map(facts.map(f=>[f.id,f]));
 for(const f of facts){const time=Date.parse(f.occurred_at);if(f.record_type_id!==def.record_type_id||time<startMs||time>nowMs)continue;const date=DateTime.fromISO(f.occurred_at,{zone}).toISODate()!;const group=byDay.get(date)??[];group.push(f);byDay.set(date,group);}
 const daily:any[]=[];
 for(let day=start;day<finish;day=day.plus({days:1})){
  const value=calculateMetric({...def,window:'day'},byDay.get(day.toISODate()!)??[],day.toJSDate());
  daily.push({date:day.toISODate()!,value:value.value,display_value:display(value.value,precision),source_record_ids:value.source_record_ids,excluded:false,marked_for_exclusion:false,exclusion_reasons:[] as string[]});
 }
 const requested=q.exclude_dates?q.exclude_dates.split(','):[];
 requireThat(requested.length<=366&&requested.every(d=>DateTime.fromISO(d).isValid),'INVALID_FILTER','Excluded dates must be valid ISO dates');
 const valid=daily.filter(d=>d.value!==null),manual=[...new Set(requested)].filter(d=>daily.some(p=>p.date===d)).sort(),automatic:string[]=[];
 let fallback:string|null=null;
 if(q.variance_enabled==='true'){
  if(valid.length<q.minimum_days)fallback='insufficient_samples';
  else{
   const mean=valid.reduce((n,p)=>n.plus(p.value),new Decimal(0)).div(valid.length),ss=valid.reduce((n,p)=>n.plus(new Decimal(p.value).minus(mean).pow(2)),new Decimal(0));
   if(ss.isZero())fallback='zero_variance';
   else for(const point of valid)if(new Decimal(point.value).minus(mean).pow(2).div(ss).gt(q.variance_threshold))automatic.push(point.date);
  }
 }
 const proposed=new Set([...manual,...automatic]);
 if(proposed.size&&valid.filter(p=>!proposed.has(p.date)).length<2)fallback='too_few_remaining';
 const applied=q.include_all==='true'||fallback==='too_few_remaining'?new Set<string>():proposed;
 for(const p of daily){p.marked_for_exclusion=proposed.has(p.date);p.excluded=applied.has(p.date);p.exclusion_reasons=[...(manual.includes(p.date)?['manual']:[]),...(automatic.includes(p.date)?['variance']:[])];}
 const buckets:any[]=[];
 for(let day=start;day<finish;){
  const idealEnd=grain==='1mo'?day.plus({months:1}):day.plus({days:Number(grain.slice(0,-1))});
  const end=idealEnd<finish?idealEnd:finish;
  const points=daily.filter(p=>p.date>=day.toISODate()!&&p.date<end.toISODate()!),kept=points.filter(p=>p.value!==null&&!p.excluded);
  const value=kept.length?kept.reduce((n,p)=>n.plus(p.value),new Decimal(0)).div(kept.length).toString():null;
  buckets.push({start_date:day.toISODate()!,end_date:end.minus({days:1}).toISODate()!,value,display_value:display(value,precision),valid_days:kept.length,expected_days:points.length,incomplete:idealEnd.toMillis()>now.getTime(),source_record_ids:[...new Set(kept.flatMap(p=>p.source_record_ids))],excluded_dates:points.filter(p=>p.excluded).map(p=>p.date)});
  day=idealEnd;
 }
 const refs=[...new Set(daily.flatMap(p=>p.source_record_ids))] as string[];
 return {metric_id:metric.id,metric_version:metric.version,range:q.range,grain,precision,timezone:zone,start_date:start.toISODate()!,end_date:today.toISODate()!,aggregation:def.aggregation,unit:def.unit,daily_values:daily,buckets,coverage:{valid_days:valid.length,expected_days:daily.length,included_days:valid.filter(p=>!p.excluded).length},exclusions:{manual_dates:manual,automatic_dates:automatic,applied_dates:[...applied].sort(),fallback_reason:fallback},source_refs:refs.map(id=>({record_id:id,version:(byId.get(id) as any)?.version??null})),view_filter:{exclude_dates:manual,variance_enabled:q.variance_enabled==='true',variance_threshold:q.variance_threshold,minimum_days:q.minimum_days,include_all:q.include_all==='true'},calculation_version:1};
}
export function pinToQuery(pin:{range:string;grain:string;precision:number;view_filter:any}):TrendQuery{
 const filter=pin.view_filter;
 return trendQuery.parse({range:pin.range,grain:pin.grain,precision:pin.precision,exclude_dates:filter.exclude_dates.join(','),variance_enabled:String(filter.variance_enabled),variance_threshold:filter.variance_threshold,minimum_days:filter.minimum_days,include_all:String(filter.include_all)});
}
