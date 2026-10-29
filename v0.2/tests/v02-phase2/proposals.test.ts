import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {fixture,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from './support.js';
import {actionProposal,internalRewardQuote} from '../../packages/contracts/src/action-proposal.js';
import {validateActionProposal} from '../../packages/ai/src/proposals.js';
test('strict offline action proposals reject privilege fields and unknown references; all reserved AI endpoints disabled',async()=>{
 const id=randomUUID(),module_id=DEFAULT_MODULE_IDS[0],record_type_id=DEFAULT_TEMPLATE_IDS[0];
 const context={panel:'records',module_ids:[module_id],record_type_ids:[record_type_id],metric_ids:[],task_template_ids:[],series_ids:[],profile_field_ids:[],source_record_ids:[],timezone:'Asia/Shanghai'};
 const candidate={schema_version:'action-proposal/1.0',context_ref:id,intent:'records.propose',proposals:[{local_ref:'record-1',action_type:'record.create',target:{module_id,record_type_id,base_version:null},data:{schema_version:1,occurred_at:'2026-10-20T09:00:00Z',timezone:'Asia/Shanghai',values:{topic:'synthetic'},task_ids:[]},source_refs:['message-1'],missing_fields:[]}],warnings:[]};
 assert.equal(validateActionProposal(candidate,context,id).proposals.length,1);
 for(const key of ['token_balance','reward_amount','award_unlocked','task_completed','patch'])assert.equal(actionProposal.safeParse({...candidate,proposals:[{...candidate.proposals[0],[key]:100}]}).success,false);
 assert.throws(()=>validateActionProposal({...candidate,proposals:[{...candidate.proposals[0],target:{...candidate.proposals[0].target,module_id:randomUUID()}}]},context,id));
 assert.equal(actionProposal.safeParse({...candidate,proposals:[{local_ref:'reward',action_type:'reward_quote',data:{amount:100},source_refs:[],missing_fields:[]}]}).success,false);
 assert.equal(internalRewardQuote.safeParse({schema_version:'reward-quote/1.0',task_id:randomUUID(),task_rule_version:1,amount:100,rationale:'fixture',provider:'disabled',model:'none',quote_version:1}).success,true);
 const f=await fixture();try{const before=(await f.pool.query('SELECT seq FROM user_sync_clock')).rows;for(const path of ['ai/context','ai/proposals','ai/proposals/preview','ai/proposals/apply','ai/proposals/cancel','ai/usage','avatar/redeem','wallet']){const r=await f.req('POST',path,{});assert.equal(r.statusCode,409);assert.equal(r.json().error.code,'FEATURE_DISABLED');}assert.deepEqual((await f.pool.query('SELECT seq FROM user_sync_clock')).rows,before);}finally{await f.close();}
});
