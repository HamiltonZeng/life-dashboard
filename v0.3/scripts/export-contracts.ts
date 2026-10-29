import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import * as a from '../packages/contracts/src/action-proposal.js';
import * as c from '../packages/contracts/src/index.js';
const schemas={ActionProposal:a.actionProposal,AiContextInput:a.aiContextInput,ProposalGenerateInput:a.proposalGenerateInput,ProposalPreviewInput:a.proposalPreviewInput,ProposalApplyInput:a.proposalApplyInput,InternalRewardQuote:a.internalRewardQuote,TaskTemplateInput:c.taskTemplateInput,TaskTemplatePatch:c.taskTemplatePatch,MaterializeInput:c.materializeInput,TaskRevokeInput:c.revokeTaskInput,AchievementSeriesInput:c.achievementSeriesInput,Phase2ProfileInput:c.phase2ProfileInput,ObservationInput:c.observationInput,Phase2HomePreferencesInput:c.phase2HomePreferencesInput,TrendQuery:c.trendQuery,Wallet:c.walletDTO,DailyValue:c.dailyValueDTO,TrendBucket:c.trendBucketDTO,ProfileInput:c.profileInput,HomePreferencesInput:c.homePreferencesInput,ModuleInput:c.moduleInput,RecordTypeInput:c.recordTypeInput,TaskInput:c.taskInput,MetricInput:c.metricInput,AchievementInput:c.achievementInput,RecordInput:c.recordInput,RecordUpdate:c.recordUpdate,AiGenerationInput:c.aiGenerationInput,AiApplyInput:c.aiApplyInput};
const exported=Object.fromEntries(Object.entries(schemas).map(([k,v])=>[k,z.toJSONSchema(v,{io:'input',unrepresentable:'any'})]));
writeFileSync('packages/contracts/request-schemas.json',JSON.stringify(exported,null,2)+'\n');
const paths:Record<string,any>={};
const response={description:'Successful response',content:{'application/json':{schema:{type:'object',properties:{data:{},operation_id:{type:'string',format:'uuid'},page:{type:'object'}},required:['data']}}}};
const error={description:'Error envelope: error.code, error.message, optional error.details, error.request_id'};
const responses={'200':response,'400':error,'401':error,'403':error,'404':error,'409':error,'422':error,'428':error};
const aiResponses={...responses,'429':error,'502':error,'503':error,'504':error};
const mutationParams=[{in:'header',name:'Idempotency-Key',required:true,schema:{type:'string',format:'uuid'}},{in:'header',name:'Origin',required:true,schema:{type:'string'}}];
for(const [name,schema] of Object.entries({'modules':'ModuleInput','record-types':'RecordTypeInput','tasks':'TaskInput','metrics':'MetricInput','achievements':'AchievementInput','records':'RecordInput','awards':null})) {
  const path='/api/v1/'+name;
  paths[path]={get:{summary:`List ${name}`,responses,parameters:[{in:'query',name:'module_id',schema:{type:'string',format:'uuid'}},{in:'query',name:'limit',schema:{type:'integer',minimum:1,maximum:100,default:50}},{in:'query',name:'offset',schema:{type:'integer',minimum:0,maximum:100000,default:0}}]}};
  if(schema) paths[path].post={summary:`Create ${name}`,responses,parameters:mutationParams,requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/'+schema}}}}};
  paths[path+'/{id}']={parameters:[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}],get:{responses}};
}
const command=(schema:any)=>({responses,parameters:mutationParams,requestBody:{required:true,content:{'application/json':{schema}}}});
const baseVersion={type:'object',additionalProperties:false,properties:{base_version:{type:'integer',minimum:1}},required:['base_version']};
paths['/api/v1/records/{id}'].put=command({$ref:'#/components/schemas/RecordUpdate'});
paths['/api/v1/records/{id}'].delete=command(baseVersion);
paths['/api/v1/modules/{id}'].patch=command({type:'object',additionalProperties:false,properties:{...baseVersion.properties,name:{type:'string',minLength:1,maxLength:60},status:{enum:['enabled','disabled','archived']}},required:['base_version']});
paths['/api/v1/tasks/{id}/complete']={parameters:paths['/api/v1/tasks/{id}'].parameters,post:command(baseVersion)};
for(const p of ['me','capabilities','bootstrap']) paths['/api/v1/'+p]={get:{responses}};
paths['/api/v1/session']={post:{...command({type:'object',additionalProperties:false,properties:{login_secret:{type:'string',maxLength:256}},required:['login_secret']}),security:[],parameters:[mutationParams[1]]},delete:{responses,parameters:[mutationParams[1]]}};
const pageParams=[{in:'query',name:'module_id',schema:{type:'string',format:'uuid'}},{in:'query',name:'limit',schema:{type:'integer',minimum:1,maximum:100,default:50}},{in:'query',name:'offset',schema:{type:'integer',minimum:0,maximum:100000,default:0}}];
const aiIdParams=[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}];
const aiCommand=(schema:any,summary:string)=>({summary,responses:aiResponses,parameters:mutationParams,requestBody:{required:true,content:{'application/json':{schema}}}});
const emptyAiCommand=(summary:string)=>({summary,responses:aiResponses,parameters:mutationParams});
paths['/api/v1/ai/config']={get:{summary:'AI provider, model and structured-output capability status (no keys)',responses:aiResponses}};
paths['/api/v1/ai/generations']={
  get:{summary:'List AI generation jobs (candidates omitted)',responses:aiResponses,parameters:pageParams},
  post:aiCommand({$ref:'#/components/schemas/AiGenerationInput'},'Generate a module blueprint; apply atomically or keep a preview candidate')
};
paths['/api/v1/ai/generations/{id}']={parameters:aiIdParams,get:{summary:'Generation job detail with candidate and validation',responses:aiResponses}};
paths['/api/v1/ai/generations/{id}/apply']={parameters:aiIdParams,post:aiCommand({$ref:'#/components/schemas/AiApplyInput'},'Apply a preview candidate; repeated apply returns the same batch')};
paths['/api/v1/ai/generations/{id}/retry']={parameters:aiIdParams,post:emptyAiCommand('Retry a failed generation within attempt and budget limits')};
paths['/api/v1/ai/generations/{id}/cancel']={parameters:aiIdParams,post:emptyAiCommand('Cancel an unapplied candidate')};
paths['/api/v1/ai/batches']={get:{summary:'List applied AI batches',responses:aiResponses,parameters:pageParams}};
paths['/api/v1/ai/batches/{id}']={parameters:aiIdParams,get:{summary:'Applied batch with local reference to real id mapping',responses:aiResponses}};
paths['/api/v1/ai/batches/{id}/revoke']={parameters:aiIdParams,post:emptyAiCommand('Revoke a batch; delete unreferenced definitions or archive referenced configuration')};
for(const [route,schema] of [['profile','Phase2ProfileInput'],['home-preferences','Phase2HomePreferencesInput']]) paths['/api/v1/'+route]={get:{responses},patch:command({$ref:'#/components/schemas/'+schema})};
paths['/api/v1/home']={get:{responses}};
paths['/api/v1/export']={get:{summary:'Versioned, checksummed user-data export for manual S1 restore',responses}};
for(const [path,schema] of [['task-templates','TaskTemplateInput'],['task-instances/materialize','MaterializeInput'],['achievement-series','AchievementSeriesInput'],['profile/observations','ObservationInput']])paths['/api/v1/'+path]={...paths['/api/v1/'+path],post:command({$ref:'#/components/schemas/'+schema})};
paths['/api/v1/task-templates/{id}']={parameters:aiIdParams,patch:command({$ref:'#/components/schemas/TaskTemplatePatch'})};
paths['/api/v1/tasks/{id}/cancel']={parameters:aiIdParams,post:command({$ref:'#/components/schemas/TaskRevokeInput'})};
paths['/api/v1/tasks/{id}/revoke']={parameters:aiIdParams,post:command({$ref:'#/components/schemas/TaskRevokeInput'})};
for(const path of ['task-templates','task-instances','achievement-series','achievement-summary','wallet','wallet/ledger'])paths['/api/v1/'+path]={...paths['/api/v1/'+path],get:{responses}};
paths['/api/v1/metrics/{id}/trend']={parameters:aiIdParams,get:{responses,parameters:Object.entries(exported.TrendQuery.properties??{}).map(([name,schema])=>({in:'query',name,schema}))}};
for(const [route,schema] of [['context','AiContextInput'],['proposals','ProposalGenerateInput'],['proposals/preview','ProposalPreviewInput'],['proposals/apply','ProposalApplyInput']])paths['/api/v1/ai/'+route]={post:{...command({$ref:'#/components/schemas/'+schema}),description:'Reserved only: v0.2 returns FEATURE_DISABLED before reading candidate or provider.'}};
writeFileSync('packages/contracts/openapi.json',JSON.stringify({openapi:'3.1.0',info:{title:'人生面板 T2/T3 API',version:c.CONTRACT_VERSION},servers:[{url:'http://localhost:18380'}],security:[{localSession:[]}],paths,components:{securitySchemes:{localSession:{type:'apiKey',in:'cookie',name:'life_session'}},schemas:exported}},null,2)+'\n');

// Publish v0.3's canonical JSON Schemas and exact per-route request types alongside legacy DTOs.
const v03Public=JSON.parse(readFileSync('packages/contracts/v03/public-api.schema.json','utf8'));
const v03Decision=JSON.parse(readFileSync('packages/contracts/v03/ai-decision.schema.json','utf8'));
const document=JSON.parse(readFileSync('packages/contracts/openapi.json','utf8'));
document.components.schemas.V03PublicApi=v03Public;
document.components.schemas.V03Decision=v03Decision;
for(const [route,method,dto,status] of [
 ['ai/conversations','post','ConversationCreateInput','200'],['ai/conversations/{id}/messages','post','ChatMessageInput','202'],['ai/runs/{id}/clarifications','post','ClarificationInput','202'],['ai/runs/{id}/cancel','post','CancelInput','200'],['ai/proposals/{id}/preview','post','ProposalPreviewInput','200'],['ai/proposals/{id}/apply','post','ApplyInput','200'],['ai/applications/{id}/undo','post','UndoInput','200'],['ai/preferences','patch','AiPreferencesInput','200']
])document.paths['/api/v1/'+route]={[method]:{requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/V03PublicApi/$defs/'+dto}}}},responses:{[status]:{description:'Persisted result or accepted run'},'409':{description:'Conflict, disabled capability or confirmation required'}}}};
writeFileSync('packages/contracts/openapi.json',JSON.stringify(document,null,2)+'\n');
for(const [route,dto] of [['ai/applications/{id}/undo-preview','CancelInput']]){
 document.paths['/api/v1/'+route]={post:{requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/V03PublicApi/$defs/'+dto}}}},responses:{'200':{description:'Versioned compensation preview'},'409':{description:'Conflict or confirmation required'}}}};
}
for(const route of ['ai/config','ai/usage','ai/preferences','ai/conversations','ai/conversations/{id}/messages','ai/runs/{id}','ai/runs/{id}/events','ai/proposals/{id}','goals','goals/{id}']){
 const path='/api/v1/'+route;
 document.paths[path]={...document.paths[path],get:{responses:{'200':{description:route.endsWith('/events')?'Finite SSE batch, reconnect with Last-Event-ID':'Authenticated user-scoped result'},'401':{description:'Local session required'}}}};
}
for(const [path,methods] of Object.entries(document.paths) as [string,any][]){
 if(!path.includes('/ai/')&&!path.includes('/goals'))continue;
 for(const [method,operation] of Object.entries(methods) as [string,any][]){
  if(path.includes('{id}')&&!operation.parameters?.some((p:any)=>p.name==='id'&&p.in==='path'))operation.parameters=[...(operation.parameters??[]),{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}];
  if(['post','patch'].includes(method)&&path.includes('{id}')||['post','patch'].includes(method)&&['/api/v1/ai/preferences','/api/v1/ai/conversations'].includes(path))operation.parameters=[...(operation.parameters??[]),{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',format:'uuid'}}];
 }
}
writeFileSync('packages/contracts/v03/request-schemas.json',JSON.stringify(v03Public.$defs,null,2)+'\n');
writeFileSync('packages/contracts/openapi.json',JSON.stringify(document,null,2)+'\n');
// Phase-two workflows: exact DTOs and response identities, separate from legacy AI.
for(const [route,method,dto,status,responseDto] of [
 ['reports/generate','post','ReportGenerateInput','202','ReportJob'],
 ['reports/{id}/cancel','post','ReportCancelInput','200','ReportCancelResult'],
 ['report-schedules/{kind}/preview','post','ReportSchedulePreviewInput','200','ReportSchedulePreview'],
 ['report-schedules/{kind}','patch','ReportScheduleInput','200','ReportScheduleProjection']
] as const){
 const params:any[]=[...mutationParams];if(route.includes('{id}'))params.push(...aiIdParams);if(route.includes('{kind}'))params.push({name:'kind',in:'path',required:true,schema:{enum:['daily','weekly','monthly']}});
 document.paths['/api/v1/'+route]={...document.paths['/api/v1/'+route],[method]:{parameters:params,requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/V03PublicApi/$defs/'+dto}}}},responses:{[status]:{description:'Durable user-scoped result',...(responseDto?{content:{'application/json':{schema:{type:'object',properties:{data:{$ref:'#/components/schemas/V03PublicApi/$defs/'+responseDto},operation_id:{type:'string',format:'uuid'}},required:['data','operation_id'],additionalProperties:false}}}}:{})},'400':{description:'Exact DTO validation failed'},'409':{description:'Version, authorization, budget or confirmation conflict'},'428':{description:'Binding precondition required'}}}};
}
for(const route of ['reports','reports/{id}','report-schedules','records/{id}/sources','statistics/daily','ai/context/search'])document.paths['/api/v1/'+route]={...document.paths['/api/v1/'+route],get:{parameters:route.includes('{id}')?aiIdParams:[],responses:{'200':{description:'User-scoped projection, no provider call'},'401':{description:'Login required'},'404':{description:'Unknown identity'}}}};
for(const name of ['report-facts','report-narrative','internal-reward-quote'])document.components.schemas[name]=JSON.parse(readFileSync('packages/contracts/v03/'+name+'.schema.json','utf8'));
document.info.title='人生面板 v0.3 phase two API';document.info.version='0.3.0-phase2';
writeFileSync('packages/contracts/openapi.json',JSON.stringify(document,null,2)+'\n');
