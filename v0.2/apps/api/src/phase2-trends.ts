import type {Client} from '../../../packages/db/src/client.js';
import type {Core} from './phase2-core.js';
import {requireThat} from '../../../packages/domain/src/index.js';
import {calculateTrend} from '../../../packages/domain/src/phase2/trends.js';
export async function readTrend(core:Core,c:Client,user:string,id:string,query:unknown){
 const row=(await c.query("SELECT d.* FROM metric_definitions d JOIN modules m ON m.user_id=d.user_id AND m.id=d.module_id WHERE d.user_id=$1 AND d.id=$2 AND d.archived_at IS NULL AND m.status='enabled'",[user,id])).rows[0];
 requireThat(row,'NOT_FOUND','Active metric not found',404);return calculateTrend(row,await core.facts(c,user),query,core.now());
}
