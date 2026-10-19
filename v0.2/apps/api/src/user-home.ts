import { DateTime } from 'luxon';
import { profileInput, homePreferencesInput } from '../../../packages/contracts/src/index.js';
import { calculateMetric, DomainError, requireThat, validateFields, validateValues } from '../../../packages/domain/src/index.js';
import type { Client } from '../../../packages/db/src/client.js';
import type { Service } from './service.js';

export async function readProfile(c:Client,user:string) {
  const row=(await c.query('SELECT u.id,u.name nickname,u.timezone,p.version,p.bio FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1',[user])).rows[0];
  requireThat(row,'NOT_FOUND','User not found',404);
  return {...row,version:row.version??1,bio:row.bio??null,static_avatar_ref:null,
    module_fields:(await c.query('SELECT id,module_id,key,label,type,kind,value,unit,options FROM profile_fields WHERE user_id=$1 ORDER BY module_id,key,id',[user])).rows};
}
export async function readPreferences(c:Client,user:string) {
  const row=(await c.query('SELECT user_id id,version,minimal_mode,pinned_metric_ids,pinned_task_ids FROM home_preferences WHERE user_id=$1',[user])).rows[0];
  return {...(row??{id:user,version:1,minimal_mode:false,pinned_metric_ids:[],pinned_task_ids:[]}),pinned_trends:[]};
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
      requireThat(f.value!=='' || ['text','textarea'].includes(f.type),'INVALID_FIELD','Empty values must be null for this field type');
      validateValues([field],{[f.key]:f.value},false);
    }
    // Validate the final set before applying it, so atomic key swaps are supported.
    const final=old.module_fields.filter((f:any)=>!removed.includes(f.id)&&!upserts.some(x=>x.id===f.id)).concat(upserts);
    requireThat(final.length<=120 && new Set(final.map((f:any)=>f.module_id+':'+f.key)).size===final.length,'INVALID_FIELDS','Module field keys must be unique; at most 120 profile fields');
    await c.query('INSERT INTO user_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING',[user]);
    await c.query('INSERT INTO configuration_revisions(user_id,entity_type,version,snapshot) VALUES($1,$2,$3,$4)',[user,'profile',old.version,JSON.stringify(old)]);
    for(const id of [...removed,...upserts.map(f=>f.id)]) await c.query('DELETE FROM profile_fields WHERE user_id=$1 AND id=$2',[user,id]);
    for(const f of upserts) await c.query('INSERT INTO profile_fields(id,user_id,module_id,key,label,type,kind,value,unit,options) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[f.id,user,f.module_id,f.key,f.label,f.type,f.kind,JSON.stringify(f.value),f.unit,JSON.stringify(f.options)]);
    await c.query('UPDATE users SET name=$2,timezone=$3 WHERE id=$1',[user,data.nickname??old.nickname,data.timezone??old.timezone]);
    await c.query('UPDATE user_profiles SET version=version+1,bio=$2,updated_at=now() WHERE user_id=$1',[user,data.bio===undefined?old.bio:data.bio]);
  } else {
    const data=homePreferencesInput.parse(raw);
    for(const [ids,table] of [[data.pinned_metric_ids,'metric_definitions'],[data.pinned_task_ids,'tasks']] as const) {
      for(const id of ids??[]) {
        const row=(await c.query(`SELECT o.id FROM ${table} o JOIN modules m ON m.user_id=o.user_id AND m.id=o.module_id WHERE o.user_id=$1 AND o.id=$2 AND m.status='enabled' ${table==='metric_definitions'?'AND o.archived_at IS NULL':"AND o.status NOT IN ('cancelled','skipped')"}`,[user,id])).rows[0];
        requireThat(row,'INVALID_REFERENCE','Pinned object is unavailable');
      }
    }
    await c.query('INSERT INTO home_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING',[user]);
    await c.query('INSERT INTO configuration_revisions(user_id,entity_type,version,snapshot) VALUES($1,$2,$3,$4)',[user,'home_preferences',old.version,JSON.stringify(old)]);
    await c.query('UPDATE home_preferences SET version=version+1,minimal_mode=$2,pinned_metric_ids=$3,pinned_task_ids=$4,updated_at=now() WHERE user_id=$1',[user,data.minimal_mode??old.minimal_mode,JSON.stringify(data.pinned_metric_ids??old.pinned_metric_ids),JSON.stringify(data.pinned_task_ids??old.pinned_task_ids)]);
  }
  const result=isProfile?await readProfile(c,user):await readPreferences(c,user);
  await service.event(c,user,isProfile?'profile':'home_preferences',user,result.version,result);
  return result;
}

export async function readHome(service:Service,c:Client,user:string) {
  const profile=await readProfile(c,user),preferences=await readPreferences(c,user),now=new Date();
  const active=(await c.query("SELECT id FROM modules WHERE user_id=$1 AND status='enabled'",[user])).rows.map(r=>r.id);
  const availableMetrics=(await c.query('SELECT * FROM metric_definitions WHERE user_id=$1 AND archived_at IS NULL ORDER BY created_at,id',[user])).rows.filter(r=>active.includes(r.module_id));
  const facts=await service.facts(c,user);
  const pinOrder=(rows:any[],ids:string[])=>[...ids.map(id=>rows.find(r=>r.id===id)).filter(Boolean),...rows.filter(r=>!ids.includes(r.id))];
  const metrics=pinOrder(availableMetrics,preferences.pinned_metric_ids).map(r=>({...r,computed:calculateMetric(r.definition,facts,now)}));
  const availableTasks=(await c.query("SELECT * FROM tasks WHERE user_id=$1 AND status NOT IN ('cancelled','skipped') ORDER BY created_at,id",[user])).rows.filter(r=>active.includes(r.module_id));
  const today=DateTime.fromJSDate(now,{zone:profile.timezone}).toISODate();
  const tasks=pinOrder(availableTasks.filter(r=>preferences.pinned_task_ids.includes(r.id)||r.definition.business_date===today),preferences.pinned_task_ids);
  const recent_achievements=(await c.query("SELECT a.*,d.definition,d.module_id FROM achievement_awards a JOIN achievement_definitions d ON d.user_id=a.user_id AND d.id=a.achievement_id JOIN metric_definitions m ON m.user_id=d.user_id AND m.id=d.metric_id JOIN modules mod ON mod.user_id=d.user_id AND mod.id=d.module_id AND mod.status='enabled' WHERE a.user_id=$1 AND a.state='unlocked' AND d.archived_at IS NULL AND m.archived_at IS NULL ORDER BY a.unlocked_at DESC,a.id LIMIT 10",[user])).rows.filter(r=>active.includes(r.module_id));
  const warnings=[...preferences.pinned_metric_ids.filter((id:string)=>!availableMetrics.some(r=>r.id===id)).map((id:string)=>({kind:'metric',id,code:'PIN_UNAVAILABLE'})),...preferences.pinned_task_ids.filter((id:string)=>!availableTasks.some(r=>r.id===id)).map((id:string)=>({kind:'task',id,code:'PIN_UNAVAILABLE'}))];
  return {cursor:(await c.query('SELECT seq FROM user_sync_clock WHERE user_id=$1',[user])).rows[0].seq,profile,preferences,metrics,tasks,recent_achievements,warnings,wallet:null,avatar:{enabled:false,model_asset_ref:null}};
}
