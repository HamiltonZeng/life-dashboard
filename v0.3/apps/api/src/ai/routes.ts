import {registerReports} from '../reports/routes.js';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {uuid} from '../../../../packages/contracts/src/primitives.js';
import {pageInput} from '../../../../packages/contracts/src/v03/index.js';
import type {PlanningService} from './service.js';
export function registerPlanning(app:FastifyInstance,service:PlanningService){
 const user=(req:any)=>req.accountId as string;
 const id=(req:any)=>uuid.parse(req.params.id);
 const op=(req:any)=>uuid.parse(req.headers['idempotency-key']);
 const out=(data:any)=>({data});
 for(const path of ['ai/proposals','ai/proposals/preview','ai/proposals/apply','ai/proposals/cancel','ai/usage'])app.post('/api/v1/'+path,async(_req,reply)=>reply.code(409).send({error:{code:'FEATURE_DISABLED',message:'旧版预留写入口保持关闭，请使用版本化方案端点。'}}));
 app.get('/api/v1/ai/usage',async req=>out(await service.usage(user(req))));
 app.get('/api/v1/ai/preferences',async req=>out(await service.preferences(user(req))));
 app.patch('/api/v1/ai/preferences',async req=>service.patchPreferences(user(req),op(req),req.body));
 app.get('/api/v1/ai/conversations',async req=>out(await service.conversations(user(req),pageInput.parse(req.query))));
 app.post('/api/v1/ai/conversations',async req=>service.createConversation(user(req),op(req),req.body));
 app.get('/api/v1/ai/conversations/:id/messages',async req=>out(await service.messages(user(req),id(req),pageInput.parse(req.query))));
 app.post('/api/v1/ai/conversations/:id/messages',async(req,reply)=>reply.code(202).send(await service.accept(user(req),id(req),op(req),req.body)));
 app.get('/api/v1/ai/runs/:id',async req=>out(await service.turn(user(req),id(req))));
 app.get('/api/v1/ai/runs/:id/events',async(req,reply)=>{
  await service.runRow(user(req),id(req));
  const last=z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(req.headers['last-event-id']??0);
  const rows=(await service.pool.query('SELECT event_id,kind,payload FROM ai_run_events WHERE user_id=$1 AND run_id=$2 AND event_id>$3 ORDER BY event_id LIMIT 100',[user(req),id(req),last])).rows;
  // Finite SSE batches reconnect safely via Last-Event-ID. GET remains authoritative.
  return reply.type('text/event-stream').header('Cache-Control','no-store').send(rows.map(e=>`id: ${e.event_id}\nevent: ${e.kind}\ndata: ${JSON.stringify(e.payload)}\n\n`).join('')+': reconnect\n\n');
 });
 app.post('/api/v1/ai/runs/:id/clarifications',async(req,reply)=>reply.code(202).send(await service.clarify(user(req),id(req),op(req),req.body)));
 app.post('/api/v1/ai/runs/:id/cancel',async req=>service.cancel(user(req),id(req),op(req),req.body));
 app.get('/api/v1/ai/proposals/:id',async req=>out(await service.proposal(user(req),id(req))));
 app.post('/api/v1/ai/proposals/:id/preview',async req=>service.preview(user(req),id(req),op(req),req.body));
 app.post('/api/v1/ai/proposals/:id/apply',async req=>service.apply(user(req),id(req),op(req),req.body));
 app.post('/api/v1/ai/applications/:id/undo-preview',async req=>service.undoPreview(user(req),id(req),op(req),req.body));
 app.post('/api/v1/ai/applications/:id/undo',async req=>service.undo(user(req),id(req),op(req),req.body));
 app.get('/api/v1/goals',async req=>out(await service.goals(user(req))));
 app.get('/api/v1/goals/:id',async req=>out(await service.goals(user(req),id(req))));
 registerReports(app,service.reports);
}
