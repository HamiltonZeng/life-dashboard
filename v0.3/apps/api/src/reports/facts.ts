import {randomUUID} from 'node:crypto';
import {DateTime} from 'luxon';
import {Decimal} from 'decimal.js';
import type {Client} from '../../../../packages/db/src/client.js';
import {digest} from '../../../../packages/ai/src/v03/compiler.js';
import {reportPeriod} from '../../../../packages/domain/src/phase2/report-time.js';
import {parseSchema} from '../../../../packages/contracts/src/v03/index.js';
export async function reportFacts(c:Client,user:string,request:any,modules:string[],now:Date){
 const period=reportPeriod(request,now),{start_at:start,cutoff_at:end}=period;
 const records=(await c.query("SELECT id,module_id,record_type_id,version,occurred_at,values FROM records WHERE user_id=$1 AND module_id=ANY($2::uuid[]) AND deleted_at IS NULL AND status='confirmed' AND occurred_at >= $3 AND (occurred_at < $4 OR ($5::boolean AND occurred_at=$4)) ORDER BY occurred_at,id",[user,modules,start,end,period.partial])).rows;
 const types=(await c.query('SELECT id,name,fields FROM record_types WHERE user_id=$1 AND module_id=ANY($2::uuid[])',[user,modules])).rows;
 const days=(rows:any[])=>new Set(rows.map(r=>DateTime.fromJSDate(new Date(r.occurred_at),{zone:request.timezone}).toISODate())).size;
 const coverage={valid_days:days(records),expected_days:period.expected_days,source_count:records.length};
 const refs=(rows:any[],entity_type='record')=>rows.map(r=>({entity_type,id:r.id,version:r.version??1}));
 const fact=(fact_id:string,label:string,value:string|null,unit:string,rows:any[],calculation:string,entity='record',data_source='deterministic_derived')=>({fact_id,label,calculation,value,unit,data_source,coverage:{valid_days:entity==='record'?days(rows):0,expected_days:period.expected_days,source_count:rows.length},previous_fact_id:null,source_refs:refs(rows,entity)});
 const facts:any[]=[fact('record_count','真实记录条数',String(records.length),'条',records,'COUNT confirmed, non-deleted records'),fact('record_days','有记录的不同日期',String(days(records)),'天',records,'COUNT DISTINCT local date')];
 for(const t of types)for(const f of t.fields.filter((f:any)=>['integer','decimal'].includes(f.type))){
  const rows=records.filter(r=>r.record_type_id===t.id&&r.values[f.key]!==null&&r.values[f.key]!==undefined);
  const total=rows.reduce((n,r)=>n.plus(String(r.values[f.key])),new Decimal(0));
  if(facts.length<90)facts.push(fact('sum_'+t.id.replaceAll('-','')+'_'+f.key,t.name+' · '+f.label,rows.length?total.toFixed():null,f.unit??'',rows,'SUM original unrounded field; missing remains null','record','user_reported'));
 }
 const tasks=(await c.query('SELECT t.id,t.version,t.status FROM tasks t JOIN task_instance_details d ON d.user_id=t.user_id AND d.task_id=t.id WHERE t.user_id=$1 AND t.module_id=ANY($2::uuid[]) AND d.period_start >= $3 AND d.period_start < $4 ORDER BY t.id',[user,modules,start,end])).rows;
 for(const status of ['completed','pending','in_progress','partial','ended','cancelled','skipped'])facts.push(fact('tasks_'+status,'任务：'+status,String(tasks.filter(t=>t.status===status).length),'项',tasks.filter(t=>t.status===status),'COUNT instance status; cancelled/skipped are separate','task_instance'));
 const eligible=tasks.filter(t=>!['cancelled','skipped'].includes(t.status));facts.push(fact('tasks_eligible','有效任务分母',String(eligible.length),'项',eligible,'COUNT valid instances excluding cancelled/skipped','task_instance'));
 const ledger=(await c.query('SELECT l.id,l.amount,1 version FROM wallet_ledger l JOIN tasks t ON t.user_id=l.user_id AND t.id=l.task_id WHERE l.user_id=$1 AND t.module_id=ANY($2::uuid[]) AND l.created_at >= $3 AND (l.created_at < $4 OR ($5::boolean AND l.created_at=$4)) ORDER BY l.id',[user,modules,start,end,period.partial])).rows;
 facts.push(fact('wallet_net','账本净变化',ledger.reduce((n,r)=>n.plus(r.amount),new Decimal(0)).toFixed(),'币',ledger,'SUM append-only grants, reversals and reinstatements','wallet_entry'));
 const estimates=(await c.query("SELECT r.id,r.version,r.occurred_at,s.estimated_values FROM records r JOIN record_sources s ON s.user_id=r.user_id AND s.record_id=r.id AND s.version=r.version WHERE r.user_id=$1 AND r.module_id=ANY($2::uuid[]) AND r.status='confirmed' AND r.deleted_at IS NULL AND r.occurred_at >= $3 AND r.occurred_at < $4",[user,modules,start,end])).rows;
 const groups=new Map<string,{key:string;unit:string;sum:Decimal;rows:any[]}>();
 for(const row of estimates)for(const e of row.estimated_values){const key=e.field_key+':'+e.unit,g=groups.get(key)??{key:e.field_key,unit:e.unit,sum:new Decimal(0),rows:[] as any[]};g.sum=g.sum.plus(e.value);g.rows.push(row);groups.set(key,g);}
 for(const [key,g] of groups)if(facts.length<100)facts.push(fact('estimate_'+digest(key).slice(0,16),'估算 · '+g.key,g.sum.toFixed(),g.unit,g.rows,'SUM separately labelled estimates; never used for qualification','record','estimated'));
 const identity={kind:request.kind,timezone:request.timezone,start:period.start_at,end:period.end_at,modules};
 const base={schema_version:'report-facts/1.0',snapshot_id:randomUUID(),report_identity:digest(identity),kind:request.kind,period_key:period.period_key,timezone:request.timezone,start_at:period.start_at,end_at:period.end_at,cutoff_at:period.cutoff_at,partial:period.partial,snapshot_cursor:Number((await c.query('SELECT seq FROM user_sync_clock WHERE user_id=$1',[user])).rows[0].seq),module_ids:modules,facts,coverage,warnings:records.length?['仅统计实际已记录的事实；缺失不代表零。','估算注解不计入真实合计。']:['本周期没有真实记录。'],content_hash:''};
 base.content_hash=digest(Object.fromEntries(Object.entries(base).filter(([key])=>key!=='content_hash')));parseSchema('report-facts',base);return base;
}
export function snapshotDataHash(facts:any){return digest({facts:facts.facts,module_ids:facts.module_ids,start_at:facts.start_at,end_at:facts.end_at});}
export function narrativeValue(value:unknown,facts:any){
 const n=parseSchema<any>('report-narrative',value),ids=new Set<string>(facts.facts.map((f:any)=>f.fact_id));
 if(n.snapshot_id!==facts.snapshot_id)throw new Error('Narrative snapshot mismatch');
 for(const id of [...n.selected_fact_ids,...[...n.highlights,...n.concerns,...n.suggestions].flatMap((v:any)=>v.fact_refs)])if(!ids.has(id))throw new Error('Narrative references unknown fact');
 for(const item of [n.summary,...[...n.highlights,...n.concerns,...n.suggestions].map((x:any)=>x.text),...n.limitations]){
  const placeholders=[...item.matchAll(/\{\{([^}]+)\}\}/g)].map(m=>m[1].replace(/^fact:/,''));if(placeholders.some(id=>!ids.has(id)))throw new Error('Unknown quantitative placeholder');
  if(/(?:相比|较上|比昨天|比上周|增长|下降|翻倍|超过目标|完成目标)/.test(item)&&!facts.facts.some((f:any)=>f.previous_fact_id))throw new Error('Unsupported comparison without a baseline');
  if(/[0-9０-９一二三四五六七八九十百千万亿两]+\s*(?:%|％|币|天|次|条|项|分钟|小时|公斤|公里|克|千卡)|\d/.test(item.replace(/\{\{[^}]+\}\}/g,'')))throw new Error('Unbound numeric prose');
 }
 for(const item of [...n.highlights,...n.concerns,...n.suggestions,{text:n.summary,fact_refs:n.selected_fact_ids}])for(const match of item.text.matchAll(/\{\{(?:fact:)?([^}]+)\}\}/g))if(!item.fact_refs.includes(match[1]))throw new Error('Quantitative placeholder is not cited by its claim');
 return n;
}
