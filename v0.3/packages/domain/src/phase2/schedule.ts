import {DateTime} from 'luxon';
import {requireThat} from '../index.js';
import {periodAt} from './rules.js';
export interface Schedule {active_from:string;active_until:string|null;weekdays:number[]|null;preferred_local_time:string|null}
export function scheduledPeriod(def:any,now:Date){
 const p=periodAt(def.category,def.timezone,now,def.due_at),s:Schedule|undefined=def.schedule;
 if(!s)return {period:p,next_check_at:p.end};
 const local=DateTime.fromJSDate(now,{zone:def.timezone}),start=DateTime.fromISO(s.active_from,{zone:def.timezone}).startOf('day'),end=s.active_until?DateTime.fromISO(s.active_until,{zone:def.timezone}).plus({days:1}).startOf('day'):null;
 requireThat(start.isValid&&(!end||end>start),'INVALID_PERIOD','计划有效期无效');
 requireThat(def.category==='daily'||s.weekdays===null,'INVALID_PERIOD','只有每日任务支持适用星期');
 if(end&&local>=end)return {period:null,next_check_at:null};
 if(local<start)return {period:null,next_check_at:start.toUTC().toISO()};
 if(def.category==='daily'&&s.weekdays&&!s.weekdays.includes(local.weekday)){
  for(let i=1;i<=7;i++){const day=local.startOf('day').plus({days:i});if(end&&day>=end)return {period:null,next_check_at:null};if(s.weekdays.includes(day.weekday))return {period:null,next_check_at:day.toUTC().toISO()};}
 }
 p.start=new Date(Math.max(Date.parse(p.start),start.toMillis())).toISOString();
 if(end)p.end=new Date(Math.min(p.end?Date.parse(p.end):Infinity,end.toMillis())).toISOString();
 return {period:p,next_check_at:p.end};
}
