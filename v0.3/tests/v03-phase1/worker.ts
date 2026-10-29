import {syntheticRuntime} from './test-runtime.js';
const {pool,service}=syntheticRuntime();let stop=false;
process.once('SIGTERM',()=>{stop=true;});
while(!stop){await service.tick();await new Promise(r=>setTimeout(r,200));}
await pool.end();
