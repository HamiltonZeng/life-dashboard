import type {Client} from '../../../../packages/db/src/client.js';
import {digest} from '../../../../packages/ai/src/v03/compiler.js';
// Rebuildable cache. Raw records/revisions remain the authority; report sums do
// not read these buckets and cannot accidentally sum averages.
export async function rebuildDaily(c:Client,user:string){
 const rows=(await c.query("SELECT r.module_id,(r.occurred_at AT TIME ZONE r.timezone)::date::text business_day,jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'values',r.values) ORDER BY r.id) sources FROM records r WHERE r.user_id=$1 AND r.status='confirmed' AND r.deleted_at IS NULL GROUP BY r.module_id,(r.occurred_at AT TIME ZONE r.timezone)::date",[user])).rows;
 await c.query('DELETE FROM daily_statistics WHERE user_id=$1',[user]);
 for(const r of rows)await c.query('INSERT INTO daily_statistics(user_id,module_id,day,source_hash,statistics) VALUES($1,$2,$3,$4,$5)',[user,r.module_id,r.business_day,digest(r.sources),JSON.stringify({record_count:r.sources.length,sources:r.sources})]);
}
