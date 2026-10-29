import {mkdirSync,copyFileSync,existsSync,rmSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const target=resolve('.runtime/test-artifacts/stage3-final/fresh-install');
// Only this generated installation fixture is replaced; never remove the app's dependencies/data.
rmSync(target,{recursive:true,force:true});
mkdirSync(target,{recursive:true});
for(const path of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','apps/web/package.json','packages/ui/package.json']){
  const dest=resolve(target,path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(path,dest);
}
const result=spawnSync('corepack',['pnpm','install','--frozen-lockfile','--offline','--ignore-scripts','--store-dir','/workspace/.runtime/cache/pnpm-store'],{cwd:target,encoding:'utf8',maxBuffer:5*1024*1024});
process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
if(result.status!==0||!existsSync(resolve(target,'node_modules/.bin/tsx')))process.exit(result.status??1);
console.log('PASS: isolated manifest/lockfile installation from version-local cache; no host toolchain or development node_modules cleanup.');
