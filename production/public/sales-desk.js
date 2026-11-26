const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const closed=new Set(['Done','Canceled']);
const date=value=>value?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')):'No date';
const tab=(value,title,kind='small')=>`<button class="button ${kind}" data-action="tab" data-value="${value}">${title}</button>`;
const work=(title,focus='',owner='')=>`<button class="button small" data-action="sales-work" data-focus="${esc(focus)}" data-owner="${esc(owner)}">${title}</button>`;

// The task page and recent ledgers are bounded. Only the server's complete
// monthly aggregates can supply target totals; a preview never supplies KPIs.
export function salesTargetCount(sales,target){
 if(!Array.isArray(sales.activity_counts))return null;
 const type=target.metric==='Meetings held'?'Meeting held':target.metric;
 const rows=sales.activity_counts.filter(row=>row.owner_id===target.owner_id&&row.type===type&&row.period===target.period);
 if(rows.some(row=>row.n===null||row.n===undefined||(typeof row.n==='string'&&!/^\d+$/.test(row.n))||!Number.isSafeInteger(Number(row.n))||Number(row.n)<0))return null;
 const result=rows.reduce((sum,row)=>sum+Number(row.n),0);return Number.isSafeInteger(result)?result:null;
}

export function salesDeskModel({data,sales,owner=''}){
 const selected=data.actor.role==='founder'?owner:data.actor.id;
 const inScope=row=>!selected||row.owner_id===selected;
 const rank=task=>task.due_date&&task.due_date<data.today?0:task.status==='Blocked'?1:task.due_date===data.today?2:task.status==='In progress'?3:task.due_date?4:5;
 const tasks=(data.tasks||[]).filter(task=>task.section==='sales'&&inScope(task)&&!closed.has(task.status)&&!task.archived&&!task.deleted_at).slice().sort((a,b)=>rank(a)-rank(b)||(a.due_date||'9999').localeCompare(b.due_date||'9999')||String(a.id).localeCompare(String(b.id)));
 const activities=(sales.activities||[]).filter(inScope).slice().sort((a,b)=>String(b.occurred_on).localeCompare(String(a.occurred_on))||String(b.created_at).localeCompare(String(a.created_at)));
 const reports=(sales.reports||[]).filter(inScope).slice().sort((a,b)=>String(b.week_start).localeCompare(String(a.week_start))||String(b.submitted_at).localeCompare(String(a.submitted_at)));
 return {owner:selected,tasks,activities,reports,targets:(sales.targets||[]).filter(target=>inScope(target)&&target.period===data.today.slice(0,7))};
}

export function renderSalesDesk({data,sales,taskRows,taskPage,owner=''}){
 const model=salesDeskModel({data,sales,owner}),founder=data.actor.role==='founder';
 const person=id=>data.members.find(member=>member.id===id)?.name||'Studio member';
 const scope=model.owner?person(model.owner):'The sales team';
 const ownerPicker=founder?`<div class="field sales-desk-owner"><label for="filter-owner">Sales member</label><select id="filter-owner"><option value="">All permitted sales members</option>${data.members.filter(member=>['founder','sales_manager','sales'].includes(member.role)||member.sections?.includes('sales')).map(member=>`<option value="${esc(member.id)}" ${model.owner===member.id?'selected':''}>${esc(member.name)}</option>`).join('')}</select></div>`:'';
 const activities=model.activities.slice(0,6),targets=model.targets.slice(0,4),reports=model.reports.slice(0,3),pending=founder?model.reports.filter(report=>!report.reviewed_at).slice(0,3):[];
 const coverage=taskPage?.hasMore?'This is a preview from the loaded work. Open all follow-ups for the complete list.':'Open all follow-ups to search completed work, change the view or check another deadline.';
 const taskEmpty=taskPage?.hasMore?'No open follow-ups in this loaded page.':'No open follow-ups in this view.';
 const targetRows=targets.map(target=>{const n=salesTargetCount(sales,target),count=n===null?'Unavailable':n.toLocaleString('en-GB');return `<div class="data-row"><div><h3>${esc(target.metric)}</h3><small>${esc(person(target.owner_id))} · ${esc(target.period)}</small></div><div><b>${count}${n===null?'':` / ${esc(target.target)}`}</b><small>${n===null?'Activity totals could not be loaded':'Manually logged NAM activities'}</small></div></div>`;}).join('');
 const activityRows=activities.map(activity=>`<div class="data-row"><div><h3>${esc(activity.context)}</h3><p>${esc(activity.outcome)}</p><small>${esc(person(activity.owner_id))} · ${date(activity.occurred_on)} · ${esc(activity.type)}</small></div></div>`).join('');
 const reportRows=reports.map(report=>`<div class="data-row"><div><h3>${esc(person(report.owner_id))}</h3><small>Week of ${date(report.week_start)} · ${report.reviewed_at?'Reviewed':'Awaiting review'}</small>${report.blockers?`<p><b>Blocker:</b> ${esc(report.blockers)}</p>`:''}</div></div>`).join('');
 return `<div class="sales-desk-heading"><div><p class="eyebrow">${esc(scope)}</p><h2>Keep the next conversation moving.</h2><p>Follow up, record the outcome and make the next commitment clear.</p></div><div class="filters">${ownerPicker}<button class="button primary" data-action="activity">Log activity</button>${data.capabilities?.createTaskSections?.includes('sales')?'<button class="button" data-action="create-task" data-section="sales">Create follow-up</button>':''}<button class="button" data-action="report">Weekly report</button></div></div>
 <div class="daily-layout sales-desk"><div class="daily-main"><section class="panel daily-section"><div class="panel-head"><div><h2>Next follow-ups</h2><p>Overdue work and blockers first, followed by upcoming commitments.</p></div>${work('All follow-ups','',model.owner)}</div>${model.tasks.length?taskRows(model.tasks.slice(0,6)):`<div class="daily-empty"><h3>${taskEmpty}</h3><p>Add the next action after a call, reply or meeting.</p></div>`}<p class="panel-foot">${coverage}</p><div class="filters">${work('Overdue','overdue',model.owner)}${work('Due today','today',model.owner)}${work('Blocked','blocked',model.owner)}</div></section>
 ${pending.length?`<section class="panel"><div class="panel-head"><div><h2>Reports awaiting your review</h2><p>Read the results and blockers before marking a report reviewed.</p></div>${tab('reports','All reports')}</div>${pending.map(report=>`<button class="daily-review-row" data-action="brief-review" data-kind="sales_report" data-id="${esc(report.id)}"><span><b>${esc(person(report.owner_id))}</b><small>Week of ${date(report.week_start)}</small><span>${esc(report.blockers||'No blockers reported.')}</span></span><span>Review</span></button>`).join('')}</section>`:''}
 <section class="panel"><div class="panel-head"><div><h2>Recent activity</h2><p>Outcomes entered by the team in NAM OS.</p></div>${tab('activities','Activity log')}</div>${activityRows||'<div class="daily-empty"><h3>No activity logged in this view.</h3><p>Record meaningful outcomes after outreach, replies and meetings.</p></div>'}${sales.activities_truncated?'<p class="panel-foot">Recent activity is a preview of the latest 500 permitted entries. Monthly target totals use the full activity ledger.</p>':''}</section></div>
 <aside class="daily-aside" aria-label="Sales commitments"><section class="panel"><div class="panel-head"><div><h2>This month’s targets</h2><p>Agreed targets, measured against logged activity.</p></div></div>${targetRows||'<p class="muted">No targets set for this view and month.</p>'}<div class="filters">${tab('targets','View targets')}${founder?'<button class="button small" data-action="target">Set target</button>':''}</div>${model.targets.length>targets.length?'<p class="panel-foot">Showing four current targets. Open View targets for all targets.</p>':''}</section>
 <section class="panel"><div class="panel-head"><div><h2>Weekly commitments</h2><p>Results, blockers and what comes next.</p></div></div>${reportRows||'<p class="muted">No weekly reports in this view.</p>'}${tab('reports','View reports')}</section>
 <section class="panel"><div class="panel-head"><div><h2>Connected reporting</h2><p>CRM, campaigns and calls retain their source and sync status.</p></div></div><p>Attio holds CRM records. Lemlist and JustCall provide activity where a verified connection is available.</p>${tab('connected','Open connected reporting')}</section></aside></div>`;
}
