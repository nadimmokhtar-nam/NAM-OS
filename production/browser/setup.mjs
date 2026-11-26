import {request} from '@playwright/test';
import {mkdir,stat} from 'node:fs/promises';
import {profiles,qaRoot,origin,storeState,statePath} from './support.mjs';

export default async function setup(){
 process.umask(0o077);await mkdir(qaRoot,{recursive:true});const fixture=await profiles();
 for(const user of fixture.users){
  let state;try{const info=await stat(statePath(user.key));if((info.mode&0o077)!==0)throw Error('Synthetic session files must have mode 0600.');state=statePath(user.key);}catch(error){if(error.code!=='ENOENT')throw error;}
  const context=await request.newContext({baseURL:origin,...(state?{storageState:state}:{})});
  let valid=false;if(state){const result=await context.get('/api/bootstrap');if(result.status()===200){const data=await result.json();if(data.actor.id!==user.id||data.actor.role!==user.role)throw Error('Stored QA session identity does not match its profile.');valid=true;}}
  if(!valid){const result=await context.post('/api/auth/login',{headers:{Origin:origin},data:{email:user.email,password:user.password}});
   if(result.status()!==200){await context.dispose();throw Error('Synthetic '+user.key+' could not establish its managed session (HTTP '+result.status()+'). No credentials were printed.');}
   const data=await result.json();if(data.mfaRequired||data.redirect!=='/workspace')throw Error('Complete the isolated identity prerequisite before running the browser suite.');}
  await storeState(context,user.key);await context.dispose();
 }
 console.log('Eight synthetic users authenticated through the actual application; private session states stored outside the checkout.');
}
