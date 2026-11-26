'use client';
import Script from 'next/script';
import {useEffect,useRef,useState} from 'react';
type ReviewBridge={mount:()=>Promise<void>;unmount:()=>void};
declare global{interface Window{__NAM_CLIENT_REVIEW__?:ReviewBridge}}
export function ReviewClient({nonce}:{nonce?:string}){
 const active=useRef(true),[failed,setFailed]=useState(false);
 useEffect(()=>{active.current=true;window.__NAM_CLIENT_REVIEW__?.mount().catch(()=>{if(active.current)setFailed(true);});return()=>{active.current=false;window.__NAM_CLIENT_REVIEW__?.unmount();};},[]);
 const ready=()=>{if(!active.current)return;const bridge=window.__NAM_CLIENT_REVIEW__;if(!bridge){setFailed(true);return;}bridge.mount().catch(()=>{if(active.current)setFailed(true);});};
 return <><link rel="modulepreload" href="/client-review-entry.js" nonce={nonce}/><div id="client-review-app" suppressHydrationWarning><main id="main" className="loading-state" role="status">Opening your project review…</main></div><div id="client-review-status" className="sr-only" role="status" aria-live="polite"/>{failed&&<section className="bridge-error" role="alert"><h1>Your review could not open.</h1><p>Reload to reconnect to NAM Studio.</p><button type="button" className="button primary" onClick={()=>window.location.reload()}>Reload review</button></section>}<Script id="nam-client-review" src="/client-review-entry.js" type="module" strategy="afterInteractive" nonce={nonce} onReady={ready} onError={()=>setFailed(true)}/></>;
}
