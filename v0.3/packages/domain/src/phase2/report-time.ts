import {DateTime} from 'luxon';
import {requireThat} from '../index.js';
export type ReportKind='daily'|'weekly'|'monthly';
export function reportPeriod(d:any,now:Date){
 const local=DateTime.fromJSDate(now,{zone:d.timezone});requireThat(local.isValid,'INVALID_PERIOD','IANA时区无效。');
 const unit=d.kind==='daily'?'day':d.kind==='weekly'?'week':'month';let start:DateTime,end:DateTime;
 if(d.period==='custom'){requireThat(d.start_date&&d.end_date,'INVALID_PERIOD','自定义范围需要起止日期。');start=DateTime.fromISO(d.start_date,{zone:d.timezone}).startOf('day');end=DateTime.fromISO(d.end_date,{zone:d.timezone}).plus({days:1}).startOf('day');}
 else {requireThat(d.start_date===null&&d.end_date===null,'INVALID_PERIOD','非自定义周期不可传起止日期。');start=local.startOf(unit);if(d.period==='previous')start=start.minus({[unit+'s']:1});end=start.plus({[unit+'s']:1});}
 requireThat(start.isValid&&end.isValid&&end>start&&end.diff(start,'days').days<=366&&start<=local,'INVALID_PERIOD','范围无效、超过366天或尚未开始。');
 const cutoff=end<local?end:local;
 return {start_at:start.toUTC().toISO()!,end_at:end.toUTC().toISO()!,cutoff_at:cutoff.toUTC().toISO()!,partial:local<end,period_key:start.toISODate()!+':'+end.minus({days:1}).toISODate(),expected_days:Math.max(1,Math.ceil(cutoff.diff(start,'days').days))};
}
export function validateSchedule(kind:string,d:any){
 requireThat(['daily','weekly','monthly'].includes(kind),'INVALID_PERIOD','报告类型无效。');
 requireThat(DateTime.now().setZone(d.timezone).isValid,'INVALID_PERIOD','时区无效。');
 requireThat(kind==='weekly'?Number.isInteger(d.weekday)&&d.weekday>=1&&d.weekday<=7:d.weekday===null,'INVALID_PERIOD','周几仅用于周报。');
 requireThat(kind==='monthly'?Number.isInteger(d.month_day)&&d.month_day>=1&&d.month_day<=31:d.month_day===null,'INVALID_PERIOD','月几号仅用于月报。');
}
function dueOn(day:DateTime,time:string){
 const [hour,minute]=time.split(':').map(Number);let at=day.set({hour,minute,second:0,millisecond:0});
 // Missing wall time rolls to the first valid local minute, rather than retaining
 // the offset into the gap. Ambiguous time always picks its earlier occurrence.
 if(at.hour!==hour||at.minute!==minute){while(at.minus({minutes:1}).toISODate()===day.toISODate()&&at.minus({minutes:1}).hour*60+at.minus({minutes:1}).minute>=hour*60+minute)at=at.minus({minutes:1});}
 return at.getPossibleOffsets().sort((a,b)=>a.toMillis()-b.toMillis())[0];
}
export function nextReportDue(kind:string,d:any,after:Date){
 validateSchedule(kind,d);let day=DateTime.fromJSDate(after,{zone:d.timezone}).startOf('day');
 for(let i=0;i<370;i++,day=day.plus({days:1})){
  if(kind==='weekly'&&day.weekday!==d.weekday)continue;
  if(kind==='monthly'&&day.day!==Math.min(d.month_day,day.daysInMonth!))continue;
  const at=dueOn(day,d.local_time);if(at.toMillis()>after.getTime())return at.toUTC().toISO()!;
 }throw new Error('No bounded report schedule occurrence');
}
export function latestReportDue(kind:string,d:any,now:Date){
 let due=nextReportDue(kind,d,new Date(now.getTime()-40*86400000)),latest=due;
 for(let i=0;i<50&&Date.parse(due)<=now.getTime();i++){latest=due;due=nextReportDue(kind,d,new Date(due));}
 return latest;
}
