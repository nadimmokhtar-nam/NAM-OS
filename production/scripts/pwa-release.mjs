import {createHash} from 'node:crypto';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url)),files=[],policyPath='app/pwa-policy.ts';
const generated=new Set(['public/app-version.json']);
async function collect(directory){for(const item of await readdir(join(root,directory),{withFileTypes:true})){const path=join(directory,item.name);if(item.name.startsWith('.')||item.isSymbolicLink())continue;if(item.isDirectory())await collect(path);else if(item.isFile()&&!generated.has(path)&&/\.(?:js|mjs|ts|tsx|css|json|webmanifest|png|svg|woff2|sql)$/.test(path))files.push(path);}}
for(const directory of ['app','lib','public','scripts','supabase/migrations'])await collect(directory);
files.push('package.json','package-lock.json');
const hash=createHash('sha256');
for(const path of [...new Set(files)].sort()){
  let content=await readFile(join(root,path));
  if(path===policyPath)content=Buffer.from(content.toString().replace(/^export const PWA_RELEASE='[^']*';/m,"export const PWA_RELEASE='__GENERATED__';"));
  hash.update(path);hash.update('\0');hash.update(content);hash.update('\0');
}
const release='build-'+hash.digest('hex').slice(0,16),path=join(root,policyPath),policy=await readFile(path,'utf8');
if(!/^export const PWA_RELEASE='[^']*';/m.test(policy))throw new Error('The PWA release policy marker is missing.');
await writeFile(path,policy.replace(/^export const PWA_RELEASE='[^']*';/m,`export const PWA_RELEASE='${release}';`));
await writeFile(join(root,'public/app-version.json'),JSON.stringify({release})+'\n');
console.log(`NAM OS deployment identity: ${release}`);
