import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {loadBrowserModule} from './support/browser-module.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const auth={authenticated:true,id:'client-one',name:'Review client',csrf:'client-csrf',mfaRequired:false};
const issued={id:'request-one',number:1,title:'Material review',message:'Please review the issued image.',project:'Shared project',status:'issued',issued_at:'2030-01-01T10:00:00Z',allow_download:false,can_decide:true,items:[{id:'item-one',code:'INT-01',title:'Living room hero',number:2,width:400,height:240,file_name:'render.png',byte_size:500,response:null}]};
async function harness(intercept,{hash='#reviews/request-one',search=''}={}){
 const handlers={},windows={},calls=[],notices=[],root={innerHTML:'',addEventListener(type,fn){(handlers[type]??=[]).push(fn);},removeEventListener(type,fn){handlers[type]=(handlers[type]||[]).filter(x=>x!==fn);},querySelectorAll(){return [];},querySelector(){return {focus(){}};},contains(){return true;},setAttribute(){}};
 const location={hash,search},history={replaceState(_a,_b,url){const parsed=new URL(url,'https://nam.test');location.hash=parsed.hash;location.search=parsed.search;}},document={title:''};
 const window={addEventListener(type,fn){(windows[type]??=[]).push(fn);},removeEventListener(type,fn){windows[type]=(windows[type]||[]).filter(x=>x!==fn);}};
 let leave=true;
 const sandbox=vm.createContext({document,window,location,history,Intl,Date,URLSearchParams,crypto:globalThis.crypto});
 const {createClientReviewPortal}=await loadBrowserModule(sandbox,'client-review.js');
 const portal=createClientReviewPortal({root,confirmLeave:()=>leave,notify:value=>notices.push(value),fetcher:async(url,options)=>{
  calls.push({url,options:structuredClone(options)});const result=await intercept?.(url,options);
  if(result!==undefined)return result;
  if(url==='/api/client/auth')return Response.json(auth);
  if(url==='/api/client/reviews')return Response.json({items:[{...issued,items:1}]});
  if(url==='/api/client/reviews/request-one')return Response.json(issued);
  if(url.endsWith('/response'))return Response.json({decision:'accepted',message:'Agreed.',version:1,created_at:'2030-01-01T10:01:00Z'}, {status:201});
  return Response.json({ok:true});
 }});
 return {portal,root,calls,notices,location,history,handlers,windows,allow(value){leave=value;},
  form(message='Agreed.'){const error={textContent:'',insertAdjacentHTML(){}},form={dataset:{clientForm:'response'},elements:{message:{value:message}},querySelector:()=>error,isConnected:true};return {form,error};},
  async submit(form,decision='accepted'){for(const handler of [...handlers.submit||[]])await handler({target:form,submitter:{value:decision},preventDefault(){}});},
  async click(action,id){const target={dataset:{clientAction:action,id},closest(){return this;}};for(const handler of [...handlers.click||[]])await handler({target,preventDefault(){}});await new Promise(setImmediate);},
  async hash(value){location.hash=value;for(const handler of [...windows.hashchange||[]])handler();for(let i=0;i<10;i++)await new Promise(setImmediate);},
 };
}

test('client review renders only issued identity, escapes text and uses a persistent decision footer',async()=>{
 const h=await harness();await h.portal.mount();
 assert(h.root.innerHTML.includes('Version 2'));assert(h.root.innerHTML.includes('500 B'));assert(h.root.innerHTML.includes('client-decision-footer'));assert(h.root.innerHTML.includes('form="client-response-form"'));assert(!h.root.innerHTML.includes('Download original'));
 const unsafe=await harness(url=>url.endsWith('/request-one')?Response.json({...issued,message:'<script>unsafe()</script>'}):undefined);await unsafe.portal.mount();assert(!unsafe.root.innerHTML.includes('<script>'));assert(unsafe.root.innerHTML.includes('&lt;script&gt;'));
});

test('a lost response acknowledgement retains the original key, decision and comment for exact retry',async()=>{
 let writes=0;const h=await harness(url=>url.endsWith('/response')&&++writes===1?Response.json({error:'Response acknowledgement lost'},{status:503}):undefined);await h.portal.mount();
 await h.submit(h.form().form);assert(h.root.innerHTML.includes('Retry Accept'));assert.equal(h.portal.isDirty(),true);
 await h.submit(h.form('A changed local value').form);
 const posted=h.calls.filter(row=>row.url.endsWith('/response'));assert.equal(posted.length,2);assert.deepEqual(posted[0].options,posted[1].options);assert.equal(h.portal.isDirty(),false);assert.equal(h.portal.getState().review.items[0].response.version,1);
});

test('browser navigation cannot abandon a pending client response',async()=>{
 const held=deferred(),h=await harness(url=>url.endsWith('/response')?held.promise:undefined);await h.portal.mount();const saving=h.submit(h.form().form);await new Promise(setImmediate);
 assert.equal(h.portal.isBusy(),true);await h.hash('#reviews/another-request');assert.equal(h.location.hash,'#reviews/request-one');assert(!h.calls.some(row=>row.url.includes('another-request')));
 held.resolve(Response.json({decision:'accepted',message:'Agreed.',version:1,created_at:'2030-01-01T10:01:00Z'},{status:201}));await saving;assert.equal(h.portal.isBusy(),false);
});

test('a revoked client response removes issued images and previous review metadata from the page',async()=>{
 const h=await harness(url=>url.endsWith('/response')?Response.json({error:'Invitation revoked'},{status:403}):undefined);await h.portal.mount();await h.submit(h.form().form);
 assert.equal(h.portal.getState().review,null);assert(!h.root.innerHTML.includes('Living room hero'));assert(!h.root.innerHTML.includes('client-issued-image'));assert(h.root.innerHTML.includes('Invitation revoked'));
});

test('an older authentication response cannot replace a later client identity after remount',async()=>{
 const held=deferred();let reads=0;const h=await harness(url=>url==='/api/client/auth'?(++reads===1?held.promise:Response.json({...auth,id:'client-two',name:'Another client'})):undefined,{hash:''});
 const old=h.portal.mount();await new Promise(setImmediate);h.portal.unmount();await h.portal.mount();held.resolve(Response.json(auth));await old;
 assert.equal(h.portal.getState().identity.id,'client-two');assert(h.root.innerHTML.includes('Another client'));
});

test('provider credentials are removed from the address before the session is submitted',async()=>{
 const h=await harness((url)=>{if(url==='/api/client/auth/session'){assert.equal(h.location.hash,'');assert.equal(h.location.search,'');return Response.json(auth);}},{hash:'#access_token=synthetic-token&refresh_token=synthetic-refresh'});
 await h.portal.mount();const exchange=h.calls.find(row=>row.url==='/api/client/auth/session');assert(exchange);assert.equal(JSON.parse(exchange.options.body).access_token,'synthetic-token');assert(!h.root.innerHTML.includes('synthetic-token'));
});

test('logout invalidates an older review lookup and detached portal listeners do not accumulate',async()=>{
 const held=deferred();let detailReads=0;const h=await harness(url=>url==='/api/client/reviews/request-one'&&++detailReads===1?held.promise:undefined);
 const mounting=h.portal.mount();for(let i=0;i<10;i++)await new Promise(setImmediate);
 await h.click('logout');held.resolve(Response.json(issued));await mounting;assert.equal(h.portal.getState().identity,null);assert(!h.root.innerHTML.includes('Living room hero'));
 h.portal.unmount();assert.equal(h.handlers.submit.length,0);assert.equal(h.windows.hashchange.length,0);await h.portal.mount();assert.equal(h.handlers.submit.length,1);assert.equal(h.windows.hashchange.length,1);
});
