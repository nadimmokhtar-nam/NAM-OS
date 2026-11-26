import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {actor,profiles,mutate} from './support.mjs';

// The directory controls consume the real permission-filtered project list.
// Geometry follows the authenticated 26 November reference; media and Auth are
// provided by the existing disposable services, never a hosted studio tenant.
test('project search, sorting and Grid/List retain context and fit the inspected desktop and mobile layouts',async({browser},testInfo)=>{
 test.setTimeout(150000);
 const fixture=await profiles(),founder=await actor(browser,'founder'),artist=await actor(browser,'artist_1'),created=[];
 const lead=fixture.users.find(row=>row.key==='founder'),participant=fixture.users.find(row=>row.key==='artist_1');
 const marker='[QA] Directory '+Date.now().toString(36),names=['Residence 2','Residence 10','Atelier','Canal','Sunset'];
 let primary=null;
 try{
  for(let i=0;i<names.length;i++){
   const response=await mutate(founder.context,'/projects',{title:marker+' '+names[i],lead_id:lead.id,member_ids:i===0?[participant.id]:[],due_date:i===4?null:'2026-12-'+String(10+i),client_name:'[QA] Example Architecture',location:i%2?'Sydney':'Paris'});
   expect(response.status()).toBe(201);created.push(await response.json());
  }
  const page=founder.page;await page.goto('/workspace#projects');await expect(page.locator('#main h1')).toHaveText('Projects');await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
  const search=page.getByRole('searchbox',{name:'Search projects',exact:true});await search.fill(marker);await expect(page.locator('.project-card')).toHaveCount(5);
  const directory=await page.evaluate(()=>{const grid=document.querySelector('.project-grid'),card=grid.querySelector('.project-card'),media=card.querySelector('.project-card-media'),caption=card.querySelector('.project-card-caption'),box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};return {main:box(document.querySelector('#main')),grid:box(grid),card:box(card),media:box(media),caption:box(caption),gap:parseFloat(getComputedStyle(grid).columnGap),columns:getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length};});
  expect(directory.main.x).toBeCloseTo(236,0);expect(directory.grid.x).toBeCloseTo(252,0);expect(directory.columns).toBe(4);expect(directory.gap).toBe(16);
  expect(directory.media.height).toBeCloseTo(directory.media.width*46/93,0);expect(directory.caption.height).toBeCloseTo(42,0);
  await page.screenshot({path:testInfo.outputPath('task-fidelity-project-directory-1440.png'),animations:'disabled'});
  const listed=await founder.context.request.get('/api/projects?archived=0');expect(listed.status()).toBe(200);const body=await listed.json(),saved=body.items.find(row=>row.id===created[0].id);
  expect(Number.isFinite(Date.parse(saved.created_at))).toBe(true);expect(Number.isFinite(Date.parse(saved.updated_at))).toBe(true);

  const sort=page.locator('[data-project-sort-toggle]');await sort.click();await page.getByRole('button',{name:'Project name',exact:true}).click();
  const ordered=()=>page.locator('.project-card-title').allTextContents();
  await expect.poll(ordered).toEqual(['Atelier','Canal','Residence 2','Residence 10','Sunset'].map(name=>marker+' '+name));
  await sort.click();await page.getByRole('button',{name:'Descending',exact:true}).click();
  await expect.poll(ordered).toEqual(['Sunset','Residence 10','Residence 2','Canal','Atelier'].map(name=>marker+' '+name));
  await page.locator('[data-project-view-toggle]').click();await page.getByRole('button',{name:'List',exact:true}).click();await expect(page.locator('.project-list .project-card')).toHaveCount(5);
  expect(await page.locator('.project-list .project-card').first().evaluate(node=>node.getBoundingClientRect().height)).toBeCloseTo(54,0);
  await page.locator('.project-card[data-id="'+created[4].id+'"]').click();await expect(page.locator('#main h1')).toHaveText(created[4].title);
  await page.goBack();await expect(page.locator('#main h1')).toHaveText('Projects');await expect(search).toHaveValue(marker);
  await page.goForward();await expect(page.locator('#main h1')).toHaveText(created[4].title);
  await page.getByRole('button',{name:'Back to projects',exact:true}).click();await expect(page.locator('#main h1')).toHaveText('Projects');await expect(search).toHaveValue(marker);await expect(page.locator('.project-list .project-card')).toHaveCount(5);
  await sort.focus();await sort.press('Enter');await expect(page.locator('.project-sort-menu')).toHaveAttribute('open','');await page.keyboard.press('Escape');await expect(sort).toBeFocused();await expect(page.locator('.project-sort-menu')).not.toHaveAttribute('open','');
  await search.fill(marker+' absent');await expect(page.getByRole('heading',{name:'No matching projects',exact:true})).toBeVisible();await page.getByRole('button',{name:'Clear search',exact:true}).click();await expect(search).toHaveValue('');await expect(search).toBeFocused();
  await search.fill(marker);await page.locator('[data-project-view-toggle]').click();await page.getByRole('button',{name:'Grid',exact:true}).click();

  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});
   // Traditional scrollbars reserve space inside the main panel's stable gutter.
   // Check its available content width, as well as the fixed panel/page insets.
   const geometry=await page.evaluate(()=>{const panel=document.querySelector('#main'),main=panel.getBoundingClientRect(),heading=panel.querySelector('h1').getBoundingClientRect(),toolbar=panel.querySelector('.project-index-actions').getBoundingClientRect(),input=panel.querySelector('#project-search').getBoundingClientRect(),card=panel.querySelector('.project-card-media').getBoundingClientRect(),style=getComputedStyle(panel);return {viewport:innerWidth,document:document.documentElement.scrollWidth,mainRight:main.right,mainWidth:main.width,mainClientWidth:panel.clientWidth,gutter:parseFloat(style.paddingLeft),headingBottom:heading.bottom,toolbarTop:toolbar.top,toolbarRight:toolbar.right,inputWidth:input.width,cardWidth:card.width,cardHeight:card.height};});
   expect(geometry.document).toBeLessThanOrEqual(width+1);expect(geometry.mainRight).toBeLessThanOrEqual(width-6);expect(geometry.mainWidth).toBeCloseTo(width-16,0);expect(geometry.gutter).toBe(16);expect(geometry.toolbarRight).toBeLessThanOrEqual(width-6);expect(geometry.toolbarTop).toBeGreaterThanOrEqual(geometry.headingBottom+20);expect(geometry.inputWidth).toBeGreaterThan(45);expect(geometry.cardWidth).toBeCloseTo(geometry.mainClientWidth-2*geometry.gutter,0);expect(geometry.cardHeight).toBeCloseTo(geometry.cardWidth*46/93,0);
   const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(scan.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.length}))).toEqual([]);
   await page.screenshot({path:testInfo.outputPath('task-fidelity-project-directory-'+width+'.png'),animations:'disabled'});
  }

  await artist.page.goto('/workspace#projects');await expect(artist.page.locator('#main h1')).toHaveText('Projects');await artist.page.getByRole('searchbox',{name:'Search projects',exact:true}).fill(marker);
  await expect(artist.page.locator('.project-card')).toHaveCount(1);await expect(artist.page.locator('.project-card-title')).toHaveText(created[0].title);await expect(artist.page.getByRole('button',{name:'Create project',exact:true})).toHaveCount(0);
 }catch(error){primary=error;throw error;}finally{
  const cleanupErrors=[];
  for(const row of created){try{const response=await founder.context.request.get('/api/projects/'+row.id);if(response.status()===200){const current=await response.json();expect((await mutate(founder.context,'/projects/'+row.id,{expectedVersion:current.version,changes:{archived:true}},'PATCH')).status()).toBe(200);}}catch(error){cleanupErrors.push(error);}}
  await Promise.all([founder.context.close(),artist.context.close()]);
  if(cleanupErrors.length){if(primary)test.info().annotations.push({type:'cleanup-error',description:'Isolated project cleanup did not complete.'});else throw new AggregateError(cleanupErrors,'Isolated project cleanup did not complete.');}
 }
});
