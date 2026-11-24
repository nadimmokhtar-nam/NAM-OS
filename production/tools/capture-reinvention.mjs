#!/usr/bin/env node
import {chromium} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {actor,screenshot} from '../browser/support.mjs';

// Before evidence uses the exact deployed revision's client/CSS with synthetic
// isolated records. It is not a screenshot of the protected hosted website.
const baseline='7f07fa7c88c82c87e58931cf15efc9c3c74d96c9';
function source(path){const result=spawnSync('git',['show',baseline+':production/'+path],{encoding:'utf8',maxBuffer:1024*1024});if(result.status!==0)throw Error('The archived baseline asset is unavailable: '+path);return result.stdout;}
const css=source('app/styles.css');
const browser=await chromium.launch({executablePath:process.env.NAM_CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
try{
 const old=await actor(browser,'founder');
 await old.context.route('**/*',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.startsWith('/_next/')&&path.endsWith('.css'))return route.fulfill({status:200,contentType:'text/css',body:css});
  if(/^\/[\w.-]+\.js$/.test(path))return route.fulfill({status:200,contentType:'text/javascript',body:source('public'+path)});
  return route.continue();
 });
 await old.page.goto('/workspace#overview');await old.page.locator('#main h1').waitFor();await old.page.evaluate(()=>document.fonts.ready);await screenshot(old.page,'before-overview-baseline-client');
 await old.page.goto('/workspace#academy');await old.page.locator('#main h1').waitFor();await screenshot(old.page,'before-academy-baseline-client');await old.context.close();
 const current=await actor(browser,'founder');
 for(const route of ['overview','academy','projects']){await current.page.goto('/workspace#'+route);await current.page.locator('#main h1').waitFor();await current.page.evaluate(()=>document.fonts.ready);await screenshot(current.page,'after-'+route+'-final');}
 await current.context.close();
 console.log('Captured baseline-client and current UI evidence using isolated synthetic records; no protected hosted access is implied.');
}finally{await browser.close();}
