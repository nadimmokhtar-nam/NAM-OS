import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {PWA_RELEASE,deploymentChanged} from '../app/pwa-policy.ts';

// Real component policy/effect tests with bounded hooks/events, not browser
// install, assistive technology or offline-storage certification.
const component=ts.transpileModule(await readFile(new URL('../app/pwa-controls.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import[^\n]*\n/gm,'').replace(/^export\s+/gm,'');
async function harness({version=PWA_RELEASE}={}){
  const states=[],refs=[],effects=[],events=new Map(),docEvents=new Map(),requests=[],timers=[],navigation={reloads:0,confirm:false},mediaEvents=new Map();let si=0,ri=0,initialized=false,helpCount=0,registrations=0;
  const navigator={onLine:true,serviceWorker:{register(){registrations++;throw new Error('This release must not register a worker.');}}};
  const document={visibilityState:'visible',addEventListener:(type,fn)=>docEvents.set(type,fn),removeEventListener:type=>docEvents.delete(type)};
  const window={matchMedia:()=>({matches:false,addEventListener:(type,fn)=>mediaEvents.set(type,fn),removeEventListener:type=>mediaEvents.delete(type)}),setInterval:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearInterval(){},addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:type=>events.delete(type),confirm:()=>navigation.confirm,location:{reload:()=>navigation.reloads++}};
  const jsx=(type,props)=>({type,props}),context=vm.createContext({console,AbortController,navigator,document,window,deploymentChanged,_jsx:jsx,_jsxs:jsx,_Fragment:'fragment',useState(initial){const i=si++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=ri++;return refs[i]??=( {current:initial} );},useEffect(fn){if(!initialized)effects.push(fn);},fetch:async(url,init)=>{requests.push({url,init});return {ok:true,json:async()=>({release:version})};}});
  const renderFn=vm.runInContext(`(()=>{${component};return PwaControls;})()`,context);
  function render(){si=0;ri=0;const tree=renderFn();initialized=true;return tree;}
  const tree=render();refs[1].current={showModal(){helpCount++;},close(){}};const cleanup=effects[0]();await new Promise(resolve=>setImmediate(resolve));
  return {render,tree,states,refs,events,docEvents,requests,timers,navigator,document,navigation,cleanup,helpCount:()=>helpCount,registrations:()=>registrations,mediaEvents};
}
function find(tree,predicate){if(tree==null||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const child of tree){const found=find(child,predicate);if(found)return found;}return null;}if(predicate(tree))return tree;return find(tree.props?.children,predicate);}
const button=(tree,title)=>find(tree,node=>node.type==='button'&&node.props.children===title);

test('manifest offers protected standalone launch and real correctly sized original-logo PNGs',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));assert.equal(manifest.id,'/nam-os');assert.equal(manifest.start_url,'/workspace');assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');assert.equal(manifest.prefer_related_applications,false);
  for(const size of [192,512]){const entry=manifest.icons.find(icon=>icon.sizes===`${size}x${size}`&&icon.purpose==='any');assert(entry);assert(entry.src.startsWith('/icons/'));const bytes=await readFile(new URL('../public'+entry.src,import.meta.url));assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);}
  const maskable=manifest.icons.find(icon=>icon.purpose==='maskable');assert(maskable);const bytes=await readFile(new URL('../public'+maskable.src,import.meta.url));assert.equal(bytes.readUInt32BE(16),512);assert.equal(bytes.readUInt32BE(20),512);
});
test('release metadata matches client and malformed responses never announce an update',async()=>{
  const info=JSON.parse(await readFile(new URL('../public/app-version.json',import.meta.url),'utf8'));assert.equal(info.release,PWA_RELEASE);assert.equal(deploymentChanged(info),false);assert.equal(deploymentChanged({release:'build-ffffffffffffffff'}),true);for(const value of [null,[],{},'new',{error:'Expired'},{release:'<script>'},{release:42}])assert.equal(deploymentChanged(value),false);
});
test('update checks are public network-only and stop while hidden/offline; cleanup aborts them',async()=>{
  const h=await harness();assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/app-version.json');assert.equal(h.requests[0].init.cache,'no-store');assert.equal(h.requests[0].init.credentials,'omit');assert.equal(h.registrations(),0);assert.equal(h.timers[0].ms,15*60*1000);
  h.document.visibilityState='hidden';await h.timers[0].fn();h.document.visibilityState='visible';h.navigator.onLine=false;await h.timers[0].fn();assert.equal(h.requests.length,1);h.cleanup();assert.equal(h.requests[0].init.signal.aborted,true);assert.equal(h.events.size,0);assert.equal(h.docEvents.size,0);assert.equal(h.mediaEvents.size,0);
});
test('installation invokes browser consent and is not marked installed until browser confirms',async()=>{
  const h=await harness();let prompts=0,prevented=0;h.events.get('beforeinstallprompt')({preventDefault(){prevented++;},prompt:async()=>prompts++,userChoice:Promise.resolve({outcome:'accepted'})});assert.equal(prevented,1);await button(h.render(),'Install NAM OS').props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(prompts,1);assert.equal(h.states[0],false);assert(h.states[4].includes('browser will complete'));h.events.get('appinstalled')();assert.equal(h.states[0],true);assert.equal(button(h.render(),'Install NAM OS'),null);h.cleanup();
});
test('unsupported install prompting opens instructions without claiming installation',async()=>{
  const h=await harness();await button(h.render(),'Install NAM OS').props.onClick();assert.equal(h.helpCount(),1);assert.equal(h.states[0],false);assert.equal(h.requests.length,1);h.cleanup();
});
test('deployment update waits for an explicit reload confirmation instead of discarding work',async()=>{
  const h=await harness({version:'build-ffffffffffffffff'});assert.equal(h.states[2],true);assert.equal(h.navigation.reloads,0);const reload=button(h.render(),'Reload for update');assert(reload);reload.props.onClick();assert.equal(h.navigation.reloads,0);h.navigation.confirm=true;reload.props.onClick();assert.equal(h.navigation.reloads,1);h.cleanup();
});
test('offline state makes the no-queue limitation visible and sends no record mutations',async()=>{
  const h=await harness();h.navigator.onLine=false;h.events.get('offline')();const alert=find(h.render(),node=>node.props.role==='alert');assert(alert);assert(alert.props.children.includes('Changes are not queued'));assert(h.requests.every(request=>request.url==='/app-version.json'&&!request.init.body));h.cleanup();
});
test('installation has its own footer while offline, update and status notices keep their viewport region',async()=>{
  const h=await harness({version:'build-ffffffffffffffff'});h.navigator.onLine=false;h.events.get('offline')();h.states[4]='Installation status remains visible.';
  const tree=h.render(),slot=find(tree,node=>node.type==='footer'&&node.props.className==='pwa-install-slot'),notices=find(tree,node=>node.type==='aside'&&node.props.className.split(' ').includes('pwa-tools'));
  assert(slot);assert(notices);assert(button(slot,'Install NAM OS'));assert.equal(button(notices,'Install NAM OS'),null);
  assert(find(notices,node=>node.props.role==='alert'));assert(button(notices,'Reload for update'));assert(find(notices,node=>node.props.role==='status'&&node.props.children==='Installation status remains visible.'));
  h.events.get('appinstalled')();const installed=h.render();assert.equal(find(installed,node=>node.props.className==='pwa-install-slot'),null);assert(find(installed,node=>node.props.className==='pwa-tools pwa-tools-installed'));assert(find(installed,node=>node.props.role==='alert'));assert(button(installed,'Reload for update'));h.cleanup();
});

test('self-hosted Inter faces point to actual licensed WOFF2 files',async()=>{
  const css=await readFile(new URL('../app/styles.css',import.meta.url),'utf8'),license=await readFile(new URL('../public/fonts/LICENSE-Inter.txt',import.meta.url),'utf8');assert(license.includes('SIL OPEN FONT LICENSE'));assert(license.includes('The Inter Project Authors'));
  const faces=[...css.matchAll(/@font-face\{([^}]+)\}/g)].map(match=>match[1]).filter(face=>/font-family:Inter;/.test(face));assert.equal(faces.length,2);for(const face of faces){assert(face.includes('font-weight:100 900'));assert(face.includes('font-display:swap'));const path=face.match(/url\('([^']+)'\)/)?.[1];assert(path?.startsWith('/fonts/'));const bytes=await readFile(new URL('../public'+path,import.meta.url));assert.equal(bytes.subarray(0,4).toString(),'wOF2');assert(bytes.length>10000);}
});
