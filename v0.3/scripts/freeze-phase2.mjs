import {readdirSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const files=[];
function visit(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){if(['.runtime','.secrets','node_modules','.git','dist','build'].includes(entry.name))continue;const path=dir+'/'+entry.name;if(entry.isDirectory())visit(path);else if(entry.isFile()&&!['source-manifest.json','results.json'].includes(entry.name))files.push({path:path.replace(/^\.\//,''),sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});}}
for(const dir of ['apps','packages','scripts','tests'])visit(dir);
for(const path of ['compose.yaml','package.json','pnpm-lock.yaml','tsconfig.json'])files.push({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});
files.sort((a,b)=>a.path.localeCompare(b.path));mkdirSync('docs/phase2',{recursive:true});
writeFileSync('docs/phase2/source-manifest.json',JSON.stringify({schema_version:'phase2-source/1.0',generated_at:new Date().toISOString(),note:'完整工作区文件清单；HEAD不代表未跟踪的v0.3内容。排除依赖、构建产物、私有配置及运行证据。',schema_prompt_version:'v03-p2.1',files},null,2)+'\n');
console.log(JSON.stringify({source_files:files.length,manifest:'docs/phase2/source-manifest.json'}));
