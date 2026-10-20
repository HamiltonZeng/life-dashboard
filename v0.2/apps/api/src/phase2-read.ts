import type {Client} from '../../../packages/db/src/client.js';
import type {Core} from './phase2-core.js';
import {taskInstancesQuery,seriesQuery} from '../../../packages/contracts/src/phase2.js';
import {instanceView,templateView} from './phase2-tasks.js';
import {seriesViews,achievementSummary} from './phase2-achievements.js';
export async function readTaskTemplates(c:Client,user:string){
 const ids=(await c.query('SELECT id FROM task_templates WHERE user_id=$1 AND phase2 ORDER BY created_at,id',[user])).rows;
 return Promise.all(ids.map(r=>templateView(c,user,r.id)));
}
export async function readTaskInstances(c:Client,user:string,raw:unknown){
 const q=taskInstancesQuery.parse(raw);
 const rows=(await c.query('SELECT id FROM tasks WHERE user_id=$1 ORDER BY created_at,id',[user])).rows;
 const pref=(await c.query('SELECT task_pins,pinned_task_ids FROM home_preferences WHERE user_id=$1',[user])).rows[0];
 const pins=pref?.task_pins?.length?pref.task_pins:(pref?.pinned_task_ids??[]).map((id:string)=>({kind:'instance',id}));
 const all=[];for(const row of rows)all.push(await instanceView(c,user,row.id));
 const filtered=all.filter(t=>(!q.module_id||t.module_id===q.module_id)&&(!q.category||t.category===q.category)&&(!q.status||t.status===q.status)&&(!q.color||t.color.toLowerCase()===q.color.toLowerCase())&&(!q.period_start||t.period&&Date.parse(t.period.start)>=Date.parse(q.period_start))&&(q.pinned===undefined||pins.some((p:any)=>p.id===(p.kind==='template'?t.template_id:t.id))===(q.pinned==='true')));
 return {data:filtered.slice(q.offset,q.offset+q.limit),page:{limit:q.limit,offset:q.offset,total:filtered.length}};
}
export async function readSeries(core:Core,c:Client,user:string,raw:unknown){
 const q=seriesQuery.parse(raw),rows=await seriesViews(core,c,user);
 const filtered=rows.filter(r=>(!q.module_id||r.module_id===q.module_id)&&(!q.id||r.id===q.id)&&(!q.state||(q.state==='unstarted'?r.milestones.every((m:any)=>m.award===null):r.milestones.some((m:any)=>m.award?.state===q.state))));
 return {data:filtered.slice(q.offset,q.offset+q.limit),page:{limit:q.limit,offset:q.offset,total:filtered.length}};
}
export {achievementSummary};
