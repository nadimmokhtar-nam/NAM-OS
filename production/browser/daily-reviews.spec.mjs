import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {actor,profiles,mutate,screenshot} from './support.mjs';

test('Founder reviews the current sales report from Today and stale report decisions fail safely',async({browser})=>{
 const sales=await actor(browser,'sales_1'),founder=await actor(browser,'founder'),other=await actor(browser,'sales_2'),artist=await actor(browser,'artist_2');
 const data=await (await sales.context.request.get('/api/bootstrap')).json(),day=new Date(data.today+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);
 const input={week_start:day.toISOString().slice(0,10),outcomes:'[QA] Two hospitality proposals advanced.',blockers:'Need an example of restrained exterior lighting.',next_week:'Confirm the next meeting and keep the follow-up date in Work.'};
 let response=await mutate(sales.context,'/sales/reports',input);expect(response.status()).toBe(200);
 const report=(await response.json()).reports.find(row=>row.owner_id===data.actor.id&&row.week_start===input.week_start);
 expect((await other.context.request.get('/api/sales/reports/'+report.id)).status()).toBe(404);expect((await artist.context.request.get('/api/sales/reports/'+report.id)).status()).toBe(403);
 await founder.page.goto('/workspace#overview');const button=founder.page.locator('.daily-review-queue [data-action="brief-review"][data-id="'+report.id+'"]');await expect(button).toBeVisible();
 await expect(founder.page.getByRole('heading',{name:'Sales, this week',exact:true})).toBeVisible();await button.click();const dialog=founder.page.getByRole('dialog');await expect(dialog).toContainText(input.outcomes);
 const check=await new AxeBuilder({page:founder.page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(check.violations.map(row=>row.id)).toEqual([]);
 response=await mutate(sales.context,'/sales/reports',{...input,outcomes:'[QA] A third proposal advanced after the Founder opened this report.'});expect(response.status()).toBe(200);
 await dialog.getByRole('button',{name:'Mark reviewed',exact:true}).click();await expect(dialog.locator('.form-error')).toContainText('changed elsewhere');await expect(dialog).toContainText(input.outcomes);
 const current=await (await founder.context.request.get('/api/sales/reports/'+report.id)).json();expect(current.reviewed_at).toBeNull();
 await founder.page.keyboard.press('Escape');await button.click();await expect(dialog).toContainText('A third proposal advanced');await dialog.getByRole('button',{name:'Mark reviewed',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(button).toHaveCount(0);
 expect((await (await founder.context.request.get('/api/sales/reports/'+report.id)).json()).reviewed_at).not.toBeNull();
 await Promise.all([sales.context.close(),founder.context.close(),other.context.close(),artist.context.close()]);
});

test('a practical assignment flows from artist submission to Founder review and the artist’s daily feedback',async({browser})=>{
 const fixture=await profiles(),founder=await actor(browser,'founder'),learner=await actor(browser,'artist_1'),other=await actor(browser,'artist_2'),courseId=fixture.records.course;
 const before=await (await learner.context.request.get('/api/courses/'+courseId)).json(),title='[QA] Explain the light hierarchy '+Date.now();
 const response=await mutate(founder.context,'/academy/admin/courses/'+courseId+'/assignments',{title,instructions:'Explain the subject, reference and the next adjustment.',course_version:before.version});expect(response.status()).toBe(201);const assignment=await response.json();
 await learner.page.goto('/workspace#academy');await learner.page.locator('[data-action="course"][data-id="'+courseId+'"]').first().click();
 const article=learner.page.locator('article.detail-section').filter({has:learner.page.getByRole('heading',{name:title,exact:true})});await article.getByRole('button',{name:'Write response',exact:true}).click();
 const learnerDialog=learner.page.getByRole('dialog');await learnerDialog.getByLabel('Your written response',{exact:true}).fill('The central plane is the subject. The competing highlight needs a softer value.');await learnerDialog.getByRole('button',{name:'Submit response',exact:true}).click();await expect(learnerDialog).not.toBeVisible();
 const submitted=(await (await learner.context.request.get('/api/courses/'+courseId)).json()).assignments.find(row=>row.id===assignment.id);
 expect((await other.context.request.get('/api/academy/submissions/'+submitted.submission_id)).status()).toBe(403);
 await founder.page.goto('/workspace#overview');const review=founder.page.locator('.daily-review-queue [data-action="brief-review"][data-id="'+submitted.submission_id+'"]');await expect(review).toBeVisible();await screenshot(founder.page,'after-today-decisions');await review.click();
 const dialog=founder.page.getByRole('dialog');await expect(dialog).toContainText('The central plane is the subject.');await dialog.getByLabel('Review decision',{exact:true}).selectOption('changes_requested');await dialog.getByLabel('Feedback',{exact:true}).fill('Show how the reference supports your lighting decision.');
 const check=await new AxeBuilder({page:founder.page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(check.violations.map(row=>row.id)).toEqual([]);
 await dialog.getByRole('button',{name:'Save review',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(review).toHaveCount(0);
 await learner.page.goto('/workspace#overview');await expect(learner.page.getByRole('heading',{name:'Learning feedback',exact:true})).toBeVisible();await learner.page.locator('.daily-aside [data-action="course"]').filter({hasText:title}).click();await expect(article).toContainText('Show how the reference supports your lighting decision.');
 await article.getByRole('button',{name:'Edit and resubmit',exact:true}).click();await learnerDialog.getByLabel('Your written response',{exact:true}).fill('The reference establishes soft directional daylight on the central subject plane. I will soften the competing highlight.');await learnerDialog.getByRole('button',{name:'Resubmit response',exact:true}).click();await expect(learnerDialog).not.toBeVisible();
 await founder.page.reload();await review.click();await dialog.getByLabel('Review decision',{exact:true}).selectOption('approved');await dialog.getByLabel('Feedback',{exact:true}).fill('Clear direction; apply it to the next render.');await dialog.getByRole('button',{name:'Save review',exact:true}).click();await expect(dialog).not.toBeVisible();
 const after=await (await learner.context.request.get('/api/courses/'+courseId)).json();expect(after.assignments.find(row=>row.id===assignment.id).submission_status).toBe('approved');expect(after.completed).toBe(before.completed);expect(after.completion).toEqual(before.completion);
 expect((await (await learner.context.request.get('/api/brief')).json()).learning_feedback.some(row=>row.id===submitted.submission_id)).toBe(false);
 await Promise.all([founder.context.close(),learner.context.close(),other.context.close()]);
});
