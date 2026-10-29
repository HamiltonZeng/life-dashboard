import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import type {Client} from '../../../packages/db/src/client.js';
import {achievementSeriesInput,type AchievementSeriesInput} from '../../../packages/contracts/src/phase2.js';
import {requireThat,type Fact} from '../../../packages/domain/src/index.js';
import {measure,matchesFilters} from '../../../packages/domain/src/phase2/rules.js';
import {validateMeasure} from './phase2-tasks.js';
import type {Core} from './phase2-core.js';

function seriesProgress(row:any,facts:Fact[],now:Date){
 const d=row.definition as AchievementSeriesInput;
 const selected=facts.filter(f=>f.record_type_id===d.record_type_id&&Date.parse(f.occurred_at)<=now.getTime()&&(d.history_policy!=='from_activation'||Date.parse(f.occurred_at)>=new Date(row.created_at).getTime())&&matchesFilters(f,d.filters));
 return measure(d.aggregation,selected,d.timezone,d.field_key);
}
export async function createSeries(core:Core,c:Client,user:string,raw:unknown){
 const d=achievementSeriesInput.parse(raw);await core.module(c,user,d.module_id);await validateMeasure(core,c,user,d.module_id,d);
 requireThat(d.aggregation==='sum'||d.field_key===null,'INVALID_BINDING','Only sum uses a numeric field');
 const thresholds=d.milestones.map(m=>new Decimal(m.threshold).toString());
 requireThat(d.milestones.every(m=>new Decimal(m.threshold).gt(0))&&new Set(thresholds).size===thresholds.length&&new Set(d.milestones.map(m=>m.id)).size===d.milestones.length,'INVALID_MILESTONES','Milestone IDs and positive thresholds must be unique');
 d.milestones.sort((a,b)=>new Decimal(a.threshold).comparedTo(b.threshold));
 const row=(await c.query('INSERT INTO achievement_series(id,user_id,module_id,record_type_id,definition,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[d.id,user,d.module_id,d.record_type_id,JSON.stringify(d),core.now()])).rows[0];
 for(const m of d.milestones)await c.query('INSERT INTO series_milestones(id,user_id,series_id,threshold,label) VALUES($1,$2,$3,$4,$5)',[m.id,user,d.id,new Decimal(m.threshold).toString(),m.label]);
 await core.event(c,user,'achievement_series',row.id,1,row);return row;
}
export async function seriesViews(core:Core,c:Client,user:string,facts?:Fact[]){
 const source=facts??await core.facts(c,user),rows=(await c.query('SELECT s.* FROM achievement_series s JOIN modules m ON m.id=s.module_id AND m.user_id=s.user_id WHERE s.user_id=$1 AND m.status=\'enabled\' AND s.archived_at IS NULL ORDER BY s.created_at,s.id',[user])).rows;
 const milestonesAll=(await c.query('SELECT * FROM series_milestones WHERE user_id=$1 ORDER BY threshold,id',[user])).rows;
 const awardsAll=(await c.query('SELECT * FROM series_awards WHERE user_id=$1',[user])).rows;
 const result=[];
 for(const row of rows){
  const milestones=milestonesAll.filter(m=>m.series_id===row.id);
  const awards=awardsAll.filter(a=>a.series_id===row.id);
  result.push({...row,progress:seriesProgress(row,source,core.now()),milestones:milestones.map(m=>({...m,threshold:new Decimal(m.threshold).toString(),award:awards.find(a=>a.milestone_id===m.id)??null}))});
 }
 return result;
}
export async function recomputeSeries(core:Core,c:Client,user:string,facts:Fact[]){
 for(const row of await seriesViews(core,c,user,facts)){
  const progress=row.progress;
  for(const m of row.milestones){
   const satisfied=new Decimal(progress.value).gte(m.threshold),old=m.award;
   if(!satisfied&&!old)continue;
   const state=satisfied?'unlocked':'needs_review';
   if(old&&old.state===state&&old.evidence.value===progress.value&&JSON.stringify(old.evidence.source_record_ids)===JSON.stringify(progress.source_record_ids))continue;
   const evidence={...progress,evaluated_at:core.now().toISOString(),threshold:m.threshold,calculation_version:1};
   let award;
   if(old)award=(await c.query('UPDATE series_awards SET state=$3,evidence=$4,evaluated_at=$5,version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *',[user,old.id,state,JSON.stringify(evidence),core.now()])).rows[0];
   else award=(await c.query("INSERT INTO series_awards(id,user_id,series_id,milestone_id,state,unlocked_at,evaluated_at,evidence,original_evidence) VALUES($1,$2,$3,$4,'unlocked',$5,$5,$6,$6) RETURNING *",[randomUUID(),user,row.id,m.id,core.now(),JSON.stringify(evidence)])).rows[0];
   await core.event(c,user,'milestone_award',award.id,award.version,award);
  }
 }
}
export async function achievementSummary(c:Client,user:string){
 const old=(await c.query("SELECT count(*) FILTER(WHERE a.state='unlocked')::int good,count(*) FILTER(WHERE a.state='needs_review')::int review FROM achievement_awards a JOIN achievement_definitions d ON d.user_id=a.user_id AND d.id=a.achievement_id JOIN modules m ON m.user_id=d.user_id AND m.id=d.module_id JOIN metric_definitions metric ON metric.user_id=d.user_id AND metric.id=d.metric_id WHERE a.user_id=$1 AND m.status='enabled' AND d.archived_at IS NULL AND metric.archived_at IS NULL",[user])).rows[0];
 const current=(await c.query("SELECT count(*) FILTER(WHERE a.state='unlocked')::int good,count(*) FILTER(WHERE a.state='needs_review')::int review,count(DISTINCT a.series_id) FILTER(WHERE a.state='unlocked')::int series FROM series_awards a JOIN achievement_series s ON s.user_id=a.user_id AND s.id=a.series_id JOIN modules m ON m.user_id=s.user_id AND m.id=s.module_id WHERE a.user_id=$1 AND m.status='enabled' AND s.archived_at IS NULL",[user])).rows[0];
 return {effective_awards_count:old.good+current.good,achieved_series_count:current.series,needs_review_count:old.review+current.review,legacy_effective_awards_count:old.good};
}
