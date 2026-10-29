import {createPool} from '../../packages/db/src/client.js';
import {PlanningService} from '../../apps/api/src/ai/service.js';
import {gatewayConfig} from '../../packages/ai/src/v03/gateway.js';
import {StubGateway} from './fixtures.js';
import {guardSynthetic} from '../v02-phase3/guard.js';
export function syntheticRuntime(){guardSynthetic();const pool=createPool();const gateway=new StubGateway((p,context)=>{
 const text=context.input.messages.at(-1)?.text??'';
 if(text.includes('回滚测试'))p.actions[5].data.milestones[0].threshold='0';
 if(text.includes('追问测试')&&!context.input.answers.length)return {...p,actions:[],clarification:{question:'计划持续多少天？',choices:['30天'],blocking_fields:['target_date']}};
 return p;
});return {pool,service:new PlanningService(pool,{gateway,config:{...gatewayConfig({}),rewardPricing:false,enabled:true,configured:true,apiKey:'synthetic-never-a-real-key',model:'synthetic-offline',maxInput:100000,dailyInput:1000000}})};}
