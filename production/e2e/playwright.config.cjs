const path=require('node:path');
const {defineConfig}=require('@playwright/test');
const baseURL=process.env.NAM_E2E_BASE_URL||'http://127.0.0.1:3000';
const target=new URL(baseURL);
if(target.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw new Error('Browser tests require an isolated loopback application.');

module.exports=defineConfig({
  testDir:__dirname,
  testMatch:['browser.spec.cjs','concurrency.spec.cjs'],
  fullyParallel:false,
  workers:1,
  retries:0,
  timeout:180000,
  globalTimeout:20*60*1000,
  expect:{timeout:20000},
  reporter:[[path.join(__dirname,'safe-reporter.cjs')]],
  outputDir:path.join(__dirname,'.runtime','playwright-output'),
  preserveOutput:'never',
  use:{baseURL,browserName:'chromium',viewport:{width:1440,height:900},locale:'en-GB',timezoneId:'Europe/Paris',colorScheme:'light',reducedMotion:'reduce',acceptDownloads:true,trace:'off',video:'off',screenshot:'off',actionTimeout:15000,navigationTimeout:30000},
});
