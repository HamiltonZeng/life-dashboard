import {createPool} from '../../packages/db/src/client.js';
import {PlanningService} from '../../apps/api/src/ai/service.js';
import {gatewayConfig} from '../../packages/ai/src/v03/gateway.js';
import {WorkflowGateway} from './fixtures.js';
import {makePlan} from '../v03-phase1/fixtures.js';
import {guardSynthetic} from '../v02-phase3/guard.js';
export function syntheticRuntime(){guardSynthetic();const pool=createPool(),gateway=new WorkflowGateway();const generate=gateway.generate.bind(gateway);gateway.generate=async(c,s)=>{if(c.purpose!=='report'&&c.purpose!=='reward_quote'&&c.input.messages.at(-1).text.includes('英语'))return {value:makePlan(c),model:'synthetic-offline',usage:{input:100,output:200}};return generate(c,s);};return {pool,service:new PlanningService(pool,{gateway,config:{...gatewayConfig({}),enabled:true,configured:true,apiKey:'synthetic-never-real',model:'synthetic-offline',maxInput:100000,dailyInput:1000000,dailyOutput:100000},now:()=>new Date('2026-10-21T04:00:00Z')})};}
