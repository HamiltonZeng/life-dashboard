import {DateTime} from 'luxon';
export function selectHomeTasks(rows:any[],pins:{kind:string;id:string}[],now:Date,timezone:string,limit=5){
 const today=DateTime.fromJSDate(now,{zone:timezone}).toISODate();
 const valid=(t:any)=>!['cancelled','skipped','ended'].includes(t.status)&&t.module_status==='enabled'&&(!t.phase2||t.template_status==='enabled');
 const current=(t:any)=>t.period_start&&new Date(t.period_start)<=now&&(!t.period_end||new Date(t.period_end)>now);
 const isLegacyToday=(t:any)=>!t.phase2&&t.definition.business_date===today;
 const pinValid=(t:any)=>t.phase2?current(t)&&!(t.category==='main'&&t.status==='completed'):isLegacyToday(t)||(!t.definition.business_date&&t.status!=='completed');
 const selected:any[]=[];const add=(t:any)=>{if(t&&valid(t)&&!selected.some(x=>x.id===t.id))selected.push(t);};
 for(const p of pins){const t=rows.find(t=>p.kind==='instance'?t.id===p.id:t.template_id===p.id&&current(t));if(t&&pinValid(t))add(t);}
 for(const t of rows)if(t.phase2?t.category==='daily'&&current(t):isLegacyToday(t))add(t);
 return {tasks:selected.slice(0,limit),total:selected.length};
}
