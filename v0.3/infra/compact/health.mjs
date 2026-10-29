import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
try{
 if(process.env.COMPACT_MODE==='database')process.exit(spawnSync('pg_isready',['-h','127.0.0.1','-U',process.env.DATABASE_USER,'-d',process.env.DATABASE_NAME]).status===0?0:1);
 const r=await fetch('http://127.0.0.1:8080/health/ready',{signal:AbortSignal.timeout(3000)});
 const heartbeat=Number(readFileSync('/tmp/worker-heartbeat','utf8'));
 process.exit(r.ok&&Date.now()-heartbeat<240000?0:1);
}catch{process.exit(1);}
