// Exercise the actual application/controller graph while the transport is held.
// This proves visible acknowledgement and latest-intent behavior at the DOM/HTTP
// boundary; native browser checks measure rendering time and real focus.
export function registerNavigationResponseCases({test,assert,harness}){
 function gate(){let release,started;const pending=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);return {pending,seen,release,started};}
 const html=h=>h.nodes.get('#app').innerHTML;
 const busy=h=>/<main\b[^>]*\baria-busy="true"/.test(html(h));
 function selected(h,view,title){
  assert(html(h).includes('nav-link active" href="#'+view+'" aria-current="page"'));
  assert(html(h).includes('<b>'+title+'</b>'));
  assert.equal(h.document.title,'NAM '+title+' — Studio workspace');
 }

 test('navigation acknowledges Sales before its data arrives and shows no cached activity as current',async()=>{
  const held=gate(),h=await harness({intercept:async(url,init,model,response)=>{if(url==='/api/sales'){held.started();await held.pending;return response({activities:[],reports:[],targets:[],activity_counts:[],activity_total:0});}return null;}});
  h.ui.state.sales={activities:[{id:'old-activity',context:'An old Sales record',owner_id:'sales-1',outcome:'Earlier result',occurred_on:'2026-11-01'}],reports:[],targets:[]};
  h.location.hash='#sales';const navigation=h.ui.navigate();await held.seen;
  selected(h,'sales','Sales');assert(busy(h));assert(html(h).includes('<h1>Sales</h1>'));assert(html(h).includes('role="status" aria-live="polite">Loading Sales…'));
  assert(!html(h).includes('An old Sales record'));assert(!html(h).includes('data-action="activity"'));
  // An unrelated synchronous rerender must retain the pending state, rather
  // than revealing the previous route's cached business data.
  h.ui.render();assert(busy(h));assert(!html(h).includes('An old Sales record'));
  held.release();await navigation;
  selected(h,'sales','Sales');assert(!busy(h));assert(html(h).includes('Your sales day'));assert(html(h).includes('Next follow-ups'));assert.equal(h.ui.state.routeLoading,null);
 });

 test('a failed route clears busy feedback and an explicit Retry loads the same selected workspace',async()=>{
  const held=gate();let calls=0;
  const h=await harness({intercept:async(url,init,model,response)=>{if(url==='/api/sales'&&++calls===1){held.started();await held.pending;return response({error:'Sales is temporarily unavailable.'},503);}return null;}});
  h.location.hash='#sales';const navigation=h.ui.navigate();await held.seen;assert(busy(h));held.release();await navigation;
  selected(h,'sales','Sales');assert(!busy(h));assert.equal(h.ui.state.routeLoading,null);assert(h.nodes.get('#main').innerHTML.includes('Workspace unavailable'));assert(h.nodes.get('#main').innerHTML.includes('Sales is temporarily unavailable.'));assert(h.nodes.get('#main').innerHTML.includes('data-action="retry-route"'));
  await h.ui.action({dataset:{action:'retry-route'}});assert.equal(calls,2);selected(h,'sales','Sales');assert(!busy(h));assert(html(h).includes('Next follow-ups'));
 });

 test('an older Sales response cannot replace a newer Academy selection',async()=>{
  const held=gate(),course={id:'new-course',title:'Current Academy assignment',area:'3d',summary:'Approved studio method',total:2,completed:0,completion:null};
  const h=await harness({intercept:async(url,init,model,response)=>{if(url==='/api/sales'){held.started();await held.pending;return response({activities:[],reports:[],targets:[]});}if(url==='/api/courses')return response([course]);return null;}});
  h.location.hash='#sales';const older=h.ui.navigate();await held.seen;selected(h,'sales','Sales');
  h.location.hash='#academy';await h.ui.navigate();selected(h,'academy','Academy');assert(!busy(h));assert(html(h).includes(course.title));const current=html(h);
  held.release();await older;assert.equal(html(h),current);selected(h,'academy','Academy');assert(!busy(h));assert.equal(h.ui.state.routeLoading,null);
 });

 test('an older failed request cannot clear the newer route’s pending state or publish its error',async()=>{
  const sales=gate(),academy=gate();
  const h=await harness({intercept:async(url,init,model,response)=>{if(url==='/api/sales'){sales.started();await sales.pending;return response({error:'Old Sales failure must stay hidden.'},503);}if(url==='/api/courses'){academy.started();await academy.pending;return response([]);}return null;}});
  h.location.hash='#sales';const older=h.ui.navigate();await sales.seen;
  h.location.hash='#academy';const newer=h.ui.navigate();await academy.seen;selected(h,'academy','Academy');assert(busy(h));
  sales.release();await older;selected(h,'academy','Academy');assert(busy(h));assert(!html(h).includes('Old Sales failure'));assert(!h.nodes.get('#main').innerHTML.includes('Old Sales failure'));
  academy.release();await newer;assert(!busy(h));assert.equal(h.ui.state.routeLoading,null);
 });

 test('unmount invalidates pending navigation without repainting the replacement host',async()=>{
  const held=gate(),h=await harness({intercept:async(url,init,model,response)=>{if(url==='/api/sales'){held.started();await held.pending;return response({activities:[],reports:[],targets:[]});}return null;}});
  h.location.hash='#sales';const navigation=h.ui.navigate();await held.seen;assert(busy(h));
  h.ui.unmountWorkspace();h.nodes.get('#app').innerHTML='<main>A replacement host owns this screen.</main>';
  held.release();await navigation;assert.equal(html(h),'<main>A replacement host owns this screen.</main>');assert.equal(h.ui.state.data,null);assert.equal(h.ui.state.routeLoading,null);
 });

 test('sign-out during navigation clears its pending state and a late response cannot restore private content',async()=>{
  const held=gate(),h=await harness({intercept:async(url,init,model,response)=>{if(url==='/api/sales'){held.started();await held.pending;return response({activities:[],reports:[],targets:[]});}return null;}});
  h.location.hash='#sales';const navigation=h.ui.navigate();await held.seen;await h.ui.action({dataset:{action:'logout'}});
  assert.equal(h.ui.state.routeLoading,null);assert.equal(h.ui.state.data,null);assert(html(h).includes('Sign in to continue.'));assert(!busy(h));
  const signedOut=html(h);held.release();await navigation;assert.equal(html(h),signedOut);assert(h.redirects.some(url=>url.startsWith('/login')));
 });
}
