import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
const base='http://gateway', origin=process.env.APP_ORIGIN;
assert.equal(origin,'http://localhost:18380');
const checks=[];
for(const path of ['/','/tasks','/metrics','/achievements','/records','/settings','/dist/app.js','/packages/ui/dist/index.js','/health/ready']) {
 const response=await fetch(base+path); assert.equal(response.status,200,path); checks.push({path,status:response.status});
}
assert.equal((await fetch(base+'/api/v1/me')).status,401);
const login=await fetch(base+'/api/v1/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login_secret:process.env.LOCAL_LOGIN_SECRET})});
assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie').split(';')[0];
try {
 for(const path of ['me','capabilities','home','profile','task-templates','task-instances','achievement-series','achievement-summary','wallet','export','reports','report-schedules','ai/config','ai/usage']) {
  const response=await fetch(base+'/api/v1/'+path,{headers:{Cookie:cookie}});
  assert.equal(response.status,200,path); const body=await response.json();
  if(path==='capabilities'){assert.equal(body.data.app_version,'0.3.0-phase2');assert.equal(body.data.cloud_ai,false);}
  checks.push({path:'/api/v1/'+path,status:response.status});
 }
} finally {
 const logout=await fetch(base+'/api/v1/session',{method:'DELETE',headers:{Origin:origin,Cookie:cookie}}); assert.equal(logout.status,200);
}
mkdirSync('.runtime/test-artifacts/preparation',{recursive:true});
writeFileSync('.runtime/test-artifacts/preparation/http.json',JSON.stringify({status:'PASS',unauthenticated:401,login:200,logout:200,checks},null,2)+'\n');
console.log('Gateway, assets, login, authenticated APIs and logout: PASS');
