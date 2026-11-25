import {test,expect} from '@playwright/test';
import {actor,profiles} from './support.mjs';

for(const width of [320,390,768])test(`course outline keeps readable modules and lesson context at ${width}px`,async({browser})=>{
 const {context,page}=await actor(browser,'artist_1',{viewport:{width,height:844}});
 try{
  const course=(await profiles()).records.course;
  await page.goto('/workspace#academy');
  await page.locator('[data-action="course"][data-id="'+course+'"]').first().click();
  await expect(page.locator('.lesson-body h2')).toBeVisible();
  const outline=page.locator('.lesson-outline');
  if(await outline.count()&&!await outline.evaluate(node=>node.open))await outline.locator(':scope > summary').click();
  const modules=page.locator('.lesson-nav .lesson-module');
  expect(await modules.count(),'The training fixture must contain actual module headings.').toBeGreaterThan(0);
  for(const heading of await modules.all()){
   await expect(heading).toBeVisible();
   const box=await heading.evaluate(node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return {width:rect.width,height:rect.height,lineHeight:parseFloat(style.lineHeight),fontSize:parseFloat(style.fontSize),text:node.textContent.trim()};});
   expect(box.text).not.toBe('');
   expect(box.width,'A module heading must not shrink to a vertical strip.').toBeGreaterThanOrEqual(160);
   expect(box.height,'The synthetic module title must wrap into at most four normal lines.').toBeLessThanOrEqual(box.lineHeight*4+1);
   expect(box.fontSize).toBeGreaterThanOrEqual(12);
  }
  await page.locator('.lesson-nav [data-action="lesson"]').first().click();
  await expect(page.locator('.lesson-nav [data-action="lesson"]').first()).toHaveAttribute('aria-current','step');
  await expect(page.locator('.lesson-body h2')).toBeVisible();
  await expect(page.locator('.lesson-body h2')).toBeFocused();
  await expect(page.locator('.lesson-body > .eyebrow')).toContainText('Lesson 1');
  expect(await page.locator('.lesson-body').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'The lesson itself must not conceal internal horizontal overflow.').toBe(true);
 }finally{await context.close();}
});
