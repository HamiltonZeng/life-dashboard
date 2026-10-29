import {syntheticRuntime} from './test-runtime.js';
import {buildApp} from '../../apps/api/src/app.js';
const {pool,service}=syntheticRuntime();
const app=await buildApp(pool,{planning:service,profile:'mvp',origin:'http://gateway-test'});
await app.listen({host:'0.0.0.0',port:3001});
process.once('SIGTERM',async()=>{await app.close();await pool.end();process.exit(0);});
