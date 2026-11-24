'use client';
import {useEffect,useRef,useState} from 'react';
import {deploymentChanged} from './pwa-policy';

type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};

/** Online-only PWA: no service worker, response cache or offline write queue.
 * Install remains browser-controlled; updates never reload an unsaved form. */
export function PwaControls(){
  const [installed,setInstalled]=useState(false),[offline,setOffline]=useState(false),[update,setUpdate]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const installEvent=useRef<InstallEvent|null>(null),help=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
    const status=()=>{setInstalled(standalone());setOffline(!navigator.onLine);};
    const offer=(event:Event)=>{event.preventDefault();installEvent.current=event as InstallEvent;};
    const accepted=()=>{installEvent.current=null;setInstalled(true);setNotice('');};
    const media=window.matchMedia('(display-mode: standalone)');
    const controller=new AbortController();let checking=false;
    async function check(){if(checking||document.visibilityState!=='visible'||!navigator.onLine)return;checking=true;try{
      const result=await fetch('/app-version.json',{cache:'no-store',credentials:'omit',signal:controller.signal});
      if(result.ok)setUpdate(deploymentChanged(await result.json()));
    }catch{/* Network and update checks never change work records or reload the page. */}finally{checking=false;}}
    status();void check();
    const interval=window.setInterval(()=>void check(),15*60*1000),visible=()=>void check();
    window.addEventListener('online',status);window.addEventListener('offline',status);window.addEventListener('beforeinstallprompt',offer);window.addEventListener('appinstalled',accepted);document.addEventListener('visibilitychange',visible);media.addEventListener('change',status);
    return()=>{controller.abort();window.clearInterval(interval);window.removeEventListener('online',status);window.removeEventListener('offline',status);window.removeEventListener('beforeinstallprompt',offer);window.removeEventListener('appinstalled',accepted);document.removeEventListener('visibilitychange',visible);media.removeEventListener('change',status);};
  },[]);
  async function install(){
    const event=installEvent.current;if(!event){help.current?.showModal();return;}
    setBusy(true);setNotice('');installEvent.current=null;
    try{await event.prompt();const result=await event.userChoice;if(result.outcome==='accepted')setNotice('Installation approved. Your browser will complete setup.');}
    catch{setNotice('The install prompt could not open. Use your browser’s app installation menu.');help.current?.showModal();}
    finally{setBusy(false);}
  }
  return <>
    <aside className="pwa-tools" aria-label="NAM OS application">
      {offline&&<p className="pwa-notice" role="alert">You’re offline. Reconnect before saving. Changes are not queued.</p>}
      {update&&<div className="pwa-notice"><p>A NAM OS update is available. Save your work before reloading.</p><button type="button" className="button small" onClick={()=>{if(window.confirm('Save your work before reloading. Reload NAM OS now?'))window.location.reload();}}>Reload for update</button></div>}
      {!installed&&<button type="button" className="button small pwa-install" disabled={busy} aria-busy={busy} onClick={()=>void install()}>Install NAM OS</button>}
      {notice&&<p className="pwa-notice" role="status">{notice}</p>}
    </aside>
    <dialog ref={help} className="pwa-help" aria-labelledby="pwa-install-title"><div className="dialog-head"><h2 id="pwa-install-title">Install NAM OS</h2><button type="button" className="button small" onClick={()=>help.current?.close()}>Close</button></div><div className="dialog-body"><p>Open NAM OS in an up-to-date Chrome or Edge browser on your Mac or Windows computer. Use the install icon in the address bar, or the browser menu’s option to install this page as an app.</p><hr className="rule"/><p>The app opens in its own window. Your NAM account and permissions stay the same. A connection is required; this release does not support offline editing.</p></div></dialog>
  </>;
}
