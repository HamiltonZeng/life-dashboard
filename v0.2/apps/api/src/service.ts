import {recomputeRewards} from './phase2-wallet.js';
import {executeObservation} from './phase2-profile.js';
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DateTime } from 'luxon';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createDb, type Client } from '../../../packages/db/src/client.js';
import { activeMetrics } from '../../../packages/db/src/references.js';
import {executeTasks,recomputeTasks,instanceView,instanceViews} from './phase2-tasks.js';
import {createSeries,recomputeSeries} from './phase2-achievements.js';
import { readProfile, readPreferences, executeConfiguration, readHome } from './user-home.js';
import * as contract from '../../../packages/contracts/src/index.js';
import { calculateMetric, DomainError, requireThat, taskProgress, validateFields, validateValues, assertTaskCompletion, canRecomputeTask, type Fact } from '../../../packages/domain/src/index.js';

function canonical(v: unknown): string {
  if (Array.isArray(v)) return '['+v.map(canonical).join(',')+']';
  if (v && typeof v === 'object') return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';
  return JSON.stringify(v);
}
const json = JSON.stringify;
export class Service {
  constructor(readonly pool: pg.Pool,readonly now:()=>Date=()=>new Date()) {}
  async ready() { await createDb(this.pool).execute(sql`select 1`); }
  async module(c: Client, user: string, id: string, active = true) {
    const row = (await c.query('SELECT * FROM modules WHERE user_id=$1 AND id=$2',[user,id])).rows[0];
    requireThat(row, 'NOT_FOUND', 'Module not found', 404);
    if (active) requireThat(row.status === 'enabled', 'MODULE_INACTIVE', 'Module is disabled or archived', 409);
    return row;
  }
  async type(c: Client, user: string, module: string, id: string) {
    const row = (await c.query('SELECT * FROM record_types WHERE user_id=$1 AND module_id=$2 AND id=$3',[user,module,id])).rows[0];
    requireThat(row, 'INVALID_REFERENCE', 'Record template is unavailable in this module');
    return row;
  }
  async event(c: Client, user: string, kind: string, id: string, version: number, payload: unknown) {
    const {rows} = await c.query('UPDATE user_sync_clock SET seq=seq+1 WHERE user_id=$1 RETURNING seq',[user]);
    await c.query('INSERT INTO change_log(user_id,seq,entity_type,entity_id,version,payload) VALUES($1,$2,$3,$4,$5,$6)',[user,rows[0].seq,kind,id,version,json(payload)]);
  }
  async mutate(user: string, operation: string, method: string, path: string, body: unknown) {
    const digest = createHash('sha256').update(canonical({method,path,body})).digest('hex');
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      // Every write locks the same user clock before reading versions or receipts.
      await c.query('SELECT seq FROM user_sync_clock WHERE user_id=$1 FOR UPDATE',[user]);
      const receipt = (await c.query('SELECT * FROM mutation_receipts WHERE user_id=$1 AND operation_id=$2',[user,operation])).rows[0];
      if (receipt) {
        requireThat(receipt.request_hash === digest, 'IDEMPOTENCY_MISMATCH', 'Operation ID was already used for another command',409);
        await c.query('COMMIT'); return receipt.response;
      }
      const before=(await c.query('SELECT seq FROM user_sync_clock WHERE user_id=$1',[user])).rows[0].seq;
      const result = await this.execute(c,user,method,path,body);
      if(!['profile','home-preferences'].includes(path)) await this.recompute(c,user);
      let data=result as any;
      if(data?.instance?.id)data={...data,instance:await instanceView(c,user,data.instance.id)};
      if(path==='task-instances/materialize'&&data?.instances){const views=new Map((await instanceViews(c,user,data.instances.map((t:any)=>t.id))).map(t=>[t.id,t]));data={...data,instances:data.instances.map((t:any)=>views.get(t.id))};}
      if(path.startsWith('tasks/')&&data?.id)data=await instanceView(c,user,data.id);
      if(path==='profile/observations')data={...data,profile:await readProfile(c,user,this),impact:{cursor:(await c.query('SELECT seq FROM user_sync_clock WHERE user_id=$1',[user])).rows[0].seq,changes:(await c.query('SELECT * FROM change_log WHERE user_id=$1 AND seq>$2 ORDER BY seq',[user,before])).rows}};
      const response = {data, operation_id: operation};
      await c.query('INSERT INTO mutation_receipts(user_id,operation_id,request_hash,response) VALUES($1,$2,$3,$4)',[user,operation,digest,json(response)]);
      await c.query('COMMIT'); return response;
    } catch(e) {
      await c.query('ROLLBACK');
      if ((e as {code?:string}).code === '23505') throw new DomainError('ALREADY_EXISTS','Object ID already exists',409);
      throw e;
    } finally {c.release();}
  }
  async execute(c: Client, user: string, method: string, path: string, raw: unknown): Promise<unknown> {
    if(path==='profile/observations'&&method==='POST')return executeObservation(this,c,user,raw);
    const phase2=await executeTasks(this,c,user,method,path,raw);if(phase2!==undefined)return phase2;
    if(path==='achievement-series'&&method==='POST')return createSeries(this,c,user,raw);
    if(method==='PATCH' && ['profile','home-preferences'].includes(path)) return executeConfiguration(this,c,user,path,raw);
    const [kind,id,action] = path.split('/');
    if (id) contract.uuid.parse(id);
    if (kind === 'modules' && method === 'POST' && !id) {
      const d = contract.moduleInput.parse(raw);
      const row = (await c.query('INSERT INTO modules(id,user_id,name,description,icon,color) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[d.id,user,d.name,d.description,d.icon,d.color])).rows[0];
      await this.event(c,user,'module',d.id,1,row);return row;
    }
    if (kind === 'modules' && method === 'PATCH' && id) {
      const d = z.strictObject({base_version:z.int().positive(),name:z.string().min(1).max(60).optional(),status:z.enum(['enabled','disabled','archived']).optional()}).parse(raw);
      const old = await this.module(c,user,id,false);
      requireThat(old.version === d.base_version,'VERSION_CONFLICT','Module version changed',409);
      const row=(await c.query('UPDATE modules SET name=$3,status=$4,version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *',[user,id,d.name??old.name,d.status??old.status])).rows[0];
      await this.event(c,user,'module',id,row.version,row);return row;
    }
    if (kind === 'record-types' && method === 'POST' && !id) {
      const d = contract.recordTypeInput.parse(raw);await this.module(c,user,d.module_id);validateFields(d.fields);
      const row=(await c.query('INSERT INTO record_types(id,user_id,module_id,name,fields) VALUES($1,$2,$3,$4,$5) RETURNING *',[d.id,user,d.module_id,d.name,json(d.fields)])).rows[0];
      await this.event(c,user,'record_type',d.id,1,row);return row;
    }
    if (kind === 'tasks' && method === 'POST' && !id) {
      const d = contract.taskInput.parse(raw);await this.module(c,user,d.module_id);
      if (d.completion_mode === 'manual') requireThat(!d.record_type_id && !d.acceptance,'INVALID_BINDING','Manual tasks cannot have a record rule');
      else {
        requireThat(d.record_type_id && d.acceptance,'INVALID_BINDING','Record tasks require a template and acceptance');
        const type=await this.type(c,user,d.module_id,d.record_type_id);
        if (d.acceptance.kind === 'field_gte') {
          const key=d.acceptance.field_key;
          requireThat(type.fields.some((f:contract.Field)=>f.key===key && ['integer','decimal'].includes(f.type)), 'INVALID_BINDING','Threshold must reference a numeric field');
        }
      }
      const template = randomUUID();
      await c.query('INSERT INTO task_templates(id,user_id,module_id,definition) VALUES($1,$2,$3,$4)',[template,user,d.module_id,json(d)]);
      const row=(await c.query('INSERT INTO tasks(id,user_id,module_id,template_id,definition) VALUES($1,$2,$3,$4,$5) RETURNING *',[d.id,user,d.module_id,template,json(d)])).rows[0];
      await this.event(c,user,'task',d.id,1,row);return row;
    }
    if (kind === 'tasks' && method === 'POST' && id && action === 'complete') {
      const d=z.strictObject({base_version:z.int().positive()}).parse(raw);
      const task=(await c.query('SELECT * FROM tasks WHERE user_id=$1 AND id=$2',[user,id])).rows[0];
      requireThat(task,'NOT_FOUND','Task not found',404);await this.module(c,user,task.module_id);
      requireThat(task.version===d.base_version,'VERSION_CONFLICT','Task version changed',409);
      assertTaskCompletion(task.status,task.definition.completion_mode);
      if(task.status==='completed') return task;
      const row=(await c.query("UPDATE tasks SET status='completed',completed_at=now(),completion_origin='manual',needs_review=false,version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *",[user,id])).rows[0];
      await this.event(c,user,'task',id,row.version,row);return row;
    }
    if (kind === 'metrics' && method === 'POST' && !id) {
      const d=contract.metricInput.parse(raw);await this.module(c,user,d.module_id);
      const type=await this.type(c,user,d.module_id,d.record_type_id);
      const field=type.fields.find((f:contract.Field)=>f.key===d.field_key) as contract.Field|undefined;
      requireThat(d.aggregation==='count' ? d.field_key===null : field && ['integer','decimal'].includes(field.type) && field.unit===d.unit,'INVALID_METRIC','Aggregation requires a compatible numeric field and unit; count requires null field_key');
      const row=(await c.query('INSERT INTO metric_definitions(id,user_id,module_id,record_type_id,definition) VALUES($1,$2,$3,$4,$5) RETURNING *',[d.id,user,d.module_id,d.record_type_id,json(d)])).rows[0];
      await this.event(c,user,'metric',d.id,1,row);return row;
    }
    if (kind === 'achievements' && method === 'POST' && !id) {
      const d=contract.achievementInput.parse(raw);await this.module(c,user,d.module_id);
      const metric=(await activeMetrics((text,values)=>c.query(text,values),user,d.module_id,d.metric_id))[0];
      requireThat(metric,'INVALID_REFERENCE','Metric is unavailable in this module');
      const row=(await c.query('INSERT INTO achievement_definitions(id,user_id,module_id,metric_id,definition) VALUES($1,$2,$3,$4,$5) RETURNING *',[d.id,user,d.module_id,d.metric_id,json(d)])).rows[0];
      await this.event(c,user,'achievement',d.id,1,row);return row;
    }
    if (kind === 'records' && ((method==='POST' && !id) || (['PUT','DELETE'].includes(method) && id))) {
      let old: any;
      if(id) {
        old=(await c.query('SELECT *, ARRAY(SELECT task_id FROM record_tasks WHERE user_id=$1 AND record_id=$2) task_ids FROM records WHERE user_id=$1 AND id=$2',[user,id])).rows[0];
        requireThat(old,'NOT_FOUND','Record not found',404);
        const base=z.object({base_version:z.int().positive()}).parse(raw).base_version;
        requireThat(old.version===base && !old.deleted_at,'VERSION_CONFLICT','Record changed or was deleted',409);
      }
      if (method==='DELETE') {
        z.strictObject({base_version:z.int().positive()}).parse(raw);
        await c.query('INSERT INTO record_revisions(user_id,record_id,version,snapshot) VALUES($1,$2,$3,$4)',[user,id,old.version,json(old)]);
        const row=(await c.query('UPDATE records SET deleted_at=now(),updated_at=now(),version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *',[user,id])).rows[0];
        await this.event(c,user,'record',id!,row.version,{id,version:row.version,deleted_at:row.deleted_at});return {id,version:row.version,deleted_at:row.deleted_at};
      }
      const d = id ? {...contract.recordUpdate.parse(raw),id} : contract.recordInput.parse(raw);
      requireThat(!old || (old.module_id===d.module_id && old.record_type_id===d.record_type_id),'IMMUTABLE_TEMPLATE','Record module and template cannot be changed');
      await this.module(c,user,d.module_id);
      const type=await this.type(c,user,d.module_id,d.record_type_id);
      requireThat(type.schema_version===d.schema_version,'SCHEMA_CONFLICT','Template version changed',409);
      validateValues(type.fields,d.values,d.status==='confirmed');
      requireThat(new Set(d.task_ids).size===d.task_ids.length,'INVALID_BINDING','Duplicate task links');
      for(const taskId of d.task_ids) {
        const t=(await c.query('SELECT * FROM tasks WHERE user_id=$1 AND id=$2',[user,taskId])).rows[0];
        requireThat(t && t.module_id===d.module_id && t.definition.record_type_id===d.record_type_id,'INVALID_BINDING','Task is unavailable or incompatible');
        const date=DateTime.fromISO(d.occurred_at).setZone(t.definition.timezone).toISODate();
        requireThat(!t.definition.business_date || t.definition.business_date===date,'TASK_DATE_MISMATCH','Record occurrence date does not match this task instance');
      }
      if(old) await c.query('INSERT INTO record_revisions(user_id,record_id,version,snapshot) VALUES($1,$2,$3,$4)',[user,id,old.version,json(old)]);
      let row;
      if(old) row=(await c.query('UPDATE records SET occurred_at=$3,timezone=$4,status=$5,values=$6,version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *',[user,id,d.occurred_at,d.timezone,d.status,json(d.values)])).rows[0];
      else row=(await c.query('INSERT INTO records(id,user_id,module_id,record_type_id,schema_version,occurred_at,timezone,status,values) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[d.id,user,d.module_id,d.record_type_id,d.schema_version,d.occurred_at,d.timezone,d.status,json(d.values)])).rows[0];
      await c.query('DELETE FROM record_tasks WHERE user_id=$1 AND record_id=$2',[user,d.id]);
      for(const task of d.task_ids) await c.query('INSERT INTO record_tasks(user_id,record_id,task_id) VALUES($1,$2,$3)',[user,d.id,task]);
      row.task_ids=d.task_ids;await this.event(c,user,'record',d.id,row.version,row);return row;
    }
    throw new DomainError('NOT_IMPLEMENTED','Command is outside the T0/T1 contract',404);
  }
  async facts(c: Client, user: string): Promise<Fact[]> {
    const {rows}=await c.query("SELECT id,module_id,version,record_type_id,occurred_at,values,ARRAY(SELECT task_id FROM record_tasks l WHERE l.user_id=r.user_id AND l.record_id=r.id) task_ids FROM records r WHERE user_id=$1 AND status='confirmed' AND deleted_at IS NULL",[user]);
    return rows.map(r=>({...r,occurred_at:r.occurred_at.toISOString()}));
  }
  async recompute(c: Client,user: string) {
    const facts=await this.facts(c,user);
    for(const t of (await c.query('SELECT * FROM tasks WHERE user_id=$1 AND NOT EXISTS(SELECT 1 FROM task_instance_details d WHERE d.user_id=tasks.user_id AND d.task_id=tasks.id)',[user])).rows) {
      if(t.definition.completion_mode==='manual' || t.completion_origin==='manual' || !canRecomputeTask(t.status)) continue;
      const p=taskProgress(t.definition,facts);
      const review=p.satisfied ? false : t.needs_review || t.status==='completed';
      if(t.status!==p.status || t.needs_review!==review) {
        const row=(await c.query('UPDATE tasks SET status=$3,needs_review=$4,completed_at=CASE WHEN $3=\'completed\' THEN COALESCE(completed_at,now()) ELSE NULL END,completion_origin=\'evidence\',version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *',[user,t.id,p.status,review])).rows[0];
        await this.event(c,user,'task',t.id,row.version,row);
      }
    }
    const defs=(await c.query('SELECT a.*,m.definition metric FROM achievement_definitions a JOIN metric_definitions m ON a.metric_id=m.id AND a.user_id=m.user_id WHERE a.user_id=$1 AND a.archived_at IS NULL AND m.archived_at IS NULL',[user])).rows;
    const satisfiedBy=(a:any,evidence:any)=>evidence.value!==null && (a.definition.operator==='gte' ? new Decimal(evidence.value).gte(a.definition.threshold) : new Decimal(evidence.value).lte(a.definition.threshold));
    const activationOf=(a:any)=>a.definition.history_policy==='from_activation'?a.created_at.toISOString():undefined;
    for(const a of defs) {
      if(a.definition.repeat_policy==='per_period') {
        // Re-evaluate every retained period, not only the current one, so modified/deleted evidence still triggers review.
        const awards=(await c.query('SELECT * FROM achievement_awards WHERE user_id=$1 AND achievement_id=$2 ORDER BY unlocked_at,id',[user,a.id])).rows;
        for(const award of awards) {
          const at=new Date(award.original_evidence.evaluated_at);
          const evidence=calculateMetric(a.metric,facts,at,activationOf(a));
          const state=satisfiedBy(a,evidence)?'unlocked':'needs_review';
          if(award.state!==state || canonical(award.evidence.source_record_ids)!==canonical(evidence.source_record_ids) || award.evidence.value!==evidence.value) {
            const row=(await c.query('UPDATE achievement_awards SET state=$3,evidence=$4,evaluated_at=now(),version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *',[user,award.id,state,json(evidence)])).rows[0];
            await this.event(c,user,'award',row.id,row.version,row);
          }
        }
        const current=calculateMetric(a.metric,facts,new Date(),activationOf(a));
        const periodKey=current.period;
        const existing=awards.find((x:any)=>x.period_key===periodKey);
        if(!existing && satisfiedBy(a,current)) {
          const row=(await c.query("INSERT INTO achievement_awards(id,user_id,achievement_id,rule_version,period_key,state,evidence,original_evidence) VALUES($1,$2,$3,$4,$5,'unlocked',$6,$6) RETURNING *",[randomUUID(),user,a.id,a.version,periodKey,json(current)])).rows[0];
          await this.event(c,user,'award',row.id,1,row);
        }
      } else {
        // Once-only awards retain their original statistical period when the calendar advances.
        const old=(await c.query("SELECT * FROM achievement_awards WHERE user_id=$1 AND achievement_id=$2 AND period_key='once'",[user,a.id])).rows[0];
        const at=old ? new Date(old.original_evidence.evaluated_at) : new Date();
        const evidence=calculateMetric(a.metric,facts,at,activationOf(a));
        const satisfied=satisfiedBy(a,evidence);
        if(!old && satisfied) {
          const row=(await c.query("INSERT INTO achievement_awards(id,user_id,achievement_id,rule_version,period_key,state,evidence,original_evidence) VALUES($1,$2,$3,$4,'once','unlocked',$5,$5) RETURNING *",[randomUUID(),user,a.id,a.version,json(evidence)])).rows[0];
          await this.event(c,user,'award',row.id,1,row);
        } else if(old) {
          const state=satisfied?'unlocked':'needs_review';
          if(old.state!==state || canonical(old.evidence.source_record_ids)!==canonical(evidence.source_record_ids) || old.evidence.value!==evidence.value) {
            const row=(await c.query('UPDATE achievement_awards SET state=$3,evidence=$4,evaluated_at=now(),version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *',[user,old.id,state,json(evidence)])).rows[0];
            await this.event(c,user,'award',row.id,row.version,row);
          }
        }
      }
    }
    await recomputeTasks(this,c,user,facts);
    await recomputeSeries(this,c,user,facts);
    await recomputeRewards(this,c,user);
  }
  async read<T>(fn:(c:Client)=>Promise<T>):Promise<T>{
    const c=await this.pool.connect();
    try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const data=await fn(c);await c.query('COMMIT');return data;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async configuration(user:string,kind:string) {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const data=kind==='profile'?await readProfile(c,user,this):kind==='home-preferences'?await readPreferences(c,user):await readHome(this,c,user);
      await c.query('COMMIT');return data;
    } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
  }
  async snapshot(user: string) {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const tables=['modules','record_types','tasks','metric_definitions','achievement_definitions','achievement_awards'];
      const data: Record<string,any>={};
      for(const table of tables) {
        const archived=table==='metric_definitions'||table==='achievement_definitions'?' AND archived_at IS NULL':'';
        data[table]=(await c.query(`SELECT * FROM ${table} WHERE user_id=$1${archived} ORDER BY ${table==='achievement_awards'?'unlocked_at':'created_at'},id`,[user])).rows;
      }
      const facts=await this.facts(c,user);
      data.metrics=data.metric_definitions.map((r:any)=>({...r,computed:calculateMetric(r.definition,facts)}));
      data.records=(await c.query('SELECT r.*,ARRAY(SELECT task_id FROM record_tasks l WHERE l.user_id=r.user_id AND l.record_id=r.id) task_ids FROM records r WHERE user_id=$1 AND deleted_at IS NULL ORDER BY occurred_at DESC,id',[user])).rows;
      data.cursor=(await c.query('SELECT seq FROM user_sync_clock WHERE user_id=$1',[user])).rows[0].seq;
      await c.query('COMMIT');return data;
    } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
  }
}
