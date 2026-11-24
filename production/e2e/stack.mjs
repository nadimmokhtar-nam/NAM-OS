import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,openSync,closeSync,existsSync,readFileSync,chmodSync,unlinkSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// CLI stdout includes default local API keys. Keep it private, even on errors.
// No hosted target, login, link, project creation, push or remote reset exists.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const privateRoot=join(process.env.RUNNER_TEMP||join(root,'e2e','.runtime'),'nam-os-e2e');
mkdirSync(privateRoot,{recursive:true,mode:0o700});
chmodSync(privateRoot,0o700);
const ownedMarker=join(privateRoot,'owned-stack');
let stage='preflight';
function mark(value){stage=value;writeFileSync(join(privateRoot,'stage.json'),JSON.stringify({stage:value})+'\n',{mode:0o600});}
const quote=s=>`'${String(s).replaceAll("'","'\\''")}'`;
function localURL(value,kind){let u;try{u=new URL(value);}catch{throw new Error(`${kind} is missing or invalid.`);}if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new Error(`${kind} must be loopback-only.`);if(kind==='API'&&!['http:','https:'].includes(u.protocol))throw new Error('Invalid API protocol.');if(kind==='database'&&!['postgres:','postgresql:'].includes(u.protocol))throw new Error('Invalid database protocol.');return value;}
function cli(args,{capture=false,timeout=600000}={}){const path=join(privateRoot,'supabase-private.log');const fd=openSync(path,'a',0o600);chmodSync(path,0o600);try{const result=spawnSync('supabase',args,{cwd:root,env:{...process.env,SUPABASE_ENV:'ci'},stdio:capture?['ignore','pipe',fd]:['ignore',fd,fd],timeout,maxBuffer:2*1024*1024});if(result.error||result.status!==0){
 const log=readFileSync(path,'utf8').slice(-32000);
 const filename=[...log.matchAll(/Applying migration ([0-9]{12,14}_[a-z0-9_]+\.sql)/g)].at(-1)?.[1];
 const category=/permission denied/i.test(log)?'permission-denied':/syntax error/i.test(log)?'sql-syntax':/does not exist/i.test(log)?'missing-object':/unknown.*(?:config|field)|config.*invalid/i.test(log)?'configuration':/connection refused|cannot connect|docker.*not running/i.test(log)?'local-service-unavailable':'local-stack-failure';
 throw new Error(`Local Supabase ${args[0]} failed. Exit ${result.status??'unavailable'}; category=${category}${filename?`; migration=${filename}`:''}. Private raw output was not published.`);
 }return capture?result.stdout.toString('utf8'):'';}finally{closeSync(fd);}}
function findValue(data,keys){if(!data||typeof data!=='object')return null;for(const k of keys)if(typeof data[k]==='string'&&data[k])return data[k];for(const k of ['data','status','result','output']){const value=findValue(data[k],keys);if(value)return value;}return null;}
function mask(value){if(process.env.GITHUB_ACTIONS==='true')process.stdout.write(`::add-mask::${value.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A')}\n`);}
try{
 const mode=process.argv[2];
 if(mode==='start'){
  if(process.env.NAM_E2E_ALLOW_PROVISION!=='1')throw new Error('Explicit disposable-test provisioning opt-in is required.');
  const config=readFileSync(join(root,'supabase','config.toml'),'utf8');
  if(!/^project_id\s*=\s*"nam-os-ci"\s*$/m.test(config)||/^\s*\[remotes[.\]]/m.test(config))throw new Error('Refusing a different project or remote Supabase config.');
  if(existsSync(join(root,'supabase','.temp','project-ref')))throw new Error('Refusing a linked Supabase checkout. This runner is local-only.');
  for(const args of [['volume','ls','--format','{{.Name}}'],['ps','-a','--format','{{.Names}}']]){
   const listed=spawnSync('docker',args,{encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
   if(listed.error||listed.status!==0)throw new Error('Disposable Docker preflight failed.');
   if(listed.stdout.split('\n').some(name=>name.endsWith('_nam-os-ci')))throw new Error('Existing nam-os-ci containers/volumes detected. Refusing to reset or delete them.');
  }
  writeFileSync(ownedMarker,root,{mode:0o600});
  mark('local_stack_start');
  cli(['start']);
  // CLI v3 targets local by default. --remote is deliberately absent.
  mark('migration_reset');cli(['db','reset','--yes']);
  mark('status_read');
  let status;try{status=JSON.parse(cli(['status','--output','json'],{capture:true,timeout:60000}));}catch{throw new Error('Local CLI status could not be read safely.');}
  const url=localURL(findValue(status,['API_URL','api_url','apiUrl']),'API');
  const db=localURL(findValue(status,['DB_URL','db_url','dbUrl']),'database');
  const anon=findValue(status,['ANON_KEY','anon_key','PUBLISHABLE_KEY','publishable_key']);
  const service=findValue(status,['SERVICE_ROLE_KEY','service_role_key','SECRET_KEY','secret_key']);
  if(!anon||!service)throw new Error('Local Supabase status did not provide usable test keys.');
  for(const value of [anon,service,db])mask(value);
  const values={SUPABASE_URL:url,SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,SUPABASE_DB_URL:db,NAM_APP_ORIGIN:'http://127.0.0.1:3000'};
  mark('private_environment');writeFileSync(join(privateRoot,'stack.env'),Object.entries(values).map(([k,v])=>`export ${k}=${quote(v)}\n`).join(''),{mode:0o600});
  process.stdout.write('Disposable local Supabase stack initialized; migrations applied. Keys remain private.\n');
 }else if(mode==='stop'){
  if(!existsSync(ownedMarker)||readFileSync(ownedMarker,'utf8')!==root){process.stdout.write('No owned disposable stack to stop.\n');}
  else{cli(['stop','--no-backup'],{timeout:120000});unlinkSync(ownedMarker);process.stdout.write('Disposable Supabase containers stopped.\n');}
 }else throw new Error('Use start or stop.');
}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}
