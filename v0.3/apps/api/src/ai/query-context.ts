import type {Client} from '../../../../packages/db/src/client.js';
import {digest} from '../../../../packages/ai/src/v03/compiler.js';
import {bindingFingerprint} from '../observation-binding.js';
export async function extendContext(c:Client,user:string,base:any,selected:any[],answerEvidence:any[]){
 const ids=base.modules.map((m:any)=>m.id),selectedIds=selected.map(r=>r.id);
 const records=(await c.query("SELECT r.*,ARRAY(SELECT task_id FROM record_tasks t WHERE t.user_id=r.user_id AND t.record_id=r.id) task_ids FROM records r WHERE user_id=$1 AND module_id=ANY($2::uuid[]) AND deleted_at IS NULL AND (occurred_at >= $3::timestamptz-interval '90 days' OR id=ANY($4::uuid[])) ORDER BY (id=ANY($4::uuid[])) DESC,occurred_at DESC,id LIMIT 30",[user,ids,base.received_at,selectedIds])).rows;
 const templates=(await c.query("SELECT * FROM task_templates WHERE user_id=$1 AND module_id=ANY($2::uuid[]) AND status='enabled' AND phase2 ORDER BY created_at DESC LIMIT 20",[user,ids])).rows;
 const tasks=(await c.query("SELECT t.id,t.module_id,t.version,t.definition,t.status,d.period_start,d.period_end FROM tasks t LEFT JOIN task_instance_details d ON d.user_id=t.user_id AND d.task_id=t.id WHERE t.user_id=$1 AND t.module_id=ANY($2::uuid[]) AND t.status NOT IN ('cancelled','skipped') ORDER BY t.created_at DESC LIMIT 25",[user,ids])).rows;
 const fields=(await c.query('SELECT * FROM profile_fields WHERE user_id=$1 AND module_id=ANY($2::uuid[]) ORDER BY id LIMIT 40',[user,ids])).rows.map(f=>({...f,binding_fingerprint:bindingFingerprint(f)}));
 for(const f of fields)if(f.kind==='observation'){const record=(await c.query("SELECT id,version FROM records WHERE user_id=$1 AND record_type_id=$2 AND deleted_at IS NULL AND status='confirmed' AND values->>$3 IS NOT NULL ORDER BY occurred_at DESC,id LIMIT 1",[user,f.binding.record_type_id,f.binding.field_key])).rows[0];f.observation_source=record??null;}
 const pv=(await c.query('SELECT version FROM user_profiles WHERE user_id=$1',[user])).rows[0]?.version??1;
 const evidence=[{ref:'message:'+base.message_id,text:base.original_text,kind:'user',received_at:base.received_at,hash:digest(base.original_text)},...answerEvidence.map(e=>({...e,kind:'user'})),...records.map(r=>({ref:`record:${r.id}:${r.version}`,text:JSON.stringify(r.values),kind:'context',hash:digest(r)}))];
 const summaries=(await c.query('SELECT s.report_id,s.revision,s.summary,s.source_hash FROM report_summaries s WHERE s.user_id=$1 AND NOT s.outdated AND s.module_ids <@ $2::jsonb ORDER BY report_id LIMIT 8',[user,JSON.stringify(ids)])).rows;
 for(const goal of base.goals){goal.source_ref=`goal:${goal.id}:${goal.version}`;goal.latest_plan=(await c.query('SELECT id,version,source_run_id FROM plan_versions WHERE user_id=$1 AND goal_id=$2 ORDER BY version DESC,created_at DESC LIMIT 1',[user,goal.id])).rows[0]??null;}
 const report_schedules=(await c.query('SELECT id,kind,version,config FROM report_schedules WHERE user_id=$1',[user])).rows;
 return {...base,selected_refs:selected,report_schedules,user_id:user,records,task_templates:templates,tasks,profile_fields:fields,profile_version:pv,summaries,evidence,evidence_refs:evidence.map(e=>e.ref),entities:[...base.entities,...records.map(r=>({...r,entity_type:'record'})),...templates.map(r=>({...r,entity_type:'task_template'})),...tasks.map(r=>({...r,entity_type:'task'})),...fields.map(r=>({...r,entity_type:'profile_field',version:pv,fingerprint:digest(r)}))]};
}
export async function searchSummaries(c:Pick<Client,'query'>,user:string,modules:string[],query:string,start:string|null,end:string|null){
 // PostgreSQL's simple dictionary does not segment Chinese. Literal bounded
 // substring search is deliberate; callers cannot inject SQL wildcards.
 const escaped=query.replace(/[\\%_]/g,'\\$&');
 return (await c.query("SELECT s.*,r.kind,r.created_at FROM report_summaries s JOIN reports r ON r.user_id=s.user_id AND r.id=s.report_id WHERE s.user_id=$1 AND NOT s.outdated AND s.module_ids <@ $2::jsonb AND s.summary ILIKE $3 AND ($4::timestamptz IS NULL OR r.created_at >= $4) AND ($5::timestamptz IS NULL OR r.created_at < $5) ORDER BY r.created_at DESC LIMIT 20",[user,JSON.stringify(modules),'%'+escaped+'%',start,end])).rows;
}
export function boundedModelInput(input:any,prompt:string,limit:number,selected:any[]=[]){
 const value=structuredClone(input),pinned=new Set(selected.map(r=>r.id));let truncated=false;
 const size=()=>Buffer.byteLength(prompt+JSON.stringify(value));
 for(const key of ['records','messages','summaries','goals','tasks','task_templates','metrics','record_types']){
  const rows=value[key];if(!Array.isArray(rows))continue;
  const minimum=key==='messages'||key==='record_types'?1:0;
  while(size()>limit&&rows.length>minimum){const index=key==='messages'?0:rows.findLastIndex((r:any)=>!pinned.has(r.id));if(index<0)break;const [removed]=rows.splice(index,1);truncated=true;
   if(key==='records'){value.evidence=value.evidence?.filter((e:any)=>!e.ref.startsWith('record:'+removed.id+':'));value.evidence_refs=value.evidence_refs?.filter((ref:string)=>!ref.startsWith('record:'+removed.id+':'));}
  }
 }
 if(truncated)value.context_truncated=true;return value;
}
