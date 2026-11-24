import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Source-driven module lifecycle tests. These do not execute React or a real
// browser; Next build, hydration and visual/keyboard tests remain separate gates.
function element(){return {id:'',innerHTML:'',textContent:'',open:false,attributes:{},dataset:{},classList:{toggle(){},add(){},remove(){}},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},querySelector(){return null;},querySelectorAll(){return [];},contains(){return false;},focus(){},addEventListener(type,fn){(this.listeners??={})[type]=fn;},close(){this.open=false;this.listeners?.close?.();},showModal(){this.open=true;}};}
const model=()=>({actor:{id:'founder-id',name:'Studio owner',initials:'SO',role:'founder'},members:[{id:'founder-id',name:'Studio owner',initials:'SO',role:'founder'}],sections:['sales','academy','projects','library','team','operations'],tasks:[],courses:[],notifications:[],today:'2026-11-24',mode:'authenticated',roleLabels:{founder:'Founder'},csrf:'verified-csrf'});
async function harness({demo=false,holdBootstrap=false}={}){
  const nodes=new Map(['#app','#dialog','#toast','#main','#studio-navigation'].map(selector=>[selector,element()])),listeners={},requests=[];
  const document={activeElement:element(),title:'',querySelector:selector=>nodes.get(selector)||null,getElementById:id=>nodes.get('#'+id)||null,querySelectorAll:()=>[],addEventListener(type,fn){(listeners[type]??=[]).push(fn);}};
  const context=vm.createContext({console,Intl,Date,URL,URLSearchParams,AbortController,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,document,window:{addEventListener(){},matchMedia:()=>({matches:false}),scrollTo(){}},history:{replaceState(){}},location:{hash:'#overview',origin:'https://nam.example',href:'https://nam.example/workspace'},fetch:async(url,init={})=>{
    requests.push({url,init});
    if(holdBootstrap&&url==='/api/bootstrap')await new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Object.assign(new Error('Canceled'),{name:'AbortError'})),{once:true}));
    const body=url==='/api/bootstrap'?{...model(),...(demo?{mode:'local-preview'}:{})}:url.startsWith('/api/tasks?')?{items:[],total:0,page:1,hasMore:false}:[];
    return {ok:true,status:200,json:async()=>structuredClone(body)};
  }});
  const loaded=new Set();async function load(file){if(loaded.has(file))return;loaded.add(file);let source=await readFile(new URL('../public/'+file,import.meta.url),'utf8');for(const match of source.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"];?\s*$/gm))await load(match[2]);const exports=Array.from(source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm),m=>m[1]);source=source.replace(/^import[^\n]*\n/gm,'').replace(/^export\s+/gm,'');const result=await vm.runInContext(`(async()=>{${source}\nreturn {${exports.join(',')}};})()`,context,{filename:file});Object.assign(context,result);}
  await load('app.js');return {nodes,listeners,requests,mount:context.mountWorkspace,unmount:context.unmountWorkspace};
}

test('production workspace mounts the real module without demonstration member controls',async()=>{
  const h=await harness();await h.mount();const html=h.nodes.get('#app').innerHTML;assert(html.includes('NAM Overview'));assert(html.includes('Sign out'));assert(!html.includes('id="preview-member"'));assert(!html.includes('Demonstration · sample data'));assert(h.requests.some(r=>r.url==='/api/bootstrap'));assert(h.requests.some(r=>r.url.startsWith('/api/tasks?')));
});
test('cached module rebinds a new scaffold without duplicating document listeners',async()=>{
  const h=await harness();await h.mount();const old=h.nodes.get('#app'),count=Object.values(h.listeners).reduce((n,x)=>n+x.length,0);h.unmount();const fresh=element(),dialog=element();h.nodes.set('#app',fresh);h.nodes.set('#dialog',dialog);await h.mount();assert(fresh.innerHTML.includes('NAM Overview'));assert.notEqual(fresh,old);assert(dialog.listeners?.close);assert.equal(Object.values(h.listeners).reduce((n,x)=>n+x.length,0),count);
});
test('repeated mount on the same live scaffold performs one bootstrap',async()=>{
  const h=await harness();await Promise.all([h.mount(),h.mount()]);assert.equal(h.requests.filter(r=>r.url==='/api/bootstrap').length,1);
});
test('unmount aborts outstanding requests and prevents stale rendering',async()=>{
  const h=await harness({holdBootstrap:true});const pending=h.mount();await Promise.resolve();assert.equal(h.requests.length,1);h.unmount();await pending;assert.equal(h.requests[0].init.signal.aborted,true);assert.equal(h.nodes.get('#app').innerHTML,'');
});
test('production workspace refuses a demonstration bootstrap',async()=>{
  const h=await harness({demo:true});await h.mount();const html=h.nodes.get('#app').innerHTML;assert(html.includes('This workspace could not verify its production data source.'));assert(html.includes('role="alert"'));assert(!html.includes('id="preview-member"'));assert(!html.includes('NAM Overview'));assert.equal(h.requests.filter(r=>/^\/api\/(tasks|sales|integrations)(?:[/?]|$)/.test(r.url)).length,0);
});
