'use client';
import Script from 'next/script';
import {useEffect,useRef,useState} from 'react';
import {AuthFrame} from '../auth-frame';

type AuthBridge={mount:()=>Promise<void>;unmount:()=>void};
declare global{interface Window{__NAM_AUTH__?:AuthBridge}}

export function LoginClient({nonce}:{nonce?:string}){
  const active=useRef(true);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{active.current=true;window.__NAM_AUTH__?.mount().catch(()=>{if(active.current)setFailed(true);});return()=>{active.current=false;window.__NAM_AUTH__?.unmount();};},[]);
  return <>
    <AuthFrame>
      <div id="auth-app" data-auth-framed="true" hidden={failed} suppressHydrationWarning><h1 className="auth-title">Opening NAM OS.</h1><p className="auth-intro" role="status">Opening secure sign-in…</p></div>
      {failed&&<section id="auth-error" className="auth-module-error" aria-labelledby="auth-error-title"><h1 id="auth-error-title" className="auth-title">Sign-in could not open.</h1><p role="alert" className="form-error">Reload this page to try again. Your account has not been changed.</p><button type="button" className="button primary auth-submit" onClick={()=>window.location.reload()}>Reload sign-in</button></section>}
      <noscript><p className="notice">Enable JavaScript to use the private NAM OS workspace.</p></noscript>
    </AuthFrame>
    <Script id="nam-auth-module" src="/auth-entry.js" type="module" strategy="afterInteractive" nonce={nonce} onReady={()=>{if(!active.current)return;const bridge=window.__NAM_AUTH__;if(!bridge){setFailed(true);return;}bridge.mount().catch(()=>{if(active.current)setFailed(true);});}} onError={()=>setFailed(true)}/>
  </>;
}
