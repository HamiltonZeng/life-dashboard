import {selectHomeTasks} from '../../../packages/domain/src/phase2/home-tasks.js';
import {bindingFingerprint} from './observation-binding.js';
import {instanceViews} from './phase2-tasks.js';
import {achievementSummary} from './phase2-achievements.js';
import {readWallet} from './phase2-wallet.js';
import {validateBinding,hydrateFields} from './phase2-profile.js';
import {readTrend} from './phase2-trends.js';
import {pinToQuery} from '../../../packages/domain/src/phase2/trends.js';
import { DateTime } from 'luxon';
import { phase2ProfileInput as profileInput, phase2HomePreferencesInput as homePreferencesInput } from '../../../packages/contracts/src/index.js';
import { calculateMetric, DomainError, requireThat, validateFields, validateValues } from '../../../packages/domain/src/index.js';
import type { Client } from '../../../packages/db/src/client.js';
import type { Service } from './service.js';

export async function readProfile(c:Client,user:string,core?:Service) {
  const row=(await c.query('SELECT u.id,u.name nickname,u.timezone,p.version,p.bio FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1',[user])).rows[0];
  requireThat(row,'NOT_FOUND','User not found',404);
  const fields=(await c.query('SELECT id,module_id,key,label,type,kind,value,unit,options,binding FROM profile_fields WHERE user_id=$1 ORDER BY module_id,key,id',[user])).rows.map(({binding,...f})=>binding?{...f,binding,...(f.kind==='observation'?{binding_fingerprint:bindingFingerprint({...f,binding,user_id:user})}:{})}:f);
  return {...row,version:row.version??1,bio:row.bio??null,static_avatar_ref:null,module_fields:core?await hydrateFields(core,c,user,fields):fields};
}
export async function readPreferences(c:Client,user:string) {
  const row=(await c.query('SELECT user_id id,version,minimal_mode,pinned_metric_ids,pinned_task_ids,task_pins,pinned_trends FROM home_preferences WHERE user_id=$1',[user])).rows[0];
  const data=row??{id:user,version:1,minimal_mode:false,pinned_metric_ids:[],pinned_task_ids:[],task_pins:[],pinned_trends:[]};
  if(!data.task_pins.length&&data.pinned_task_ids.length)data.task_pins=data.pinned_task_ids.map((id:string)=>({kind:'instance',id}));
  return data;
}

export async function executeConfiguration(service:Service,c:Client,user:string,path:string,raw:unknown) {
  const isProfile=path==='profile';
  const old=isProfile?await readProfile(c,user):await readPreferences(c,user);
  const d=isProfile?profileInput.parse(raw):homePreferencesInput.parse(raw);
  if(old.version!==d.base_version) throw new DomainError('VERSION_CONFLICT','Configuration version changed',409,{current:old});
  if(isProfile) {
    const data=profileInput.parse(raw),upserts=data.field_upserts??[],removed=data.field_remove_ids??[];
    requireThat(new Set(upserts.map(f=>f.id)).size===upserts.length && new Set(removed).size===removed.length && !upserts.some(f=>removed.includes(f.id)),'INVALID_FIELDS','Repeated or contradictory field IDs');
    const existing=new Map(old.module_fields.map((f:any)=>[f.id,f]));
    for(const id of removed) {
      const field:any=existing.get(id);requireThat(field,'INVALID_REFERENCE','Field is unavailable');
      await service.module(c,user,field.module_id);
    }
    for(const f of upserts) {
      await service.module(c,user,f.module_id);
      const prior=(await c.query('SELECT user_id,module_id FROM profile_fields WHERE id=$1',[f.id])).rows[0];
      requireThat(!prior || (prior.user_id===user && prior.module_id===f.module_id),'INVALID_REFERENCE','Field belongs to another module or user');
      const field={...f,required:false,minimum:null,maximum:null};
      validateFields([field]);
      await validateBinding(service,c,user,f);
      requireThat(f.value!=='' || ['text','textarea'].includes(f.type),'INVALID_FIELD','Empty values must be null for this field type');
      validateValues([field],{[f.key]:f.value},false);
    }
    // Validate the final set before applying it, so atomic key swaps are supported.
    const final=old.module_fields.filter((f:any)=>!removed.includes(f.id)&&!upserts.some(x=>x.id===f.id)).concat(upserts);
    requireThat(final.length<=120 && new Set(final.map((f:any)=>f.module_id+':'+f.key)).size===final.length,'INVALID_FIELDS','Module field keys must be unique; at most 120 profile fields');
    await c.query('INSERT INTO user_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING',[user]);
    await c.query('INSERT INTO configuration_revisions(user_id,entity_type,version,snapshot) VALUES($1,$2,$3,$4)',[user,'profile',old.version,JSON.stringify(old)]);
    for(const id of [...removed,...upserts.map(f=>f.id)]) await c.query('DELETE FROM profile_fields WHERE user_id=$1 AND id=$2',[user,id]);
    for(const f of upserts) await c.query('INSERT INTO profile_fields(id,user_id,module_id,key,label,type,kind,value,unit,options,binding) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[f.id,user,f.module_id,f.key,f.label,f.type,f.kind,JSON.stringify(f.value),f.unit,JSON.stringify(f.options),JSON.stringify('binding' in f?f.binding:null)]);
    await c.query('UPDATE users SET name=$2,timezone=$3 WHERE id=$1',[user,data.nickname??old.nickname,data.timezone??old.timezone]);
    await c.query('UPDATE user_profiles SET version=version+1,bio=$2,updated_at=now() WHERE user_id=$1',[user,data.bio===undefined?old.bio:data.bio]);
  } else {
    const data=homePreferencesInput.parse(raw);
    requireThat(!(data.task_pins?.length&&data.pinned_task_ids?.length),'INVALID_FIELDS','Use one task pin representation');
    const taskPins=data.task_pins??data.pinned_task_ids?.map(id=>({kind:'instance' as const,id}))??old.task_pins;
    const taskIds=taskPins.filter((p:any)=>p.kind==='instance').map((p:any)=>p.id);
    requireThat(new Set((data.pinned_trends??[]).map(p=>p.metric_id)).size===(data.pinned_trends??[]).length,'INVALID_FIELDS','Duplicate trend pins');
    for(const [ids,table] of [[data.pinned_metric_ids,'metric_definitions'],[data.pinned_task_ids,'tasks']] as const) {
      for(const id of ids??[]) {
        const row=(await c.query(`SELECT o.id FROM ${table} o JOIN modules m ON m.user_id=o.user_id AND m.id=o.module_id WHERE o.user_id=$1 AND o.id=$2 AND m.status='enabled' ${table==='metric_definitions'?'AND o.archived_at IS NULL':"AND o.status NOT IN ('cancelled','skipped')"}`,[user,id])).rows[0];
        requireThat(row,'INVALID_REFERENCE','Pinned object is unavailable');
      }
    }
    for(const pin of data.task_pins??[]){
      const table=pin.kind==='template'?'task_templates':'tasks';
      const r=(await c.query(`SELECT t.id FROM ${table} t JOIN modules m ON m.user_id=t.user_id AND m.id=t.module_id WHERE t.user_id=$1 AND t.id=$2 AND m.status='enabled' ${pin.kind==='template'?"AND t.phase2 AND t.status='enabled'":"AND t.status NOT IN ('cancelled','skipped')"}`,[user,pin.id])).rows[0];requireThat(r,'INVALID_REFERENCE','Task pin unavailable');
    }
    for(const pin of data.pinned_trends??[])await readTrend(service,c,user,pin.metric_id,pinToQuery(pin));
    requireThat(!data.task_pins||new Set(data.task_pins.map(p=>p.kind+':'+p.id)).size===data.task_pins.length,'INVALID_FIELDS','Duplicate task pins');
    await c.query('INSERT INTO home_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING',[user]);
    await c.query('INSERT INTO configuration_revisions(user_id,entity_type,version,snapshot) VALUES($1,$2,$3,$4)',[user,'home_preferences',old.version,JSON.stringify(old)]);
    await c.query('UPDATE home_preferences SET version=version+1,minimal_mode=$2,pinned_metric_ids=$3,pinned_task_ids=$4,task_pins=$5,pinned_trends=$6,updated_at=now() WHERE user_id=$1',[user,data.minimal_mode??old.minimal_mode,JSON.stringify(data.pinned_metric_ids??old.pinned_metric_ids),JSON.stringify(taskIds),JSON.stringify(taskPins),JSON.stringify(data.pinned_trends??old.pinned_trends)]);
  }
  const result=isProfile?await readProfile(c,user):await readPreferences(c,user);
  await service.event(c,user,isProfile?'profile':'home_preferences',user,result.version,result);
  return result;
}

export async function readHome(service:Service,c:Client,user:string) {
  const profile=await readProfile(c,user,service),preferences=await readPreferences(c,user),now=service.now();
  const active=(await c.query("SELECT id FROM modules WHERE user_id=$1 AND status='enabled'",[user])).rows.map(r=>r.id);
  const availableMetrics=(await c.query('SELECT * FROM metric_definitions WHERE user_id=$1 AND archived_at IS NULL ORDER BY created_at,id',[user])).rows.filter(r=>active.includes(r.module_id));
  const facts=await service.facts(c,user);
  const pinOrder=(rows:any[],ids:string[])=>[...ids.map(id=>rows.find(r=>r.id===id)).filter(Boolean),...rows.filter(r=>!ids.includes(r.id))];
  const metrics=pinOrder(availableMetrics,preferences.pinned_metric_ids).map(r=>({...r,computed:calculateMetric(r.definition,facts,now)}));
  const availableTasks=(await c.query("SELECT t.*,d.category,d.period_start,d.period_end,tt.phase2,tt.status template_status,m.status module_status FROM tasks t JOIN modules m ON m.user_id=t.user_id AND m.id=t.module_id LEFT JOIN task_instance_details d ON d.user_id=t.user_id AND d.task_id=t.id LEFT JOIN task_templates tt ON tt.user_id=t.user_id AND tt.id=t.template_id WHERE t.user_id=$1 AND t.status NOT IN ('cancelled','skipped') ORDER BY t.created_at,t.id",[user])).rows.filter(r=>active.includes(r.module_id));
  const selected=selectHomeTasks(availableTasks,preferences.task_pins??[],now,profile.timezone);
  const views=new Map((await instanceViews(c,user,selected.tasks.map(t=>t.id))).map(t=>[t.id,t]));
  const tasks=selected.tasks.map(t=>views.get(t.id));
  const recent_achievements=(await c.query("SELECT a.*,d.definition,d.module_id FROM achievement_awards a JOIN achievement_definitions d ON d.user_id=a.user_id AND d.id=a.achievement_id JOIN metric_definitions m ON m.user_id=d.user_id AND m.id=d.metric_id JOIN modules mod ON mod.user_id=d.user_id AND mod.id=d.module_id AND mod.status='enabled' WHERE a.user_id=$1 AND a.state='unlocked' AND d.archived_at IS NULL AND m.archived_at IS NULL ORDER BY a.unlocked_at DESC,a.id LIMIT 10",[user])).rows.filter(r=>active.includes(r.module_id));
  const milestones=(await c.query("SELECT a.*,s.module_id,s.definition,m.threshold,m.label FROM series_awards a JOIN achievement_series s ON s.user_id=a.user_id AND s.id=a.series_id JOIN series_milestones m ON m.user_id=a.user_id AND m.id=a.milestone_id JOIN modules mod ON mod.user_id=s.user_id AND mod.id=s.module_id AND mod.status='enabled' WHERE a.user_id=$1 AND a.state='unlocked'",[user])).rows;
  recent_achievements.push(...milestones);recent_achievements.sort((a,b)=>new Date(b.unlocked_at).getTime()-new Date(a.unlocked_at).getTime()||a.id.localeCompare(b.id));recent_achievements.splice(10);
  const warnings=[...preferences.pinned_metric_ids.filter((id:string)=>!availableMetrics.some(r=>r.id===id)).map((id:string)=>({kind:'metric',id,code:'PIN_UNAVAILABLE'})),...preferences.pinned_task_ids.filter((id:string)=>!availableTasks.some(r=>r.id===id)).map((id:string)=>({kind:'task',id,code:'PIN_UNAVAILABLE'}))];
  const trends=[];for(const pin of preferences.pinned_trends??[]){if(availableMetrics.some(m=>m.id===pin.metric_id))trends.push({pin,result:await readTrend(service,c,user,pin.metric_id,pinToQuery(pin))});else warnings.push({kind:'metric',id:pin.metric_id,code:'PIN_UNAVAILABLE'});}
  const activeTemplateIds=new Set((await c.query("SELECT t.id FROM task_templates t JOIN modules m ON m.user_id=t.user_id AND m.id=t.module_id WHERE t.user_id=$1 AND t.status='enabled' AND m.status='enabled'",[user])).rows.map(t=>t.id));
  for(const pin of preferences.task_pins??[])if(pin.kind==='instance'?!availableTasks.some(t=>t.id===pin.id):!activeTemplateIds.has(pin.id))warnings.push({kind:'task',id:pin.id,code:'PIN_UNAVAILABLE'});
  return {cursor:(await c.query('SELECT seq FROM user_sync_clock WHERE user_id=$1',[user])).rows[0].seq,profile,preferences,metrics,tasks,task_count:selected.total,recent_achievements,warnings:[...new Map(warnings.map(w=>[w.kind+':'+w.id,w])).values()],trends,achievement_summary:await achievementSummary(c,user),wallet:await readWallet(c,user),avatar:{enabled:false,model_asset_ref:null}};
}
