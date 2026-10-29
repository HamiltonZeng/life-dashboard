import {mkdirSync,writeFileSync,readFileSync,existsSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {guardSynthetic} from '../tests/v02-phase3/guard.js';
import {fixture,user,module,requestReport,field} from '../tests/v03-phase2/fixtures.js';
import {DeepSeekGateway,gatewayConfig,type Gateway} from '../packages/ai/src/v03/gateway.js';
const dir='.runtime/test-artifacts/v03-phase2/real-api';mkdirSync(dir,{recursive:true});
const group=process.argv[2]??'plan',allowed=['plan','extract','correction','profile','report','schedule','reward_quote'];
assert.ok(allowed.includes(group),'Unknown real API group');
const output=(result:any)=>{writeFileSync(`${dir}/${group}.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));};
const config=gatewayConfig();
if(process.env.V03_REAL_API_CONFIRM!=='synthetic-v03-phase2'||!config.enabled||!config.configured){output({status:'not_run',group,provider_requests:0,reason:'Explicit synthetic-only confirmation, enabled server, key and model are required.'});}
else{
 guardSynthetic();const max=Number(process.env.V03_REAL_API_MAX_REQUESTS??12);assert.ok(Number.isInteger(max)&&max>=1&&max<=12,'Maximum real calls must be 1..12');
 const safe={...config,dailyJobs:Math.min(10,config.dailyJobs),dailyInput:Math.min(500000,config.dailyInput),dailyOutput:Math.min(48000,config.dailyOutput)};
 const lockPath=dir+'/active.lock',lock=openSync(lockPath,'wx',0o600),budgetPath=dir+'/budget.json',day=new Date().toISOString().slice(0,10);let budget={day,requests:0};if(existsSync(budgetPath)){const previous=JSON.parse(readFileSync(budgetPath,'utf8'));if(previous.day===day)budget=previous;}
 let calls=0;const actual=new DeepSeekGateway(safe),gateway:Gateway={generate:async(c,s)=>{assert.ok(calls<max&&budget.requests<max,'Real supplier suite request stop limit reached');calls++;budget.requests++;writeFileSync(budgetPath,JSON.stringify(budget),{mode:0o600});return actual.generate(c,s);}};
 const f=await fixture({gateway,config:safe});let result:any;
 try{
  const p=await f.ok('GET','ai/preferences');await f.ok('PATCH','ai/preferences',{base_version:p.version,automatic_mode:'preview_all',readable_module_ids:[module],auto_config_objects_limit:12,auto_record_count_limit:5});
  const apply=async(text:string)=>{const turn=await f.send(text);assert.ok(!['failed','cancelled'].includes(turn.status),JSON.stringify(turn.error));if(turn.status==='awaiting_confirmation'){await f.apply(turn);return f.service.turn(user,turn.id);}return turn;};
  const seedFact=()=>f.ok('POST','records',{id:randomUUID(),module_id:module,record_type_id:f.type.id,schema_version:1,occurred_at:'2026-10-21T01:00:00Z',timezone:'Asia/Shanghai',status:'confirmed',values:{distance:'3',minutes:20},task_ids:[]});
  if(group==='plan'||group==='reward_quote')result=await apply('帮我规划从今天起30天每天跑步3公里，复用现有跑步模板，并创建对应任务。');
  if(group==='extract')result=await apply('今天跑了3公里20分钟，请记一下。');
  if(group==='correction'){await seedFact();result=await apply('把今天唯一一条跑步记录的距离纠正为2公里，保留原时长。');}
  if(group==='profile'){const type=await f.ok('POST','record-types',{id:randomUUID(),module_id:module,name:'合成体重',fields:[field('weight','体重','decimal','kg')]});await f.ok('PATCH','profile',{base_version:1,field_upserts:[{id:randomUUID(),module_id:module,key:'weight',label:'体重',type:'decimal',kind:'observation',value:null,unit:'kg',options:[],binding:{record_type_id:type.id,field_key:'weight'}}]});result=await apply('今天我的体重65kg，请更新体重。');}
  if(group==='report'){await seedFact();const reports=[];for(const kind of ['daily','weekly','monthly']){const job=await f.ok('POST','reports/generate',requestReport(kind));await f.service.reports.tick();const r=await f.ok('GET','reports/'+job.report_id);assert.equal(r.status,'ready',JSON.stringify(r.error));reports.push({report_id:r.id,revision:r.revision,status:r.status});}result=reports;}
  if(group==='schedule')result=await apply('请设置日报每天北京时间08:00生成完整上一天的报告，停机仅补最近一期，先让我确认。');
  const usage=await f.ok('GET','ai/usage');output({status:'passed',group,provider_requests:calls,max_requests:max,usage,result_status:Array.isArray(result)?result:result?.status,real_device:'not_run'});
 }catch(e){output({status:'failed',group,provider_requests:calls,max_requests:max,error:e instanceof Error?e.message.slice(0,500):'Validation failed'});process.exitCode=1;}finally{await f.close();closeSync(lock);unlinkSync(lockPath);}
}
