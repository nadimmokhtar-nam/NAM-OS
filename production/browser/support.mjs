import {readFile,mkdir,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {expect} from '@playwright/test';

export const qaRoot=process.env.NAM_QA_ROOT||'/workspace/.cache/nam-os/isolated';
export const origin='http://localhost:3100';
export async function profiles(){const result=JSON.parse(await readFile(resolve(qaRoot,'profiles.json'),'utf8'));if(result.workspace!=='f1000000-0000-4000-8000-000000000001'||!['localhost','127.0.0.1'].includes(new URL(result.origin).hostname))throw Error('Browser tests require the disposable local QA provider.');return result;}
export const statePath=key=>resolve(qaRoot,'browser-states',key+'.json');
export async function actor(browser,key,options={}){const context=await browser.newContext({baseURL:origin,storageState:statePath(key),viewport:{width:1440,height:1000},...options});return {context,page:await context.newPage()};}
export async function mutate(context,path,body,method='POST'){
 const bootstrap=await context.request.get('/api/bootstrap');expect(bootstrap.status(),'Synthetic session must remain authorized').toBe(200);const {csrf}=await bootstrap.json();
 return context.request.fetch('/api'+path,{method,headers:{Origin:origin,'X-CSRF-Token':csrf},data:body});
}
export async function uiLogin(page,key){
 const user=(await profiles()).users.find(u=>u.key===key);
 try{await page.goto('/login');await page.getByLabel('Work email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill(user.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('#app .sidebar')).toBeVisible();}
 catch{throw Error('Synthetic '+key+' sign-in did not reach the workspace. Credential values were omitted from the diagnostic.');}
}
export async function screenshot(page,name){await mkdir(resolve('docs/evidence/reinvention'),{recursive:true});await page.screenshot({path:resolve('docs/evidence/reinvention',name+'.png'),fullPage:true,animations:'disabled'});}
export async function storeState(context,key){const path=statePath(key);await mkdir(resolve(qaRoot,'browser-states'),{recursive:true});await context.storageState({path});await chmod(path,0o600);}
