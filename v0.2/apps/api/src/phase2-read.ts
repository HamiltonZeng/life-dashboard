import type {Client} from '../../../packages/db/src/client.js';
import type {Core} from './phase2-core.js';
import {taskInstancesQuery,seriesQuery} from '../../../packages/contracts/src/phase2.js';
import {instanceViews} from './phase2-tasks.js';
import {seriesViews,achievementSummary} from './phase2-achievements.js';
export async function readTaskTemplates(c:Client,user:string){
 return (await c.query(`SELECT t.*,latest.task_id current_instance_id FROM task_templates t LEFT JOIN LATERAL
  (SELECT task_id FROM task_instance_details d WHERE d.user_id=t.user_id AND d.template_id=t.id ORDER BY period_start DESC LIMIT 1) latest ON true
  WHERE t.user_id=$1 AND t.phase2 ORDER BY t.created_at,t.id`,[user])).rows;
}
export async function readTaskInstances(c:Client,user:string,raw:unknown){
 const q=taskInstancesQuery.parse(raw);
 const pref=(await c.query('SELECT task_pins,pinned_task_ids FROM home_preferences WHERE user_id=$1',[user])).rows[0];
 const pins=pref?.task_pins?.length?pref.task_pins:(pref?.pinned_task_ids??[]).map((id:string)=>({kind:'instance',id}));
 const args:any[]=[user,q.module_id??null,q.category??null,q.status??null,q.color??null,q.period_start??null,q.pinned===undefined?null:q.pinned==='true',pins.filter((p:any)=>p.kind==='instance').map((p:any)=>p.id),pins.filter((p:any)=>p.kind==='template').map((p:any)=>p.id)];
 const from=`FROM tasks t LEFT JOIN task_instance_details d ON d.user_id=t.user_id AND d.task_id=t.id
 WHERE t.user_id=$1 AND ($2::uuid IS NULL OR t.module_id=$2) AND ($3::text IS NULL OR coalesce(d.category,'main')=$3)
 AND ($4::text IS NULL OR t.status=$4) AND ($5::text IS NULL OR lower(coalesce(d.snapshot->>'color','blue'))=lower($5))
 AND ($6::timestamptz IS NULL OR d.period_start >= $6) AND ($7::boolean IS NULL OR (t.id=ANY($8::uuid[]) OR t.template_id=ANY($9::uuid[]))=$7)`;
 const total=Number((await c.query('SELECT count(*) '+from,args)).rows[0].count);
 const ids=(await c.query('SELECT t.id '+from+' ORDER BY t.created_at,t.id LIMIT $10 OFFSET $11',[...args,q.limit,q.offset])).rows.map(r=>r.id);
 return {data:await instanceViews(c,user,ids),page:{limit:q.limit,offset:q.offset,total}};
}
export async function readSeries(core:Core,c:Client,user:string,raw:unknown){
 const q=seriesQuery.parse(raw),rows=await seriesViews(core,c,user);
 const filtered=rows.filter(r=>(!q.module_id||r.module_id===q.module_id)&&(!q.id||r.id===q.id)&&(!q.state||(q.state==='unstarted'?r.milestones.every((m:any)=>m.award===null):r.milestones.some((m:any)=>m.award?.state===q.state))));
 return {data:filtered.slice(q.offset,q.offset+q.limit),page:{limit:q.limit,offset:q.offset,total:filtered.length}};
}
export {achievementSummary};
