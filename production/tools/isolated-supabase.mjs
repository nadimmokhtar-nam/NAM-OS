#!/usr/bin/env node
// A disposable loopback provider. Never links, resets, pushes to a remote,
// bootstraps a hosted owner, or prints generated service/Auth credentials.
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir,copyFile,stat,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=process.env.NAM_QA_ROOT||'/workspace/.cache/nam-os/isolated';
const cache=resolve(root,'..'),cliHome=process.env.NAM_QA_CLI_HOME||resolve(cache,'supabase-home');
const cli=process.env.NAM_QA_CLI||resolve(cache,'tools/node_modules/.bin/supabase');
const app=fileURLToPath(new URL('../',import.meta.url));
const configPath=resolve(root,'supabase/config.jsonc');
const docker=['--host=unix:///var/run/docker.sock'];
const excluded='realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';
const command=process.argv[2]||'status';
const check=(condition,message)=>{if(!condition)throw Error(message);};
const exists=async path=>{try{await stat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const bypass=['localhost','127.0.0.1','::1','supabase_auth_nam-os-qa','supabase_rest_nam-os-qa','supabase_storage_nam-os-qa','supabase_db_nam-os-qa','supabase_kong_nam-os-qa'];
const env={...process.env,SUPABASE_HOME:cliHome,SUPABASE_TELEMETRY_DISABLED:'1',DOCKER_HOST:'unix:///var/run/docker.sock',NO_PROXY:[process.env.NO_PROXY,...bypass].filter(Boolean).join(','),no_proxy:[process.env.no_proxy,...bypass].filter(Boolean).join(',')};

async function privateRun(binary,args,label){
 const log=await open(resolve(root,label+'.log'),'w',0o600);
 try{
  const status=await new Promise((done,reject)=>{const child=spawn(binary,args,{cwd:app,env,stdio:['ignore',log.fd,log.fd]});child.on('error',reject);child.on('exit',done);});
  check(status===0,`Isolated ${label} failed. Its potentially sensitive diagnostics are in the private QA directory.`);
 }finally{await log.close();}
}
function dockerResult(args){return spawnSync('docker',[...docker,...args],{encoding:'utf8',maxBuffer:1024*1024});}
async function ensureCLI(){
 if(!await exists(cli)){
  await mkdir(resolve(cache,'tools'),{recursive:true});
  await privateRun('npm',['install','--prefix',resolve(cache,'tools'),'--cache',resolve(cache,'npm'),'--no-audit','--no-fund','--save-exact','supabase@3.4.0'],'cli-install');
 }
 const version=spawnSync(cli,['--version'],{cwd:root,env,encoding:'utf8'});check(version.status===0&&version.stdout.trim()==='3.4.0','Use the tested Supabase CLI 3.4.0 for this isolated stack.');
}
async function configuration(create=false){
 if(!await exists(configPath)){
  check(create,'The isolated configuration is missing. Run start to create the local QA stack.');
  await privateRun(cli,['init','--workdir',root],'init');
  const parsed=ts.parseConfigFileTextToJson(configPath,await readFile(configPath,'utf8'));check(!parsed.error,'The isolated CLI configuration could not be read.');
  const config=parsed.config;check(!config.remotes,'Refusing a remote-linked configuration.');
  config.project_id='nam-os-qa';config.auth.site_url='http://localhost:3100';config.auth.additional_redirect_urls=['http://localhost:3100/auth/confirm'];config.auth.enable_signup=false;config.auth.enable_anonymous_sign_ins=false;
  config.db.seed={enabled:false,sql_paths:[]};config.storage.file_size_limit='50MiB';
  await writeFile(configPath,JSON.stringify(config,null,2)+'\n',{mode:0o600});
 }
 const parsed=ts.parseConfigFileTextToJson(configPath,await readFile(configPath,'utf8'));
 check(!parsed.error&&parsed.config.project_id==='nam-os-qa'&&!parsed.config.remotes,'Refusing a configuration outside the unlinked nam-os-qa project.');
 check(parsed.config.api?.port===54321&&parsed.config.db?.port===54322&&parsed.config.auth?.site_url==='http://localhost:3100','Unexpected QA service bindings. No hosted fallback is supported.');
 return parsed.config;
}
async function copyMigrations(){
 const target=resolve(root,'supabase/migrations');await mkdir(target,{recursive:true});
 for(const name of (await readdir(resolve(app,'supabase/migrations'))).filter(name=>/^\d+_[a-z_]+\.sql$/.test(name)))await copyFile(resolve(app,'supabase/migrations',name),resolve(target,name));
}

async function healthImages(){
 // BusyBox wget ignores NO_PROXY in this managed Docker runtime. Preserve the
 // pinned official images and wrap only the two exact loopback health probes.
 // Every other invocation delegates unchanged to the original binary.
 const directory=resolve(root,'health-images');await mkdir(directory,{recursive:true});
 const wrapper='#!/bin/sh\nif [ "$#" -eq 4 ] && [ "$1" = "--no-verbose" ] && [ "$2" = "--tries=1" ] && [ "$3" = "--spider" ]; then\n case "$4" in\n http://127.0.0.1:9999/health|http://localhost:5000/status) exec /usr/bin/wget -Y off "$@" ;;\n esac\nfi\nexec /usr/bin/wget "$@"\n';
 await writeFile(resolve(directory,'wget-health'),wrapper,{mode:0o755});
 for(const image of [
  {name:'gotrue',tag:'v2.198.0',digest:'sha256:ba8c0c82c574756c835c696df2a2c698020cc408a42034013d3712e34de7964d'},
  {name:'storage-api',tag:'v1.98.8',digest:'sha256:67aa2fc7c589be6aa7d6508d700c654581691f11ac8f0e501994d58d56b33fbe'},
 ]){
  const pristine=`nam-os-qa-pristine/${image.name}:${image.tag}`,overlay=`nam-os-qa-health/${image.name}:${image.tag}`,upstream=`public.ecr.aws/supabase/${image.name}:${image.tag}`;
  if(dockerResult(['image','inspect',pristine]).status!==0){
   await privateRun('docker',[...docker,'pull',`public.ecr.aws/supabase/${image.name}@${image.digest}`],'pull-'+image.name);
   check(dockerResult(['tag',`public.ecr.aws/supabase/${image.name}@${image.digest}`,pristine]).status===0,'Could not preserve the verified official image.');
  }
  if(dockerResult(['image','inspect',overlay]).status!==0){
   const dockerfile=`FROM ${pristine}\nCOPY --chmod=755 wget-health /usr/local/bin/wget\n`;
   await writeFile(resolve(directory,image.name+'.Dockerfile'),dockerfile);
   await privateRun('docker',[...docker,'build','--network=none','-f',resolve(directory,image.name+'.Dockerfile'),'-t',overlay,directory],'health-image-'+image.name);
  }
  check(dockerResult(['tag',overlay,upstream]).status===0,'Could not apply the isolated health-probe image.');
 }
}
async function status(){
 await configuration();
 const result=spawnSync(cli,['status','--workdir',root,'--output','json'],{env,encoding:'utf8',maxBuffer:1024*1024});
 await writeFile(resolve(root,'status-private.json'),result.stdout||'',{mode:0o600});await writeFile(resolve(root,'status-diagnostics.log'),result.stderr||'',{mode:0o600});
 check(result.status===0,'The isolated stack is unavailable. Status diagnostics remain in the private QA directory.');
 const state=JSON.parse(result.stdout);
 const url=new URL(state.API_URL||state.SUPABASE_URL);
 check(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Refusing a non-loopback provider.');
 console.log('Isolated Supabase is running on loopback with project ID nam-os-qa. Generated credentials remain private.');
}
try{
 check(['start','migrate','status'].includes(command),'Use start, migrate or status. Destructive and remote commands are deliberately unavailable.');
 await mkdir(root,{recursive:true,mode:0o700});await mkdir(cliHome,{recursive:true});await ensureCLI();
 await configuration(command==='start');
 if(command==='start'){
  check(dockerResult(['info','--format','{{.ServerVersion}}']).status===0,'The managed Docker daemon is unavailable.');
  await copyMigrations();await healthImages();
  console.log('Starting the isolated local database, Auth, REST gateway and private Storage.');
  await privateRun(cli,['start','--workdir',root,'--exclude',excluded],'start');
 }
 if(command==='migrate'||command==='start'){
  await copyMigrations();
  await privateRun(cli,['migration','up','--local','--workdir',root],'migrate');
  console.log('Pending migrations applied only to the isolated local database.');
 }
 await status();
}catch(error){console.error(error.message);process.exitCode=1;}
