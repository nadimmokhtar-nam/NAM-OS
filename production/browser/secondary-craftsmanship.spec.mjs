import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {actor} from './support.mjs';

// Display-only overrides exercise real UI with long synthetic labels. Actual
// authentication, IDs, roles, grants, HTTP responses and mutations are retained.
// These layout checks are distinct from the unmodified persistence/security suite.
const longName='QA ArchitecturalVisualisationAndInternationalProductionDirectionSpecialist';
async function displayLabels(page){
 await page.route('**/api/bootstrap*',async route=>{
  if(route.request().method()!=='GET')return route.continue();
  const response=await route.fetch();if(!response.ok())return route.fulfill({response});
  const data=await response.json();
  data.actor={...data.actor,name:longName};
  data.members=data.members.map(member=>({...member,name:member.id===data.actor.id?longName:member.name}));
  await route.fulfill({response,json:data});
 });
 await page.route('**/api/auth/members',async route=>{
  if(route.request().method()!=='GET')return route.continue();
  const response=await route.fetch();if(!response.ok())return route.fulfill({response});
  const data=await response.json();
  data.accounts=data.accounts.map((member,index)=>({...member,...(index===0?{name:longName,email:'quality.review.long.email.address@studio.example.test'}:{})}));
  await route.fulfill({response,json:data});
 });
 await page.route('**/api/auth/access/*',async route=>{
  if(route.request().method()!=='GET')return route.continue();
  const response=await route.fetch();if(!response.ok())return route.fulfill({response});
  const data=await response.json();await route.fulfill({response,json:{...data,name:longName}});
 });
}

async function geometry(page){
 return page.locator('#main').evaluate(main=>{
  const viewport=document.documentElement.clientWidth,issues=[];
  for(const panel of main.querySelectorAll('.panel')){
   const box=panel.getBoundingClientRect(),style=getComputedStyle(panel);
   if(!box.width)continue;
   const right=box.right-parseFloat(style.paddingRight),left=box.left+parseFloat(style.paddingLeft);
   for(const button of panel.querySelectorAll('.filters .button,.filters .icon-btn')){
    const rect=button.getBoundingClientRect();if(!rect.width||getComputedStyle(button).visibility==='hidden')continue;
    if(rect.left<left-1||rect.right>right+1)issues.push({kind:'panel action exceeds content grid',left:+rect.left.toFixed(1),right:+rect.right.toFixed(1),contentRight:+right.toFixed(1)});
   }
   for(const group of panel.querySelectorAll('.filters')){
    const controls=[...group.children].filter(node=>node.matches('button')).map(node=>node.getBoundingClientRect());
    for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
     const a=controls[i],b=controls[j];
     if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)issues.push({kind:'overlapping actions',i,j});
    }
   }
  }
  const blocks=[...main.children].filter(node=>node.matches('.panel,.two-col')).map(node=>node.getBoundingClientRect()).filter(rect=>rect.width>0);
  const gaps=blocks.slice(1).map((rect,index)=>+(rect.top-blocks[index].bottom).toFixed(1));
  const header=main.querySelector('.page-head'),heading=header?.querySelector('h1'),action=header?.querySelector(':scope > .button');
  const h=heading?.getBoundingClientRect(),a=action?.getBoundingClientRect();
  return {viewport,documentWidth:document.documentElement.scrollWidth,issues:issues.slice(0,16),gaps,headingActionOffset:h&&a&&a.left>=h.right-1?+(a.top-h.top).toFixed(1):null};
 });
}

for(const width of [320,390,768,1440])test('secondary screens preserve grids, action groups and long names at '+width+'px',async({browser})=>{
 const {context,page}=await actor(browser,'founder',{viewport:{width,height:1000}});
 try{
  await displayLabels(page);
  for(const route of ['settings','team','library','operations']){
   await page.goto('/workspace#'+route);await expect(page.locator('#main h1')).toBeVisible();
   await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
   await expect(page.locator('#main h1')).toHaveText({settings:'Settings',team:'Team',library:'Library',operations:'Operations'}[route]);
   if(route==='settings')await expect(page.getByRole('heading',{name:'Workspace access',exact:true})).toBeVisible();
   await page.evaluate(()=>document.fonts.ready);
   const result=await geometry(page);
   expect(result.documentWidth,route+' document must fit its viewport').toBeLessThanOrEqual(result.viewport+1);
   expect(result.issues,route+' actions must remain inside their panel content grid without overlap').toEqual([]);
   if(route==='settings'){
    await expect(page.locator('.sidebar .nav-link[href="#settings"]')).toHaveAttribute('aria-current','page');
    expect(result.gaps.length).toBeGreaterThanOrEqual(2);
    expect(result.gaps.every(gap=>gap>=16),'Settings sections must have deliberate vertical separation').toBe(true);
    const access=page.getByRole('button',{name:'Manage access',exact:true}).first();
    await access.focus();await access.press('Enter');
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
    const header=await dialog.locator('.dialog-head').evaluate(el=>{
     const rect=el.getBoundingClientRect(),style=getComputedStyle(el),title=el.querySelector('h2').getBoundingClientRect(),close=el.querySelector('[aria-label="Close dialog"]').getBoundingClientRect();
     return {right:rect.right-parseFloat(style.paddingRight),titleRight:title.right,closeLeft:close.left,closeRight:close.right,closeWidth:close.width};
    });
    expect(header.closeRight,'Close control must stay on the dialog content grid').toBeLessThanOrEqual(header.right+1);
    expect(header.titleRight,'Long titles must not collide with Close').toBeLessThanOrEqual(header.closeLeft-8);
    expect(header.closeWidth).toBeGreaterThanOrEqual(width<=700?44:32);
    await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(access).toBeFocused();
    const invite=page.getByRole('button',{name:'Invite a team member',exact:true});
    await invite.focus();await invite.press('Enter');await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(invite).toBeFocused();
   }
   if(result.headingActionOffset!==null)expect(Math.abs(result.headingActionOffset),route+' title and primary action must share the same top alignment').toBeLessThanOrEqual(2);
  }
 }finally{await context.close();}
});

test('secondary screens retain automated accessibility with long names and reduced motion',async({browser})=>{
 const {context,page}=await actor(browser,'founder',{viewport:{width:390,height:1000},reducedMotion:'reduce'});
 try{
  await displayLabels(page);
  for(const route of ['settings','team','library','operations']){
   await page.goto('/workspace#'+route);await expect(page.locator('#main h1')).toBeVisible();
   await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
   await expect(page.locator('#main h1')).toHaveText({settings:'Settings',team:'Team',library:'Library',operations:'Operations'}[route]);
   if(route==='settings')await expect(page.getByRole('heading',{name:'Workspace access',exact:true})).toBeVisible();
   const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
   expect(result.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.length})),route+' accessibility violations').toEqual([]);
  }
 }finally{await context.close();}
});
