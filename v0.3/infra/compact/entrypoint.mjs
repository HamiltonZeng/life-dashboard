import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import pg from 'pg';
const children=new Set();let stopping=false,exitCode=0,postgres;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function launch(label,args,critical=true){
 const child=spawn(args[0],args.slice(1),{stdio:'inherit',env:process.env});children.add(child);
 child.once('error',()=>{console.error(`${label} failed to start`);void stop(1);});
 child.once('exit',(code)=>{children.delete(child);if(!stopping&&critical){console.error(`${label} exited (${code})`);void stop(1);}});
 return child;
}
async function stop(code=0){
 if(stopping)return;stopping=true;exitCode=code;
 // Stop HTTP/model workers before PostgreSQL, allowing in-flight writes to finish.
 for(const c of [...children].reverse())if(c!==postgres)c.kill('SIGTERM');
 for(let i=0;i<80&&[...children].some(c=>c!==postgres);i++)await delay(100);
 postgres?.kill('SIGTERM');
 for(let i=0;i<120&&children.size;i++)await delay(100);
 for(const c of children)c.kill('SIGKILL');
 process.exit(exitCode);
}
for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>{void stop();});
async function run(args){const c=launch('initialization',args,false);await new Promise((resolve,reject)=>{c.once('exit',code=>code===0?resolve():reject(new Error('Initialization failed')));c.once('error',reject);});}
try{
 mkdirSync('.runtime/cache',{recursive:true});
 postgres=launch('postgres',['/usr/local/bin/docker-entrypoint.sh','postgres','-c','listen_addresses=127.0.0.1']);
 const pool=new pg.Pool({host:process.env.DATABASE_HOST,port:5432,user:process.env.DATABASE_USER,database:process.env.DATABASE_NAME,password:process.env.POSTGRES_PASSWORD,connectionTimeoutMillis:1000,max:1});
 let ready=false;
 for(let i=0;i<90&&!stopping;i++){try{await pool.query('SELECT 1');ready=true;break;}catch{await delay(1000);}}
 await pool.end();if(!ready)throw new Error('Database did not become ready');
 await run(['node','node_modules/tsx/dist/cli.mjs','packages/db/src/migrate.ts']);
 const check=new pg.Pool({host:process.env.DATABASE_HOST,user:process.env.DATABASE_USER,database:process.env.DATABASE_NAME,password:process.env.POSTGRES_PASSWORD});
 const empty=Number((await check.query('SELECT count(*) n FROM users')).rows[0].n)===0;await check.end();
 if(empty)await run(['node','node_modules/tsx/dist/cli.mjs','packages/db/src/seed.ts']);
 if(process.env.COMPACT_MODE!=='database'){
  launch('api',['node','node_modules/tsx/dist/cli.mjs','apps/api/src/main.ts']);
  launch('worker',['node','node_modules/tsx/dist/cli.mjs','apps/worker/src/main.ts']);
  launch('web',['node','apps/web/dev-server.mjs']);
 }
 console.log('Compact environment ready; data and credentials remain outside the image.');
}catch{console.error('Compact environment initialization failed; inspect service logs.');await stop(1);}
