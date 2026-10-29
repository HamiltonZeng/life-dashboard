import {createPool} from '../../../packages/db/src/client.js';
import {PlanningService} from '../../api/src/ai/service.js';
import {writeFileSync} from 'node:fs';
const pool=createPool(),service=new PlanningService(pool);let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping=true;});
let lastSchedule=0;
while(!stopping){
 try{await service.tick();if(Date.now()-lastSchedule>=30000){await service.reports.scheduleTick();lastSchedule=Date.now();}await service.reports.tick();writeFileSync('/tmp/worker-heartbeat',String(Date.now()));}catch{console.error('Planning worker iteration failed; retrying without exposing request data.');}
 if(!stopping)await new Promise(resolve=>setTimeout(resolve,1000));
}
await pool.end();
