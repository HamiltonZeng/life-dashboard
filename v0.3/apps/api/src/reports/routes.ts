import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {uuid} from '../../../../packages/contracts/src/primitives.js';
import type {ReportsService} from './service.js';
import {searchSummaries} from '../ai/query-context.js';
export function registerReports(app:FastifyInstance,service:ReportsService){
 const user=(r:any)=>r.accountId as string,op=(r:any)=>uuid.parse(r.headers['idempotency-key']),id=(r:any)=>uuid.parse(r.params.id);
 const kind=(r:any)=>z.enum(['daily','weekly','monthly']).parse(r.params.kind);
 app.post('/api/v1/reports/generate',async(r,p)=>p.code(202).send(await service.generate(user(r),op(r),r.body)));
 app.get('/api/v1/reports',async r=>({data:await service.list(user(r),z.strictObject({kind:z.enum(['daily','weekly','monthly']).optional(),period:z.enum(['current','previous','custom']).optional(),module_id:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(30),offset:z.coerce.number().int().min(0).max(100000).default(0)}).parse(r.query))}));
 app.get('/api/v1/reports/:id',async r=>{const q=z.strictObject({revision:z.coerce.number().int().min(1).optional()}).parse(r.query);return {data:await service.get(user(r),id(r),q.revision)};});
 app.post('/api/v1/reports/:id/cancel',async r=>service.cancel(user(r),id(r),op(r),r.body));
 app.get('/api/v1/report-schedules',async r=>({data:await service.schedules(user(r))}));
 app.post('/api/v1/report-schedules/:kind/preview',async r=>service.schedulePreview(user(r),kind(r),op(r),r.body));
 app.patch('/api/v1/report-schedules/:kind',async r=>service.patchSchedule(user(r),kind(r),op(r),r.body));
 app.get('/api/v1/records/:id/sources',async r=>{const rows=(await service.pool.query('SELECT s.* FROM record_sources s JOIN records r ON r.user_id=s.user_id AND r.id=s.record_id WHERE s.user_id=$1 AND s.record_id=$2 ORDER BY s.version DESC',[user(r),id(r)])).rows;return {data:rows};});
 app.get('/api/v1/ai/context/search',async r=>{const q=z.strictObject({q:z.string().max(100).default(''),start:z.string().datetime().optional(),end:z.string().datetime().optional()}).parse(r.query),prefs=await service.planning.preferences(user(r));return {data:await searchSummaries(service.pool,user(r),await service.scope(service.pool,user(r),[]),q.q,q.start??null,q.end??null)};});
 app.get('/api/v1/statistics/daily',async r=>{const q=z.strictObject({module_id:uuid,start:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),end:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse(r.query);await service.planning.core.module(service.pool as any,user(r),q.module_id);return {data:(await service.pool.query('SELECT * FROM daily_statistics WHERE user_id=$1 AND module_id=$2 AND day >= $3 AND day <= $4 ORDER BY day LIMIT 366',[user(r),q.module_id,q.start,q.end])).rows};});
}
