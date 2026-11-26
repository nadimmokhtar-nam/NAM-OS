import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {actor,profiles} from './support.mjs';

test('a founder builds lessons, keeps drafts across views, then publishes and assigns a version',async({browser})=>{
 const fixture=await profiles(),founder=await actor(browser,'founder'),{page,context}=founder,title='[QA] Course editor '+Date.now();
 const artist=fixture.users.find(user=>user.key==='artist_1');
 await page.goto('/workspace#academy');await page.getByRole('button',{name:'Manage courses',exact:true}).click();await page.getByRole('button',{name:'Create course',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Course title',{exact:true}).fill(title);await dialog.getByLabel('Learning area',{exact:true}).selectOption('3d');await dialog.getByLabel('Summary',{exact:true}).fill('A synthetic course for the authoring journey.');
 const created=page.waitForResponse(response=>response.url().endsWith('/api/academy/admin/courses')&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Create draft',exact:true}).click();const course=await (await created).json();await expect(dialog).not.toBeVisible();
 await expect(page.getByRole('heading',{name:'Course outline',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Build the first lesson.',exact:true})).toBeVisible();
 for(const [lesson,body] of [['Set the camera','Begin with the approved composition.'],['Balance the light','Keep the material values consistent.']]){
  await page.locator('.academy-course-outline').getByRole('button',{name:'Add lesson',exact:true}).click();await dialog.getByLabel('Lesson title',{exact:true}).fill(lesson);await dialog.getByLabel('Written lesson',{exact:true}).fill(body);await dialog.getByRole('button',{name:'Add lesson',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('.academy-lesson-editor .prose')).toHaveText(body);
 }
 const navigationRequests=[];const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))navigationRequests.push(request.url());};page.on('request',observe);
 await page.locator('[data-academy-action="select-lesson"]').filter({hasText:'Set the camera'}).click();await expect(page.locator('.academy-lesson-editor .prose')).toHaveText('Begin with the approved composition.');
 await page.getByRole('button',{name:'Course details',exact:true}).click();await page.getByLabel('Summary',{exact:true}).fill('Keep this draft while shaping the lessons.');
 await page.getByRole('button',{name:'Lessons',exact:true}).click();await expect(page.getByText('Your course details have unsaved changes. They are kept while you work here.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Publish & people',exact:true}).click();await expect(page.getByRole('button',{name:'Review and publish',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Review details',exact:true}).click();await expect(page.getByLabel('Summary',{exact:true})).toHaveValue('Keep this draft while shaping the lessons.');
 page.off('request',observe);expect(navigationRequests,'local authoring navigation should not refresh the database').toEqual([]);
 await page.getByRole('button',{name:'Save working copy',exact:true}).click();await expect(page.locator('[data-academy-form="metadata"] .notice')).toHaveCount(0);
 await page.getByRole('button',{name:'Publish & people',exact:true}).click();await page.getByRole('button',{name:'Review and publish',exact:true}).click();await dialog.getByRole('button',{name:'Publish version 1',exact:true}).click();await expect(dialog).not.toBeVisible();
 await page.getByRole('button',{name:'Assign learner',exact:true}).click();await dialog.getByLabel('Learner',{exact:true}).selectOption(artist.id);await dialog.getByLabel('Published version',{exact:true}).selectOption('1');await dialog.getByLabel('Mandatory onboarding or training',{exact:true}).check();await dialog.getByRole('button',{name:'Save enrollment',exact:true}).click();await expect(dialog).not.toBeVisible();
 const saved=await (await context.request.get('/api/academy/admin/courses/'+course.id)).json();expect(saved.version).toBe(1);expect(saved.enrollments.some(enrollment=>enrollment.member_id===artist.id&&enrollment.course_version===1)).toBe(true);expect(saved.publications).toHaveLength(1);
 for(const name of ['Lessons','Course details','Practical work','Publish & people']){await page.getByRole('button',{name,exact:true}).click();const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(result.violations.map(violation=>({id:violation.id,impact:violation.impact,nodes:violation.nodes.length})),name+' authoring accessibility').toEqual([]);}
 await context.close();
});
