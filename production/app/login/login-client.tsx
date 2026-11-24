'use client';
import Script from 'next/script';
import {useEffect,useRef,useState} from 'react';

type AuthBridge={mount:()=>Promise<void>;unmount:()=>void};
declare global{interface Window{__NAM_AUTH__?:AuthBridge}}

export function LoginClient({nonce}:{nonce?:string}){
  const active=useRef(true);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{active.current=true;window.__NAM_AUTH__?.mount().catch(()=>{if(active.current)setFailed(true);});return()=>{active.current=false;window.__NAM_AUTH__?.unmount();};},[]);
  return <>
    <div id="auth-app" suppressHydrationWarning><main id="main" className="loading-state" role="status">Opening secure sign-in…</main></div>
    {failed&&<main id="auth-error" className="production-access-state"><h1>Sign-in could not open.</h1><p role="alert">Reload this page to try again. Your account has not been changed.</p><button type="button" className="button primary" onClick={()=>window.location.reload()}>Reload sign-in</button></main>}
    <noscript><p className="notice">Enable JavaScript to use the private NAM OS workspace.</p></noscript>
    <Script id="nam-auth-module" src="/auth-entry.js" type="module" strategy="afterInteractive" nonce={nonce} onReady={()=>{if(!active.current)return;const bridge=window.__NAM_AUTH__;if(!bridge){setFailed(true);return;}bridge.mount().catch(()=>{if(active.current)setFailed(true);});}} onError={()=>setFailed(true)}/>
  </>;
}
