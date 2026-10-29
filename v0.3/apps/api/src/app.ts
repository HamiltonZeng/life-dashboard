import {PlanningService} from './ai/service.js';
import {registerPlanning} from './ai/routes.js';
import {readWallet,readLedger} from './phase2-wallet.js';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import type pg from 'pg';
import {readTrend} from './phase2-trends.js';
import {readTaskTemplates,readTaskInstances,readSeries,achievementSummary} from './phase2-read.js';
import { Service } from './service.js';
import { DomainError, requireThat } from '../../../packages/domain/src/index.js';
import { CONTRACT_VERSION, aiApplyInput, aiEmptyInput, aiGenerationInput, pageQuery, uuid } from '../../../packages/contracts/src/index.js';
import { LOCAL_USER_ID } from '../../../packages/db/src/seed.js';
import { exportUserData } from '../../../packages/db/src/backup.js';
import { AiService } from '../../../packages/ai/src/service.js';
import { DeepSeekAdapter, MockAdapter, type ModelAdapter } from '../../../packages/ai/src/adapter.js';
import { loadAiConfig, type AiConfig } from '../../../packages/ai/src/config.js';
import {loadAppProfile,type AppProfile} from './profile.js';

const hash = (s:string)=>createHash('sha256').update(s).digest('hex');
export async function buildApp(pool:pg.Pool, options:{logger?:boolean; loginSecret?:string; origin?:string; profile?:AppProfile; ai?:AiService; aiConfig?:AiConfig; aiAdapter?:ModelAdapter; now?:()=>Date;planning?:PlanningService}={}) {
  const profile=loadAppProfile(options.profile??process.env.APP_PROFILE);
  const secret=options.loginSecret??process.env.LOCAL_LOGIN_SECRET;
  if(!secret || secret.length<32) throw new Error('LOCAL_LOGIN_SECRET must contain at least 32 characters');
  const origin=options.origin??process.env.APP_ORIGIN??'http://localhost:18080';
  const secure=new URL(origin).protocol==='https:';
  const service=new Service(pool,options.now);
  const planning=options.planning??new PlanningService(pool,{now:options.now});
  // Disabled MVP AI must not even parse stale provider configuration or construct an adapter.
  const createAi=()=>{
    const aiConfig=options.aiConfig??loadAiConfig();
    const aiAdapter=options.aiAdapter??(aiConfig.provider==='deepseek'
      ? new DeepSeekAdapter({apiKey:aiConfig.apiKey??'',model:aiConfig.model,baseUrl:aiConfig.baseUrl})
      : new MockAdapter());
    return options.ai??new AiService(pool,aiConfig,aiAdapter,{
    event:(c,user,kind,id,version,payload)=>service.event(c,user,kind,id,version,payload),
    recompute:(c,user)=>service.recompute(c,user)
    });
  };
  const ai=profile==='development'?createAi():null;
  const disabledAi={profile:'mvp',enabled:false,provider:'disabled',cloud_ai:false,configured:false,model:'',schema_version:'1.0',supported_content_types:[],notes:['v0.3 开发准备环境，AI 功能尚未实现。']};
  const app=Fastify({logger:options.logger??false,bodyLimit:128*1024,requestTimeout:15000});
  await app.register(rateLimit,{global:false});
  app.decorateRequest('accountId','');
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof ZodError) return reply.code(error.issues.some(i=>i.code==='too_big' && ['pinned_metric_ids','pinned_task_ids'].includes(String(i.path[0])))?422:400).send({error:{code:'VALIDATION_ERROR',message:'Request failed validation',details:error.issues.map(i=>({path:i.path,message:i.message})),request_id:request.id}});
    if(error instanceof DomainError) return reply.code(error.status).send({error:{code:error.code,message:error.message,details:error.details,request_id:request.id}});
    const status=(error as {statusCode?:number}).statusCode;
    if(status && status<500) return reply.code(status).send({error:{code:status===429?'RATE_LIMITED':'BAD_REQUEST',message:status===429?'Too many requests':'Invalid request',request_id:request.id}});
    // Do not log payloads, credentials or raw driver errors.
    request.log.error({request_id:request.id,code:'INTERNAL_ERROR'},'Request failed');
    return reply.code(500).send({error:{code:'INTERNAL_ERROR',message:'Internal server error',request_id:request.id}});
  });
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('Cache-Control','no-store');
    if(req.url.startsWith('/health/')) return;
    if(!['GET','HEAD','OPTIONS'].includes(req.method)) requireThat(req.headers.origin===origin,'INVALID_ORIGIN','Origin is not allowed',403);
    if(req.url.split('?')[0]==='/api/v1/session' && req.method==='POST') return;
    const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('life_session='))?.slice('life_session='.length);
    requireThat(cookie && /^[a-f0-9]{64}$/.test(cookie),'UNAUTHENTICATED','Local login required',401);
    const row=(await pool.query('SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>now()',[hash(cookie)])).rows[0];
    requireThat(row,'UNAUTHENTICATED','Session expired or revoked',401);
    req.accountId=row.user_id;
    const path=req.url.split('?')[0];
    if(/^\/api\/v1\/(ai\/(chat|recording|profile-update|reward-pricing)|avatar\/(render|redeem))(\/|$)/.test(path)) throw new DomainError('FEATURE_DISABLED','This capability is not available',409);
    if(path.startsWith('/api/v1/wallet')&&req.method!=='GET')throw new DomainError('FEATURE_DISABLED','Wallet writes are internal only',409);
    if(profile==='mvp' && path.startsWith('/api/v1/ai/') && !/^\/api\/v1\/ai\/(config|usage|preferences|conversations|runs|proposals|applications|context\/search)(\/|$)/.test(path)) {
      throw new DomainError('FEATURE_DISABLED','AI is disabled in the MVP profile',409);
    }
  });
  app.get('/health/live',async()=>({status:'ok'}));
  app.get('/health/ready',async(_req,reply)=>{
    try {await service.ready();await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');return {status:'ok'};} catch {return reply.code(503).send({status:'unavailable'});}
  });
  app.post('/api/v1/session',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
    const body=z.strictObject({login_secret:z.string().max(256)}).parse(req.body);
    requireThat(timingSafeEqual(Buffer.from(hash(body.login_secret)),Buffer.from(hash(secret))),'INVALID_CREDENTIALS','Invalid local login secret',401);
    const token=randomBytes(32).toString('hex');
    await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",[hash(token),LOCAL_USER_ID]);
    reply.header('Set-Cookie',`life_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=604800${secure?'; Secure':''}`);
    return {data:{user_id:LOCAL_USER_ID,expires_in:604800}};
  });
  app.delete('/api/v1/session',async(req,reply)=>{
    const cookie=req.headers.cookie!.split(';').map(x=>x.trim()).find(x=>x.startsWith('life_session='))!.slice('life_session='.length);
    await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(cookie)]);
    reply.header('Set-Cookie',`life_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`);
    return {data:{signed_out:true}};
  });
  app.get('/api/v1/me',async req=>({data:(await pool.query('SELECT id,name,timezone FROM users WHERE id=$1',[req.accountId])).rows[0]}));
  app.get('/api/v1/capabilities',async req=>({data:{
    contract_version:CONTRACT_VERSION,profile,stage:profile==='mvp'?'v0.3-phase2':'T2/T3-ai',sync:false,
    cloud_ai:profile==='mvp'?(await planning.configView(req.accountId)).enabled:ai?.configSummary().cloud_ai??false,ai_planning:profile==='mvp'?(await planning.configView(req.accountId)).enabled:false,legacy_ai_generation:ai!==null,ai_generation:profile==='mvp'?(await planning.configView(req.accountId)).enabled:ai!==null,ai_provider:profile==='mvp'?((await planning.configView(req.accountId)).enabled?'deepseek':'disabled'):ai?.configSummary().provider??'disabled',
    ai_schema_version:'1.0',ai_preview:ai!==null,
    app_version:'0.3.0-phase2',home:true,home_preferences:true,profile_fields:true,ai_chat:profile==='mvp'?(await planning.configView(req.accountId)).enabled:false,ai_recording:(await planning.configView(req.accountId)).enabled,ai_profile_update:(await planning.configView(req.accountId)).enabled,ai_reward_pricing:(await planning.configView(req.accountId)).enabled&&planning.config.rewardPricing,reports:true,report_schedules:true,daily_statistics:true,avatar_renderer:false,avatar_redemption:false,
    recurring_tasks:true,trends:true,achievement_milestones:true,token_wallet:true,profile_observations:true,observation_binding_precondition:true,ai_task_generation:(await planning.configView(req.accountId)).enabled,ai_metric_analysis:(await planning.configView(req.accountId)).enabled,ai_achievement_generation:(await planning.configView(req.accountId)).enabled,professional_ledger:false,local_session:true,user_export:true,user_restore:'cli',
    aggregations:['count','sum','avg','latest'],windows:['day','week','month','all_time']
  }}));
  const idempotency=(req:any)=>uuid.parse(req.headers['idempotency-key']);
  for(const route of ['profile','home-preferences','home']) app.get(`/api/v1/${route}`,async req=>({data:await service.configuration(req.accountId,route)}));
  for(const route of ['profile','home-preferences']) app.patch(`/api/v1/${route}`,async req=>service.mutate(req.accountId,idempotency(req),'PATCH',route,req.body));
  app.get('/api/v1/metrics/:id/trend',async req=>({data:await service.read(c=>readTrend(service,c,req.accountId,z.object({id:uuid}).parse(req.params).id,req.query))}));
  app.get('/api/v1/wallet',async req=>({data:await service.read(c=>readWallet(c,req.accountId))}));
  app.get('/api/v1/wallet/ledger',async req=>service.read(c=>readLedger(c,req.accountId,req.query)));
  app.get('/api/v1/task-templates',async req=>({data:await service.read(c=>readTaskTemplates(c,req.accountId))}));
  app.get('/api/v1/task-instances',async req=>service.read(c=>readTaskInstances(c,req.accountId,req.query)));
  app.get('/api/v1/achievement-series',async req=>service.read(c=>readSeries(service,c,req.accountId,req.query)));
  app.get('/api/v1/achievement-summary',async req=>({data:await service.read(c=>achievementSummary(c,req.accountId))}));
  app.post('/api/v1/profile/observations',async req=>service.mutate(req.accountId,idempotency(req),'POST','profile/observations',req.body));
  app.post('/api/v1/task-templates',async req=>service.mutate(req.accountId,idempotency(req),'POST','task-templates',req.body));
  app.patch('/api/v1/task-templates/:id',async req=>service.mutate(req.accountId,idempotency(req),'PATCH',`task-templates/${z.object({id:uuid}).parse(req.params).id}`,req.body));
  app.post('/api/v1/task-instances/materialize',async req=>service.mutate(req.accountId,idempotency(req),'POST','task-instances/materialize',req.body??{}));
  app.post('/api/v1/tasks/:id/cancel',async req=>service.mutate(req.accountId,idempotency(req),'POST',`tasks/${z.object({id:uuid}).parse(req.params).id}/cancel`,req.body));
  app.post('/api/v1/tasks/:id/revoke',async req=>service.mutate(req.accountId,idempotency(req),'POST',`tasks/${z.object({id:uuid}).parse(req.params).id}/revoke`,req.body));
  app.post('/api/v1/achievement-series',async req=>service.mutate(req.accountId,idempotency(req),'POST','achievement-series',req.body));
  app.get('/api/v1/bootstrap',async req=>({data:await service.snapshot(req.accountId)}));
  app.get('/api/v1/export',async req=>({data:await exportUserData(pool,req.accountId)}));
  app.get('/api/v1/ai/config',async req=>({data:profile==='development'?ai?.configView():await planning.configView(req.accountId)}));
  registerPlanning(app,planning);
  app.post('/api/v1/ai/generations',async req=>({data:await ai!.createGeneration(req.accountId,aiGenerationInput.parse(req.body),idempotency(req))}));
  app.get('/api/v1/ai/generations',async req=>ai!.listGenerations(req.accountId,pageQuery.parse(req.query)));
  app.get('/api/v1/ai/generations/:id',async req=>({data:await ai!.getGeneration(req.accountId,z.object({id:uuid}).parse(req.params).id)}));
  app.post('/api/v1/ai/generations/:id/apply',async req=>{
    const id=z.object({id:uuid}).parse(req.params).id;idempotency(req);
    const body=aiApplyInput.parse(req.body??{});
    return {data:await ai!.applyGeneration(req.accountId,id,body.base_module_version)};
  });
  app.post('/api/v1/ai/generations/:id/retry',async req=>{
    const id=z.object({id:uuid}).parse(req.params).id;idempotency(req);aiEmptyInput.parse(req.body??{});
    return {data:await ai!.retryGeneration(req.accountId,id)};
  });
  app.post('/api/v1/ai/generations/:id/cancel',async req=>{
    const id=z.object({id:uuid}).parse(req.params).id;idempotency(req);aiEmptyInput.parse(req.body??{});
    return {data:await ai!.cancelGeneration(req.accountId,id)};
  });
  app.get('/api/v1/ai/batches',async req=>ai!.listBatches(req.accountId,pageQuery.parse(req.query)));
  app.get('/api/v1/ai/batches/:id',async req=>({data:await ai!.getBatch(req.accountId,z.object({id:uuid}).parse(req.params).id)}));
  app.post('/api/v1/ai/batches/:id/revoke',async req=>{
    const id=z.object({id:uuid}).parse(req.params).id;idempotency(req);aiEmptyInput.parse(req.body??{});
    return {data:await ai!.revokeBatch(req.accountId,id)};
  });
  const mapping:Record<string,string>={'modules':'modules','record-types':'record_types','tasks':'tasks','records':'records','metrics':'metrics','achievements':'achievement_definitions','awards':'achievement_awards'};
  for(const [route,key] of Object.entries(mapping)) {
    app.get(`/api/v1/${route}`,async req=>{
      const q=pageQuery.parse(req.query),data=await service.snapshot(req.accountId);
      const all=data[key].filter((r:any)=>!q.module_id || r.module_id===q.module_id || (key==='achievement_awards' && data.achievement_definitions.some((a:any)=>a.id===r.achievement_id && a.module_id===q.module_id)));
      return {data:all.slice(q.offset,q.offset+q.limit),page:{limit:q.limit,offset:q.offset,total:all.length}};
    });
    app.get(`/api/v1/${route}/:id`,async req=>{
      const {id}=z.object({id:uuid}).parse(req.params);
      const data=await service.snapshot(req.accountId),row=data[key].find((x:any)=>x.id===id);
      requireThat(row,'NOT_FOUND','Object not found',404);return {data:row};
    });
  }
  for(const route of ['modules','record-types','tasks','metrics','achievements','records']) {
    app.post(`/api/v1/${route}`,async req=>service.mutate(req.accountId,uuid.parse(req.headers['idempotency-key']),'POST',route,req.body));
  }
  app.patch('/api/v1/modules/:id',async req=>service.mutate(req.accountId,uuid.parse(req.headers['idempotency-key']),'PATCH',`modules/${z.object({id:uuid}).parse(req.params).id}`,req.body));
  for(const method of ['PUT','DELETE'] as const) app.route({method,url:'/api/v1/records/:id',handler:async req=>service.mutate(req.accountId,uuid.parse(req.headers['idempotency-key']),method,`records/${z.object({id:uuid}).parse(req.params).id}`,req.body)});
  app.post('/api/v1/tasks/:id/complete',async req=>service.mutate(req.accountId,uuid.parse(req.headers['idempotency-key']),'POST',`tasks/${z.object({id:uuid}).parse(req.params).id}/complete`,req.body));
  return app;
}
declare module 'fastify' { interface FastifyRequest {accountId:string;} }
