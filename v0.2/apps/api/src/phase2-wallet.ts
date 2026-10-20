import {randomUUID} from 'node:crypto';
import type {Client} from '../../../packages/db/src/client.js';
import type {Core} from './phase2-core.js';
import {ledgerQuery} from '../../../packages/contracts/src/phase2.js';
import {REWARD_POLICY,quotaPeriod} from '../../../packages/domain/src/phase2/rules.js';
export async function readWallet(c:Client,user:string){
 const a=(await c.query('SELECT u.timezone fallback,a.timezone,a.version FROM users u LEFT JOIN reward_accounts a ON a.user_id=u.id WHERE u.id=$1',[user])).rows[0];
 const balance=(await c.query('SELECT coalesce(sum(amount),0)::text balance FROM wallet_ledger WHERE user_id=$1',[user])).rows[0].balance;
 return {id:user,version:a.version??1,balance,effective_earned:balance,currency:'token',policy_version:REWARD_POLICY.version,quota_timezone:a.timezone??a.fallback};
}
export async function readLedger(c:Client,user:string,raw:unknown){
 const q=ledgerQuery.parse(raw),args=[user,q.task_id??null];
 const total=Number((await c.query('SELECT count(*) FROM wallet_ledger WHERE user_id=$1 AND ($2::uuid IS NULL OR task_id=$2)',args)).rows[0].count);
 const rows=(await c.query('SELECT * FROM wallet_ledger WHERE user_id=$1 AND ($2::uuid IS NULL OR task_id=$2) ORDER BY created_at DESC,qualification_id,ordinal DESC LIMIT $3 OFFSET $4',[...args,q.limit,q.offset])).rows;
 return {data:rows,page:{total,limit:q.limit,offset:q.offset}};
}
export async function recomputeRewards(core:Core,c:Client,user:string){
 const rows=(await c.query('SELECT t.id,t.status,t.needs_review,d.* FROM tasks t JOIN task_instance_details d ON d.user_id=t.user_id AND d.task_id=t.id WHERE t.user_id=$1 ORDER BY t.created_at,t.id',[user])).rows;
 for(const t of rows){
  const valid=t.status==='completed'&&!t.needs_review;let q=(await c.query('SELECT * FROM reward_qualifications WHERE user_id=$1 AND task_id=$2',[user,t.id])).rows[0];
  if(!q&&valid){
   const account=(await c.query('SELECT timezone FROM reward_accounts WHERE user_id=$1',[user])).rows[0];
   const period=t.quota_period??quotaPeriod(t.category,account.timezone,core.now());
   const count=Number((await c.query('SELECT count(*) FROM reward_qualifications WHERE user_id=$1 AND category=$2 AND quota_period=$3 AND eligible',[user,t.category,period])).rows[0].count);
   const expired=t.reward_deadline&&core.now().getTime()>t.reward_deadline.getTime(),full=count>=REWARD_POLICY[t.category as keyof Pick<typeof REWARD_POLICY,'main'|'daily'|'weekly'|'monthly'>].limit;
   q=(await c.query('INSERT INTO reward_qualifications(id,user_id,task_id,category,quota_period,policy_version,amount,eligible,denial_reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[randomUUID(),user,t.id,t.category,period,t.reward_policy_version,t.reward_candidate,!expired&&!full,expired?'expired':full?'quota_full':null,core.now()])).rows[0];
   await core.event(c,user,'reward_qualification',q.id,1,q);
  }
  if(!q?.eligible)continue;
  const last=(await c.query('SELECT * FROM wallet_ledger WHERE user_id=$1 AND qualification_id=$2 ORDER BY ordinal DESC LIMIT 1',[user,q.id])).rows[0];
  const positive=last&&last.kind!=='reversal';if(Boolean(positive)===valid)continue;
  const id=randomUUID(),kind=!last?'grant':valid?'reinstatement':'reversal',amount=valid?String(q.amount):'-'+q.amount;
  const entry=(await c.query('INSERT INTO wallet_ledger(id,user_id,task_id,qualification_id,ordinal,kind,amount,policy_version,root_entry_id,previous_entry_id,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',[id,user,t.id,q.id,(last?.ordinal??0)+1,kind,amount,q.policy_version,q.original_grant_id??id,last?.id??null,kind==='grant'?'first_valid_completion':kind==='reversal'?'completion_revoked_or_evidence_changed':'completion_restored',core.now()])).rows[0];
  if(!last)await c.query('UPDATE reward_qualifications SET original_grant_id=$3 WHERE user_id=$1 AND id=$2',[user,q.id,id]);
  await c.query('UPDATE reward_accounts SET version=version+1 WHERE user_id=$1',[user]);
  await core.event(c,user,'wallet_entry',id,entry.ordinal,entry);
  const wallet=await readWallet(c,user);await core.event(c,user,'wallet',user,wallet.version,wallet);
 }
}
