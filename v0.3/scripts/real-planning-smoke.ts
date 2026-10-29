// Explicitly invoked, capped real-provider smoke. Uses only the synthetic test DB and data.
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {guardSynthetic} from '../tests/v02-phase3/guard.js';
import {createPool} from '../packages/db/src/client.js';
import {PlanningService} from '../apps/api/src/ai/service.js';
import {gatewayConfig} from '../packages/ai/src/v03/gateway.js';
import {seed,LOCAL_USER_ID,DEFAULT_MODULE_IDS} from '../packages/db/src/seed.js';
import {message} from '../tests/v03-phase1/fixtures.js';
const path='.runtime/test-artifacts/v03-phase1/real-provider.json';
guardSynthetic();const config=gatewayConfig();
if(!config.enabled||!config.configured){writeFileSync(path,JSON.stringify({status:'not_run',reason:'Server-side DeepSeek key, explicit enablement or model ID missing.',provider:'deepseek',provider_requests:0},null,2)+'\n');console.log('Real DeepSeek smoke: not_run (missing explicit server configuration).');process.exit(0);}
if(process.env.V03_RUN_REAL_SMOKE!=='1')throw new Error('Set V03_RUN_REAL_SMOKE=1 for explicit, capped real-provider acceptance.');
const pool=createPool();try{
 await seed(pool);const service=new PlanningService(pool,{config:{...config,dailyJobs:Math.min(2,config.dailyJobs)}}),user=LOCAL_USER_ID;
 const old=await service.preferences(user);await service.patchPreferences(user,randomUUID(),{base_version:old.version,automatic_mode:'preview_all',readable_module_ids:[DEFAULT_MODULE_IDS[0]],auto_config_objects_limit:12,auto_record_count_limit:5});
 const conversation=await service.createConversation(user,randomUUID(),{entrypoint:'home',title:'合成目标规划联调'});
 const accepted=await service.accept(user,conversation.data.id,randomUUID(),{...message(),execution:'preview'});await service.tick();const turn=await service.turn(user,accepted.data.run_id);
 writeFileSync(path,JSON.stringify({status:['awaiting_confirmation','needs_clarification'].includes(turn.status)?'PASS':'FAIL',run_id:turn.id,status_received:turn.status,usage:await service.usage(user),model:config.model,synthetic_data_only:true,auto_apply:false},null,2)+'\n');
 if(!['awaiting_confirmation','needs_clarification'].includes(turn.status))throw new Error('Real smoke did not produce a valid proposal or clarification; inspect sanitized result.');
 console.log('Real DeepSeek smoke PASS. No plan applied.');
}finally{await pool.end();}
