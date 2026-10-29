import {randomUUID,randomBytes} from 'node:crypto';
import type {Client} from '../../../../packages/db/src/client.js';
import {requireThat,DomainError} from '../../../../packages/domain/src/index.js';
import {parseDto,schemaFor} from '../../../../packages/contracts/src/v03/index.js';
import {digest} from '../../../../packages/ai/src/v03/compiler.js';
import {nextReportDue,latestReportDue} from '../../../../packages/domain/src/phase2/report-time.js';
import {reportFacts,snapshotDataHash,narrativeValue} from './facts.js';
import {ModelJobs} from '../ai/budget.js';
import type {PlanningService} from '../ai/service.js';
const j=JSON.stringify;
export class ReportsService {
 readonly jobs:ModelJobs;
 constructor(readonly planning:PlanningService){this.jobs=new ModelJobs(planning.pool,planning.gateway,planning.config);}
 get pool(){return this.planning.pool;}
 async scope(c:Pick<Client,'query'>,user:string,requested:string[]){
  const p=await this.planning.preferences(user,c),ids=[...new Set(requested.length?requested:p.readable_module_ids)].sort() as string[];
  requireThat(ids.length>0&&ids.length<=10&&ids.every(id=>p.readable_module_ids.includes(id)),'AI_NOT_AUTHORIZED','报告范围超出已授权模块。',409);
  for(const id of ids)await this.planning.core.module(c as Client,user,id);return ids;
 }
 async capture(user:string,body:any){const c=await this.pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const ids=await this.scope(c,user,body.module_ids);const facts=await reportFacts(c,user,body,ids,this.planning.core.now());await c.query('COMMIT');return facts;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async enqueue(c:Client,user:string,parent:string,body:any,snapshot?:any,schedule?:{kind:string;version:number;key:string}){
  parseDto('ReportGenerateInput',body);const ids=await this.scope(c,user,body.module_ids),facts=snapshot??await reportFacts(c,user,body,ids,this.planning.core.now());
  requireThat(digest(ids)===digest(facts.module_ids),'AI_NOT_AUTHORIZED','快照范围已变化。',409);
  let report=(await c.query('SELECT * FROM reports WHERE user_id=$1 AND identity_hash=$2',[user,facts.report_identity])).rows[0];
  if(!report){report=(await c.query('INSERT INTO reports(user_id,id,identity_hash,kind,request) VALUES($1,$2,$3,$4,$5) RETURNING *',[user,randomUUID(),facts.report_identity,body.kind,j({...body,module_ids:ids})])).rows[0];}
  const previous=(await c.query('SELECT v.*,b.id job_id FROM report_revisions v JOIN report_jobs b ON b.user_id=v.user_id AND b.report_id=v.report_id AND b.revision=v.revision WHERE v.user_id=$1 AND v.report_id=$2 ORDER BY v.revision DESC LIMIT 1',[user,report.id])).rows[0];
  if(previous&&!body.force_new_revision&&!previous.outdated&&snapshotDataHash(previous.facts)===snapshotDataHash(facts)&&!['failed'].includes(previous.status))return this.jobView(report.id,previous.revision,previous.job_id,previous.status);
  const revision=(previous?.revision??0)+1,job=randomUUID(),empty=facts.coverage.source_count===0&&facts.facts.find((f:any)=>f.fact_id==='wallet_net')?.value==='0'&&facts.facts.filter((f:any)=>f.fact_id.startsWith('tasks_')).every((f:any)=>f.value==='0');
  const narrative=empty?{schema_version:'report-narrative/1.0',snapshot_id:facts.snapshot_id,summary:'本周期暂无记录。可以先记录实际发生的活动，再生成报告。',selected_fact_ids:[],highlights:[],concerns:[],suggestions:[],limitations:['空报告不调用模型。']}:null;
  await c.query('INSERT INTO report_revisions(user_id,report_id,revision,status,facts,narrative,published_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[user,report.id,revision,empty?'ready':'queued',j(facts),narrative?j(narrative):null,empty?this.planning.core.now():null]);
  await c.query('INSERT INTO report_jobs(user_id,id,report_id,revision,parent_id,status,schedule_kind,schedule_version,logical_due_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[user,job,report.id,revision,parent,empty?'ready':'queued',schedule?.kind??null,schedule?.version??null,schedule?.key??null]);
  await c.query('UPDATE reports SET version=$3 WHERE user_id=$1 AND id=$2',[user,report.id,revision]);
  return this.jobView(report.id,revision,job,empty?'ready':'queued');
 }
 jobView(report:string,revision:number,job:string,status:string){return parseDto('ReportJob',{schema_version:'report-job/1.0',report_id:report,revision,job_id:job,status});}
 async generate(user:string,op:string,body:any){parseDto('ReportGenerateInput',body);
  // Replay must precede fresh permissions and snapshot checks, including after restore.
  const receipt=(await this.pool.query('SELECT response,request_hash FROM mutation_receipts WHERE user_id=$1 AND operation_id=$2',[user,op])).rows[0];if(receipt){requireThat(receipt.request_hash===digest({path:'reports/generate',body}),'IDEMPOTENCY_MISMATCH','操作键内容冲突。',409);return receipt.response;}
  const snapshot=await this.capture(user,body);return this.planning.command(user,op,'reports/generate',body,c=>this.enqueue(c,user,op,body,snapshot));
 }
 async list(user:string,q:any){parseDto('ReportListQuery',q);return (await this.pool.query('SELECT r.id,r.kind,r.version,r.request,r.created_at,v.revision,v.status,v.outdated,v.facts->\'coverage\' coverage,v.error FROM reports r JOIN report_revisions v ON v.user_id=r.user_id AND v.report_id=r.id AND v.revision=r.version WHERE r.user_id=$1 AND ($2::text IS NULL OR r.kind=$2) AND ($5::text IS NULL OR r.request->>\'period\'=$5) AND ($6::uuid IS NULL OR r.request->\'module_ids\' @> to_jsonb(ARRAY[$6::uuid])) ORDER BY r.created_at DESC,r.id LIMIT $3 OFFSET $4',[user,q.kind??null,q.limit,q.offset,q.period??null,q.module_id??null])).rows.map(r=>parseDto('ReportListItem',JSON.parse(j(r))));}
 async get(user:string,id:string,revision?:number){const r=(await this.pool.query('SELECT * FROM reports WHERE user_id=$1 AND id=$2',[user,id])).rows[0];requireThat(r,'NOT_FOUND','报告不存在。',404);
  const revisions=(await this.pool.query('SELECT v.*,b.id job_id,b.cancel_requested FROM report_revisions v JOIN report_jobs b ON b.user_id=v.user_id AND b.report_id=v.report_id AND b.revision=v.revision WHERE v.user_id=$1 AND v.report_id=$2 ORDER BY v.revision DESC',[user,id])).rows;
  const current=revisions.find(v=>v.revision===(revision??r.version));requireThat(current,'NOT_FOUND','报告修订不存在。',404);return parseDto('ReportDetail',JSON.parse(j({...r,...current,status:current.outdated&&current.status==='ready'?'outdated':current.status,revisions:revisions.map(v=>({revision:v.revision,status:v.status,outdated:v.outdated,created_at:v.created_at}))})));
 }
 async cancel(user:string,id:string,op:string,body:any){parseDto('ReportCancelInput',body);return this.planning.command(user,op,'reports/'+id+'/cancel',body,async c=>{
  const r=(await c.query('SELECT * FROM reports WHERE user_id=$1 AND id=$2',[user,id])).rows[0];requireThat(r,'NOT_FOUND','报告不存在。',404);requireThat(r.version===body.base_version,'VERSION_CONFLICT','报告已产生新修订。',409);
  const v=(await c.query('SELECT * FROM report_revisions WHERE user_id=$1 AND report_id=$2 AND revision=$3',[user,id,body.revision])).rows[0];requireThat(v,'NOT_FOUND','修订不存在。',404);if(v.status==='ready')return {report_id:id,revision:body.revision,status:'ready'};
  await c.query("UPDATE report_jobs SET cancel_requested=true,status='failed',lease_owner=NULL,lease_until=NULL WHERE user_id=$1 AND report_id=$2 AND revision=$3",[user,id,body.revision]);await c.query("UPDATE report_revisions SET status='failed',error=$4 WHERE user_id=$1 AND report_id=$2 AND revision=$3",[user,id,body.revision,j({code:'CANCELLED',message:'已取消未发布报告。'})]);return {report_id:id,revision:body.revision,status:'failed'};
 });}
 defaults(kind:string){return {enabled:false,local_time:'08:00',timezone:'Asia/Shanghai',coverage:'previous_complete',weekday:kind==='weekly'?1:null,month_day:kind==='monthly'?1:null,short_month_policy:'last_day',catch_up:'latest_only',module_ids:[]};}
 async schedules(user:string,c:Pick<Client,'query'>=this.pool){const rows=(await c.query('SELECT * FROM report_schedules WHERE user_id=$1',[user])).rows;return ['daily','weekly','monthly'].map(kind=>{const r=rows.find(r=>r.kind===kind);return parseDto('ReportScheduleProjection',JSON.parse(j({id:r?.id??null,kind,version:r?.version??1,config:r?.config??this.defaults(kind),next_run_at:r?.next_run_at??null,pause_reason:r?.pause_reason??null})));});}
 async schedulePreview(user:string,kind:string,op:string,body:any){parseDto('ReportSchedulePreviewInput',body);return this.planning.command(user,op,'report-schedules/'+kind+'/preview',body,async c=>{
  const {base_version,...config}=body;const scope=await this.scope(c,user,config.module_ids);const next=nextReportDue(kind,config,this.planning.core.now()),old=(await this.schedules(user,c)).find(s=>s.kind===kind);requireThat(old?.version===base_version,'VERSION_CONFLICT','日程已变化。',409);
  const token=randomBytes(32).toString('hex');await c.query('INSERT INTO report_schedules(user_id,kind,config,preview_hash,preview_body_hash,preview_expires_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,kind) DO UPDATE SET preview_hash=excluded.preview_hash,preview_body_hash=excluded.preview_body_hash,preview_expires_at=excluded.preview_expires_at',[user,kind,j(old!.config),digest(token),digest({body,scope}),new Date(this.planning.core.now().getTime()+600000)]);
  return parseDto('ReportSchedulePreview',{kind,base_version,config,next_run_at:config.enabled?next:null,module_ids:scope,preview_token:token,summary:'仅应用内生成报告；每期最多两次模型请求，停机最多补最新一期。',limits:{max_attempts:2,parent_max_attempts:6}});
 });}
 async saveSchedule(c:Client,user:string,kind:string,body:any,confirmed=false){
  parseDto('ReportScheduleInput',body);const {base_version,preview_token,...config}=body;const ids=config.enabled?await this.scope(c,user,config.module_ids):config.module_ids;const next=nextReportDue(kind,config,this.planning.core.now()),old=(await c.query('SELECT * FROM report_schedules WHERE user_id=$1 AND kind=$2',[user,kind])).rows[0];requireThat((old?.version??1)===base_version,'VERSION_CONFLICT','日程已变化。',409);
  if(config.enabled&&!confirmed)requireThat(old?.preview_hash&&digest(preview_token)===old.preview_hash&&old.preview_body_hash===digest({body:{base_version,...config},scope:ids})&&new Date(old.preview_expires_at)>this.planning.core.now(),'CONFIRMATION_REQUIRED','请先预览并确认收费日程。',409);
  const row=(await c.query('INSERT INTO report_schedules(user_id,kind,version,config,next_run_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,kind) DO UPDATE SET version=excluded.version,config=excluded.config,next_run_at=excluded.next_run_at,pause_reason=NULL,preview_hash=NULL,preview_body_hash=NULL,preview_expires_at=NULL RETURNING id,user_id,kind,version,config,next_run_at,pause_reason',[user,kind,base_version+1,j(config),config.enabled?next:null])).rows[0];
  if(!config.enabled){await c.query("UPDATE report_revisions v SET status='failed',error='{\"code\":\"CANCELLED\",\"message\":\"日程已关闭。\"}' FROM report_jobs b WHERE b.user_id=v.user_id AND b.report_id=v.report_id AND b.revision=v.revision AND b.user_id=$1 AND b.schedule_kind=$2 AND b.status IN ('queued','generating')",[user,kind]);await c.query("UPDATE report_jobs SET cancel_requested=true,status='failed',lease_owner=NULL,lease_until=NULL WHERE user_id=$1 AND schedule_kind=$2 AND status IN ('queued','generating')",[user,kind]);}
  const {user_id,...projection}=row;return parseDto('ReportScheduleProjection',JSON.parse(j(projection)));
 }
 async patchSchedule(user:string,kind:string,op:string,body:any){return this.planning.command(user,op,'report-schedules/'+kind,body,c=>this.saveSchedule(c,user,kind,body));}
 async scheduleTick(){
  const due=(await this.pool.query("SELECT user_id,kind FROM report_schedules WHERE (config->>'enabled')::boolean AND next_run_at <= $1 ORDER BY next_run_at LIMIT 3",[this.planning.core.now()])).rows;
  for(const row of due){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query('SELECT seq FROM user_sync_clock WHERE user_id=$1 FOR UPDATE',[row.user_id]);const s=(await c.query('SELECT * FROM report_schedules WHERE user_id=$1 AND kind=$2 FOR UPDATE',[row.user_id,row.kind])).rows[0];if(!s?.config.enabled||new Date(s.next_run_at)>this.planning.core.now()){await c.query('COMMIT');continue;}
   const d=s.config,now=this.planning.core.now(),latest=latestReportDue(s.kind,d,now),logical=s.kind+':'+latest.slice(0,10),next=nextReportDue(s.kind,d,now);
   const duplicate=(await c.query('SELECT id FROM report_jobs WHERE user_id=$1 AND schedule_kind=$2 AND logical_due_key=$3',[row.user_id,s.kind,logical])).rows.length;
   if(!duplicate&&(d.catch_up==='latest_only'||now.getTime()-new Date(s.next_run_at).getTime()<60000)){
    try{await this.enqueue(c,row.user_id,randomUUID(),{kind:s.kind,period:d.coverage==='previous_complete'?'previous':'current',start_date:null,end_date:null,timezone:d.timezone,module_ids:d.module_ids,force_new_revision:false},await reportFacts(c,row.user_id,{kind:s.kind,period:d.coverage==='previous_complete'?'previous':'current',start_date:null,end_date:null,timezone:d.timezone},await this.scope(c,row.user_id,d.module_ids),new Date(latest)),{kind:s.kind,version:s.version,key:logical});}
    catch(e){if((e as any).code==='AI_NOT_AUTHORIZED')await c.query("UPDATE report_schedules SET pause_reason='AUTHORIZATION_CHANGED',config=jsonb_set(config,'{enabled}','false') WHERE user_id=$1 AND kind=$2",[row.user_id,s.kind]);else throw e;}
   }
   await c.query('UPDATE report_schedules SET next_run_at=$3,last_due_key=$4 WHERE user_id=$1 AND kind=$2',[row.user_id,s.kind,next,logical]);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 }
 async authorize(job:any,owner?:string){
  const live=(await this.pool.query('SELECT * FROM report_jobs WHERE user_id=$1 AND id=$2',[job.user_id,job.id])).rows[0];requireThat(live&&!live.cancel_requested&&(!owner||(live.status==='generating'&&live.lease_owner===owner&&new Date(live.lease_until).getTime()>Date.now())),'CANCELLED','报告作业已取消。',409);
  const r=(await this.pool.query('SELECT facts FROM report_revisions WHERE user_id=$1 AND report_id=$2 AND revision=$3',[job.user_id,job.report_id,job.revision])).rows[0];await this.scope(this.pool,job.user_id,r.facts.module_ids);
  if(job.schedule_kind){const s=(await this.pool.query('SELECT * FROM report_schedules WHERE user_id=$1 AND kind=$2',[job.user_id,job.schedule_kind])).rows[0];requireThat(s?.config.enabled&&s.version===job.schedule_version,'CANCELLED','日程已关闭或更改。',409);}return r.facts;
 }
 async tick(){
  const c=await this.pool.connect();let job:any;const owner=randomUUID();try{await c.query('BEGIN');job=(await c.query("SELECT * FROM report_jobs WHERE NOT cancel_requested AND (status='queued' OR (status='generating' AND lease_until < now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(job){await c.query("UPDATE report_jobs SET status='generating',lease_owner=$3,lease_until=now()+interval '40 seconds' WHERE user_id=$1 AND id=$2",[job.user_id,job.id,owner]);await c.query("UPDATE report_revisions SET status='generating' WHERE user_id=$1 AND report_id=$2 AND revision=$3",[job.user_id,job.report_id,job.revision]);}await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}if(!job)return false;
  const heartbeat=setInterval(()=>{void this.pool.query("UPDATE report_jobs SET lease_until=now()+interval '40 seconds' WHERE user_id=$1 AND id=$2 AND lease_owner=$3",[job.user_id,job.id,owner]).catch(()=>{});},5000);
  let result:any,err:any;try{const facts=await this.authorize(job,owner);result=await this.jobs.call(job.user_id,job.parent_id,job.id,'report',schemaFor('report-narrative'),{schema_version:'report-analysis-input/1.0',snapshot_id:facts.snapshot_id,source_snapshot_hash:facts.content_hash,kind:facts.kind,timezone:facts.timezone,period_key:facts.period_key,partial:facts.partial,coverage:facts.coverage,warnings:facts.warnings,facts:facts.facts.map(({source_refs,...fact}:any)=>fact)},v=>narrativeValue(v,facts),async()=>{await this.authorize(job,owner);});await this.authorize(job,owner);}catch(e){err={code:e instanceof DomainError?e.code:'AI_INVALID_OUTPUT',message:e instanceof DomainError?e.message:'报告分析未通过引用或数值校验。'};}finally{clearInterval(heartbeat);}
  const end=await this.pool.connect();try{await end.query('BEGIN');await end.query('SELECT seq FROM user_sync_clock WHERE user_id=$1 FOR UPDATE',[job.user_id]);const live=(await end.query('SELECT * FROM report_jobs WHERE user_id=$1 AND id=$2',[job.user_id,job.id])).rows[0];if(live.lease_owner===owner){
   // Check again while holding the same user lock used by schedule/preferences writes.
   try{await this.authorize(job,owner);}catch(e){err={code:(e as any).code??'CANCELLED',message:'授权或日程已变化，未发布报告。'};}
   await end.query('UPDATE report_revisions SET status=$4,narrative=$5,model=$6,error=$7,published_at=$8 WHERE user_id=$1 AND report_id=$2 AND revision=$3',[job.user_id,job.report_id,job.revision,err?'failed':'ready',err?null:j(result.value),result?.model??null,err?j(err):null,err?null:this.planning.core.now()]);
   await end.query('UPDATE report_jobs SET status=$3,lease_owner=NULL,lease_until=NULL,attempts=(SELECT count(*) FROM ai_usage WHERE user_id=$1 AND run_id=$2) WHERE user_id=$1 AND id=$2',[job.user_id,job.id,err?'failed':'ready']);
   if(!err){const facts=(await end.query('SELECT facts FROM report_revisions WHERE user_id=$1 AND report_id=$2 AND revision=$3',[job.user_id,job.report_id,job.revision])).rows[0].facts;await end.query('INSERT INTO report_summaries(user_id,report_id,revision,module_ids,source_hash,summary) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[job.user_id,job.report_id,job.revision,j(facts.module_ids),facts.content_hash,result.value.summary]);}
  }await end.query('COMMIT');}catch(e){await end.query('ROLLBACK');throw e;}finally{end.release();}return true;
 }
}
