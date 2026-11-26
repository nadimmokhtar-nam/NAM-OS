'use client';

import Script from 'next/script';
import {useEffect,useRef,useState} from 'react';

type WorkspaceBridge={mount:()=>Promise<void>;unmount:()=>void};
declare global{interface Window{__NAM_WORKSPACE__?:WorkspaceBridge}}

/** The application module owns only the empty #app subtree. React owns the
 * scaffold and leaves that imperative subtree untouched after hydration. The
 * cached module can bind a fresh scaffold after a Next navigation or retry. */
export function WorkspaceClient({nonce}:{nonce?:string}){
  const active=useRef(true);
  const [scriptError,setScriptError]=useState(false);
  useEffect(()=>{
    active.current=true;
    // Next Script can already be cached when React replays effects or returns
    // to this route. Reattach here as well as onReady; mounting is idempotent.
    window.__NAM_WORKSPACE__?.mount().catch(()=>{if(active.current)setScriptError(true);});
    return ()=>{active.current=false;window.__NAM_WORKSPACE__?.unmount();};
  },[]);
  const ready=()=>{
    if(!active.current)return;
    const bridge=window.__NAM_WORKSPACE__;
    if(!bridge){setScriptError(true);return;}
    bridge.mount().catch(()=>{if(active.current)setScriptError(true);});
  };
  return <>
    {/* Fetch the public module graph while React hydrates. Execution/mounting
        still waits for the scaffold and the existing idempotent bridge. */}
    <link rel="modulepreload" href="/workspace-entry.js" nonce={nonce}/>
    <link rel="modulepreload" href="/app.js" nonce={nonce}/>
    <div id="app" suppressHydrationWarning>
      <main id="main" className="loading-state" role="status" tabIndex={-1}>Opening the studio workspace…</main>
    </div>
    <dialog id="dialog" aria-label="Workspace detail"/>
    <div id="toast" role="status" aria-live="polite"/>
    {scriptError&&<section className="bridge-error" role="alert">
      <h1>The workspace could not open.</h1>
      <p>Your records have not been changed. Reload to try again.</p>
      <button type="button" className="button primary" onClick={()=>window.location.reload()}>Reload workspace</button>
    </section>}
    <Script id="nam-workspace-module" src="/workspace-entry.js" type="module" strategy="afterInteractive" nonce={nonce} onReady={ready} onError={()=>setScriptError(true)}/>
  </>;
}
