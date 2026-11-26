import {defineConfig} from '@playwright/test';

const qaRoot=process.env.NAM_QA_ROOT||'/workspace/.cache/nam-os/isolated';
export default defineConfig({
 testDir:'./browser',timeout:60000,expect:{timeout:15000},fullyParallel:false,workers:1,retries:0,
 globalSetup:'./browser/setup.mjs',outputDir:qaRoot+'/browser-artifacts',
 reporter:[['list'],['json',{outputFile:qaRoot+'/browser-results.json'}]],
 use:{baseURL:'http://localhost:3100',viewport:{width:1440,height:1000},trace:'off',screenshot:'only-on-failure',launchOptions:{executablePath:process.env.NAM_CHROMIUM_PATH||'/usr/bin/chromium'}},
 webServer:{command:'node tools/isolated-dev.mjs start'+(process.env.NAM_QA_MODE==='production'?' --production':''),url:'http://localhost:3100/login',timeout:120000,reuseExistingServer:true,stdout:'pipe',stderr:'pipe'},
});
