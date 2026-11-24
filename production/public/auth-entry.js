import {mountAuth,unmountAuth} from './auth.js';
let host=null,promise=null,controller=new AbortController(),csrf='';
function unmount(){host=null;promise=null;controller.abort();csrf='';unmountAuth();}
async function mount(){
  const target=document.querySelector('#auth-app');if(!target)throw new Error('Sign-in is unavailable.');
  if(host===target&&promise)return promise;
  unmount();host=target;controller=new AbortController();
  const request=async(path,method='GET',body)=>{
    const response=await fetch(`/api${path}`,{method,credentials:'same-origin',signal:controller.signal,headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    let result;try{result=await response.json();}catch{throw new Error('The server could not respond. Reload this page before trying again.');}
    if(!response.ok)throw new Error(result.error||'Sign-in was unsuccessful. Please retry.');
    if(result.csrf)csrf=result.csrf;return result;
  };
  promise=mountAuth({root:target,request,message:new URL(location.href).searchParams.get('reason')==='session-ended'?'Your session ended. Sign in to continue.':'',onSuccess:async result=>{
    const destination=new URL(result.redirect||'/workspace',location.origin);
    window.location.assign(destination.origin===location.origin&&['/workspace','/mfa','/auth/password'].includes(destination.pathname)?destination.href:'/workspace');
  }});return promise;
}
window.__NAM_AUTH__=Object.freeze({mount,unmount});
