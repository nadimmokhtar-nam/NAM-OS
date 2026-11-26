#!/usr/bin/env node
// Accountless packaging only. Builds a committed source snapshot outside the
// checkout, strips hosted app credentials and never invokes a deploy command.
import {spawnSync,spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,open,readdir} from 'node:fs/promises';
import {resolve,join,relative,sep,delimiter} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const app=fileURLToPath(new URL('../',import.meta.url));
const cache=resolve(process.env.NAM_NETLIFY_CACHE||'/workspace/.cache/nam-os');
const tooling=resolve(process.env.NAM_NETLIFY_TOOLS||join(cache,'netlify-build-tools'));
const command=process.argv[2]||'build';
const check=(value,message)=>{if(!value)throw Error(message);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function metadata(path){return JSON.parse(await readFile(path,'utf8'));}
async function privateJSON(path,value){await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
function git(args,binary=false,cwd=app){const result=spawnSync('git',args,{cwd,encoding:binary?undefined:'utf8',maxBuffer:64*1024*1024});check(result.status===0,'Git '+args[0]+' could not read the committed candidate ('+(result.error?.code||result.status)+'). '+String(result.stderr||'').trim().slice(0,400));return binary?result.stdout:result.stdout.trim();}
function buildEnvironment(){
 const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^(?:NETLIFY_|NEXT_PUBLIC_SUPABASE|SUPABASE_|NAM_|ATTIO_|LEMLIST_|JUSTCALL_)/i.test(name)));
 return {...env,NAM_NETLIFY_CACHE:cache,NAM_NETLIFY_TOOLS:tooling,NEXT_TELEMETRY_DISABLED:'1',DENO_DIR:join(cache,'netlify-deno'),XDG_CACHE_HOME:join(cache,'netlify-xdg'),XDG_CONFIG_HOME:join(cache,'netlify-xdg/config'),PATH:join(tooling,'node_modules/.bin')+delimiter+process.env.PATH};
}
async function run(binary,args,cwd,logPath){
 const log=await open(logPath,'w',0o600);
 try{return await new Promise((done,reject)=>{const child=spawn(binary,args,{cwd,env:buildEnvironment(),stdio:['ignore',log.fd,log.fd]});child.on('error',reject);child.on('exit',done);});}
 finally{await log.close();}
}
async function verifyTools(){
 const engine=await metadata(join(tooling,'node_modules/@netlify/build/package.json'));
 const deno=await metadata(join(tooling,'node_modules/deno/package.json'));
 check(engine.version==='37.7.6'&&deno.version==='2.4.2','Install the documented pinned Netlify Build 37.7.6 and Deno 2.4.2 tooling.');
}
async function worker(jobPath){
 const job=await metadata(jobPath);
 const {default:build}=await import(pathToFileURL(join(tooling,'node_modules/@netlify/build/lib/index.js')).href);
 // Explicit repositoryRoot avoids discovering the cloud workspace's outer Git
 // metadata and incorrectly resolving production/ against /workspace.
 const result=await build({cwd:job.candidate,repositoryRoot:job.candidate,config:join(job.candidate,'netlify.toml'),mode:'cli',offline:true,buffer:false,telemetry:false,context:'deploy-preview'});
 await privateJSON(join(job.directory,'engine-result.json'),{success:result.success,severityCode:result.severityCode});
 if(!result.success)process.exitCode=1;
}
async function inspect(directory){
 const job=await metadata(join(directory,'job.json')),engine=await metadata(join(directory,'engine-result.json'));
 const log=await readFile(join(directory,'build.log'),'utf8'),base=join(job.candidate,'production/.netlify');
 const warnings=[];
 if(log.includes('Could not load configuration for edge function'))warnings.push({code:'EDGE_CONFIGURATION_INSPECTION_INCOMPLETE',detail:log.includes('https://edge.netlify.com/bootstrap/globals/types.ts')?'The official Edge types import was blocked. Permit edge.netlify.com in the environment network policy and rerun.':'Inspect the private build log before accepting Edge configuration.'});
 const artifacts=[];
 for(const [directory,extension,kind] of [['functions','.zip','SSR function ZIP'],['edge-functions-dist','.eszip','Proxy Edge bundle']]){
  try{for(const name of await readdir(join(base,directory))){if(!name.endsWith(extension))continue;const bytes=await readFile(join(base,directory,name));artifacts.push({kind,path:relative(job.candidate,join(base,directory,name)),bytes:bytes.length,sha256:digest(bytes)});}}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 let edge=null,functions=null;
 try{edge=await metadata(join(base,'edge-functions-dist/manifest.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
 try{functions=await metadata(join(base,'functions/manifest.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const matches=path=>(edge?.routes||[]).some(route=>new RegExp(route.pattern).test(path)&&!(route.excluded_patterns||[]).some(pattern=>new RegExp(pattern).test(path)));
 const middlewareCoverage={workspace:matches('/workspace'),bootstrap:matches('/api/bootstrap'),privateVideo:matches('/api/academy/videos/synthetic/content'),staticChunkExcluded:!matches('/_next/static/chunk.js'),imageExcluded:!matches('/icons/nam-192.png')};
 const sourceRelease=(await metadata(join(job.candidate,'production/public/app-version.json'))).release;
 const proof={checkedAt:new Date().toISOString(),sourceCommit:job.sourceCommit,sourceRelease,node:process.version,buildModule:'37.7.6',deno:'2.4.2',adapter:'@netlify/plugin-nextjs@5.16.9',buildMode:'Official public Build API, CLI mode, offline, deploy-preview context',engineSuccess:engine.success,severityCode:engine.severityCode,configurationInspectionComplete:engine.success&&warnings.length===0,warnings,artifacts,middlewareCoverage,edgeRoutes:edge?.routes||[],edgeBundlerVersion:edge?.bundler_version||null,functionRuntimes:functions?.functions?.map(row=>({name:row.name,runtimeVersion:row.runtimeVersion,invocationMode:row.invocationMode,routes:row.routes}))||[],packageLockSha256:digest(await readFile(join(job.candidate,'production/package-lock.json'))),hostedDeployment:false,credentialsUsed:false,hostedRuntimeVerified:false,limitation:'Packaging evidence only. No hosted Auth/cookies, private uploads/playback, integration tenants or deployment were verified.'};
 await privateJSON(join(directory,'proof.json'),proof);
 check(engine.success&&artifacts.some(a=>a.kind==='SSR function ZIP')&&artifacts.some(a=>a.kind==='Proxy Edge bundle'),'Packaging did not produce all required artifacts. Inspect the private job directory.');
 check(Object.values(middlewareCoverage).every(Boolean),'The packaged middleware manifest does not cover the required protected routes.');
 check(proof.functionRuntimes.some(row=>row.runtimeVersion==='nodejs24.x'),'The packaged server function does not target the required Node.js 24 runtime.');
 console.log(JSON.stringify({sourceCommit:job.sourceCommit,engineSuccess:engine.success,configurationInspectionComplete:proof.configurationInspectionComplete,warnings:proof.warnings,artifacts:proof.artifacts,proofPath:join(directory,'proof.json'),hostedDeployment:false},null,2));
 if(warnings.length)process.exitCode=2;
 return proof;
}
async function prepare(){
 await verifyTools();const root=git(['rev-parse','--show-toplevel']),sourceCommit=git(['rev-parse','--verify','HEAD^{commit}']);
 check(cache!==root&&!cache.startsWith(root+sep),'The packaging cache must remain outside the application checkout.');
 const tracked=git(['ls-tree','-r','--name-only',sourceCommit],false,root);
 check(!tracked.split('\n').some(name=>/(?:^|\/)\.env(?:\.|$)/.test(name)&&!name.endsWith('.env.example')),'Refusing a source tree containing a committed environment file.');
 const jobs=join(cache,'netlify-jobs');await mkdir(jobs,{recursive:true});const directory=await mkdtemp(join(jobs,sourceCommit.slice(0,8)+'-')),candidate=join(directory,'source');await mkdir(candidate);
 const archive=git(['archive',sourceCommit,'netlify.toml','production'],true,root),extract=spawnSync('tar',['-xf','-','-C',candidate],{input:archive});check(extract.status===0,'Could not extract the isolated committed snapshot.');
 const job={sourceCommit,directory,candidate};await privateJSON(join(directory,'job.json'),job);
 check(await run('npm',['ci','--no-audit','--no-fund','--cache',join(cache,'../npm')],join(candidate,'production'),join(directory,'install.log'))===0,'Candidate dependency installation failed; inspect the private job directory.');
 console.log('Building committed '+sourceCommit.slice(0,12)+' in an isolated accountless snapshot.');
 const status=await run(process.execPath,[fileURLToPath(import.meta.url),'worker',join(directory,'job.json')],candidate,join(directory,'build.log'));
 check(status===0,'The official offline build failed. Its diagnostics are in '+directory);
 return inspect(directory);
}
try{if(command==='worker')await worker(resolve(process.argv[3]));else if(command==='inspect')await inspect(resolve(process.argv[3]));else if(command==='build')await prepare();else throw Error('Use build, or inspect <private-job-directory>.');}
catch(error){console.error(error.message);process.exitCode=1;}
