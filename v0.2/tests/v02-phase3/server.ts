import {readFileSync,existsSync} from 'node:fs';import {buildApp} from '../../apps/api/src/app.js';import {createPool} from '../../packages/db/src/client.js';
if(process.env.PHASE3_ACCEPTANCE!=='codex-phase3'||process.env.ACCEPTANCE_PROJECT!=='life-dashboard-v0-2-codex'||process.env.DATABASE_HOST!=='postgres-test'||process.env.DATABASE_NAME!=='life_dashboard_test')throw Error('Refuse non-Codex isolated server');
const clock='.runtime/test-artifacts/v02-phase3/clock.json';const pool=createPool();const app=await buildApp(pool,{profile:'mvp',origin:'http://gateway-test',now:()=>existsSync(clock)?new Date(JSON.parse(readFileSync(clock,'utf8')).now):new Date()});await app.listen({host:'0.0.0.0',port:3001});
process.on('SIGTERM',async()=>{await app.close();await pool.end();process.exit(0);});
