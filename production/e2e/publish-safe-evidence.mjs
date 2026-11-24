import {mkdirSync,readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {join,dirname,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const cases=new Set(['eight-account-role-and-task-scope','direct-permission-boundaries','actual-founder-aal1-denial','actual-membership-revocation','actual-managed-session-logout-replay','actual-anonymous-and-signup-denial']);
const stages=new Set(['preflight','local_stack_start','migration_reset','status_read','private_environment','account_provisioning','application_build','application_start','http_security','browser_workflows']);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const privateRoot=process.env.RUNNER_TEMP&&isAbsolute(process.env.RUNNER_TEMP)?join(process.env.RUNNER_TEMP,'nam-os-e2e'):null;
let stage='preflight',source=null,invalid=false;
function readPrivate(name){if(!privateRoot)return null;try{const path=join(privateRoot,name),info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>65536||(info.mode&0o077)!==0)throw new Error('Invalid private summary.');return JSON.parse(readFileSync(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
try{const marked=readPrivate('stage.json');if(stages.has(marked?.stage))stage=marked.stage;source=readPrivate('api-results.json');}catch{invalid=true;}
let report={kind:'real-local-supabase-api',status:invalid?'invalid_evidence':'not_run',stage,expected:6,completed:0,passed:0,failed:0,checks:[]};
if(source){try{
 if(source.kind!=='real-local-supabase-api'||source.expected!==6||!['passed','failed'].includes(source.setup)||!Array.isArray(source.checks)||source.checks.length>6)throw new Error('Invalid summary.');
 const checks=source.checks.map(row=>{if(!cases.has(row.name)||!['passed','failed'].includes(row.status))throw new Error('Unknown result.');return {name:row.name,status:row.status};});
 if(new Set(checks.map(row=>row.name)).size!==checks.length)throw new Error('Duplicate result.');
 const passed=checks.filter(row=>row.status==='passed').length,failed=checks.length-passed;
 if(source.completed!==checks.length||source.passed!==passed||source.failed!==failed)throw new Error('Invalid counters.');
 const status=source.setup==='passed'&&passed===6?'passed':'failed';if(source.status!==status)throw new Error('Invalid completion claim.');
 report={kind:'real-local-supabase-api',status,stage:'http_security',setup:source.setup,expected:6,completed:checks.length,passed,failed,checks};
 }catch{invalid=true;report.status='invalid_evidence';}}
const destination=join(root,'e2e','.runtime');mkdirSync(destination,{recursive:true,mode:0o700});writeFileSync(join(destination,'api-results.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
process.stdout.write(`Safe isolated HTTP evidence: ${report.status}; ${report.passed}/6 passed; stage=${report.stage}.\n`);
if(invalid)process.exitCode=1;
