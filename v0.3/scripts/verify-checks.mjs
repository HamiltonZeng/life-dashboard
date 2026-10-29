import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const dir='.runtime/test-artifacts/stage2-codex';
mkdirSync(dir,{recursive:true});
const commands=process.argv[2]==='integration'
  ? [['migrate',['db:migrate']],['integration',['test:integration']]]
  : [['typecheck',['typecheck']],['unit',['test']],['build',['build:web']],['contracts',['contracts:export']],['audit',['audit','--prod']]];
for(const [name,args] of commands) {
  const result=spawnSync('corepack',['pnpm',...args],{encoding:'utf8',env:{...process.env,AI_PROVIDER:'mock'},maxBuffer:10*1024*1024});
  writeFileSync(`${dir}/${name}.log`,(result.stdout??'')+(result.stderr??'')+(result.error?String(result.error):''));
  process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
  if(result.error || result.status!==0)process.exit(result.status??1);
}
