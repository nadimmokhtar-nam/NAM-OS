import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as runtime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

// Real component/controller rendering. Hook fixtures cover presentation states;
// provider sessions, browser geometry and focus are separate integration gates.
async function component(file,mocks={}){
  const source=await readFile(new URL('../app/'+file,import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require(name){if(Object.hasOwn(mocks,name))return mocks[name];if(name==='react')return React;if(name==='react/jsx-runtime')return runtime;throw new Error('Unexpected component dependency: '+name);},window:{location:{reload(){}}}});
  return module.exports;
}
const frame=await component('auth-frame.tsx'),wrap=child=>renderToStaticMarkup(React.createElement(frame.AuthFrame,{title:'NAM account access.',intro:'Private studio workspace.'},child));
function hooks(states){let index=0;return {...React,useState:initial=>[index<states.length?states[index++]:initial,()=>{}],useRef:initial=>({current:initial}),useEffect(){}};}
async function bridge({framed=true,failure}={}){
  const listeners={},root={innerHTML:'',dataset:framed?{authFramed:'true'}:{}},requests=[];
  const source=(await readFile(new URL('../public/auth.js',import.meta.url),'utf8')).replace(/^export\s+/gm,'');
  const api=vm.runInNewContext(`(()=>{${source};return {mountAuth};})()`,{document:{addEventListener(type,fn){listeners[type]=fn;}},location:{hash:''}});
  await api.mountAuth({root,request:async path=>{requests.push(path);if(failure)throw new Error(failure);return {authenticated:false};},onSuccess:async()=>{throw new Error('Sign-in must require a submitted form.');}});
  return {root,requests,forgot(){listeners.click({target:{closest:()=>({dataset:{authAction:'forgot'}})},preventDefault(){}});}};
}
const countMain=html=>(html.match(/<main\b/g)||[]).length;

test('shared auth frame renders the original NAM identity and one main landmark without invented imagery or SSO',()=>{
  const html=wrap(React.createElement('p',null,'Account access'));
  assert.equal(countMain(html),1);for(const name of ['auth-shell','auth-rail','auth-content','auth-form','auth-mobile-brand'])assert(html.includes(name));
  assert(html.includes('src="/nam-logo.png"'));assert(!/Programa|Trimble|Xero|Continue with Google|photograph/i.test(html));assert(html.includes('Private studio workspace.'));
});
test('framed login bridge retains field contracts and adds no nested main or duplicate brand rail',async()=>{
  const h=await bridge();assert.equal(countMain(h.root.innerHTML),0);assert(!h.root.innerHTML.includes('class="auth-rail"'));
  const html=wrap(React.createElement('div',{id:'auth-app','data-auth-framed':'true',dangerouslySetInnerHTML:{__html:h.root.innerHTML}}));assert.equal(countMain(html),1);
  assert(html.includes('data-auth-form="login"'));assert(html.includes('id="auth-email" name="email" type="email"'));assert(html.includes('id="auth-password" name="password" type="password"'));assert(html.includes('autocomplete="current-password"'));assert(html.includes('data-auth-action="forgot"'));assert.deepEqual(h.requests,['/auth']);
});
test('unframed auth consumers receive the same complete shell and manual recovery remains truthful',async()=>{
  const h=await bridge({framed:false});assert.equal(countMain(h.root.innerHTML),1);assert(h.root.innerHTML.includes('class="auth-rail"'));h.forgot();
  assert(h.root.innerHTML.includes('An administrator can issue a short-lived password recovery link'));assert(h.root.innerHTML.includes('Automated recovery email delivery is not configured'));assert(!h.root.innerHTML.includes('Email sent'));assert.deepEqual(h.requests,['/auth']);assert.equal(countMain(h.root.innerHTML),1);
});
test('provider failure feedback stays escaped inside the new framed presentation',async()=>{
  const h=await bridge({failure:'<img src=x onerror=alert(1)>'});assert(h.root.innerHTML.includes('role="alert"'));assert(h.root.innerHTML.includes('&lt;img'));assert(!h.root.innerHTML.includes('<img src=x'));assert.equal(countMain(h.root.innerHTML),0);
});
test('login loading and module failure each retain a single outer main and nonce-bearing script lifecycle',async()=>{
  for(const failed of [false,true]){
    let scriptProps;
    const module=await component('login/login-client.tsx',{'react':hooks([failed]),'../auth-frame':frame,'next/script':{default:props=>{scriptProps=props;return null;}}});
    const html=renderToStaticMarkup(React.createElement(module.LoginClient,{nonce:'test-nonce'}));assert.equal(countMain(html),1);assert(html.includes('data-auth-framed="true"'));assert.equal(scriptProps.nonce,'test-nonce');assert.equal(scriptProps.src,'/auth-entry.js');assert.equal(scriptProps.type,'module');
    if(failed){assert(html.includes('id="auth-app" data-auth-framed="true" hidden=""'));assert(html.includes('Sign-in could not open.'));assert(html.includes('Reload sign-in'));}else assert(html.includes('Opening secure sign-in'));
  }
});
test('password setup preserves native labels, password limits and its MFA recovery continuation',async()=>{
  const module=await component('auth/password/password-form.tsx',{'react':hooks([false,'',true])}),html=wrap(React.createElement(module.default));
  assert(html.includes('class="auth-form-fields"'));assert(html.includes('for="new-password"'));assert(html.includes('id="new-password"'));assert(html.includes('name="password"'));assert(html.includes('name="confirm"'));assert(html.includes('minLength="12"'));assert(html.includes('maxLength="256"'));assert(html.includes('/mfa?next=%2Fauth%2Fpassword'));assert(html.includes('Save password'));
});
test('MFA presentation remains verification-only for an already-enabled authenticator',async()=>{
  const security={csrf:'fixture-token',factors:[{id:'factor',status:'verified',factor_type:'totp'}],mfaRequired:true,mfaVerified:false};
  const module=await component('mfa/mfa-form.tsx',{'react':hooks([security,false,''])}),html=wrap(React.createElement(module.default,{next:'/workspace'}));
  const codeInput=html.match(/<input\b[^>]*id="mfa-code"[^>]*>/)?.[0];
  assert(html.includes('for="mfa-code"'));assert(codeInput?.includes('name="code"'));assert(html.includes('inputMode="numeric"'));assert(html.includes('autoComplete="one-time-code"'));assert(html.includes('pattern="[0-9]{6}"'));assert(html.includes('Verify authenticator'));assert(!/Start setup|mfa-secret|type="password"/.test(html));assert(html.includes('href="/login"'));
});
