import { createPool } from '../../../packages/db/src/client.js';
import { buildApp } from './app.js';
const pool=createPool();
const app=await buildApp(pool,{logger:true});
await app.listen({host:'0.0.0.0',port:Number(process.env.PORT??3001)});
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await app.close();await pool.end();process.exit(0);});
