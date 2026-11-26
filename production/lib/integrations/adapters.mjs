import {transport,arrayBody,stableId,safeText,safeUrl,dateISO,IntegrationError} from './http.mjs';
const MAX_PAGES=200;
function owner(value){return !['string','number'].includes(typeof value)||value===''?null:String(value).slice(0,300);}
function record(source,kind,id,values){return {source,kind,external_id:stableId(id),external_owner_id:null,title:'Untitled',occurred_at:null,...values};}
const first=(values,key)=>Array.isArray(values?.[key])?values[key][0]:null;
const textValue=v=>safeText(v?.value)||safeText(v?.full_name)||null;
const choiceValue=v=>safeText(v?.status?.title)||safeText(v?.option?.title)||textValue(v);
function calendarDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'2200-12-31')return null;const d=new Date(`${value}T12:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value?value:null;}
function attioSchema(config){
  if(!config.attioSchema)return {};
  let schema;try{if(config.attioSchema.length>16000)throw new Error();schema=JSON.parse(config.attioSchema);}catch{throw new IntegrationError('configuration_error','ATTIO_REPORTING_SCHEMA must be a valid JSON object of at most 16000 characters.');}
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v),slug=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
  if(!object(schema)||Object.keys(schema).some(k=>!['people','companies','deals','stageCategories','qualifiedValues','probabilityScale'].includes(k)))throw new IntegrationError('configuration_error','The Attio reporting schema contains unsupported fields.');
  const allowed={people:['owner','leadStatus'],companies:['owner'],deals:['owner','stage','value','closeDate','closedDate','probability']};
  for(const [type,fields] of Object.entries(allowed))if(Object.hasOwn(schema,type)&&(!object(schema[type])||Object.entries(schema[type]).some(([k,v])=>!fields.includes(k)||!slug(v))))throw new IntegrationError('configuration_error',`Confirm the Attio ${type} attribute slugs.`);
  if(Object.hasOwn(schema,'stageCategories')&&(!object(schema.stageCategories)||Object.entries(schema.stageCategories).some(([k,v])=>!k||k.length>300||!['open','won','lost'].includes(v))))throw new IntegrationError('configuration_error','Attio stage categories must map exact status IDs or titles to open, won or lost.');
  if(Object.hasOwn(schema,'qualifiedValues')&&(!Array.isArray(schema.qualifiedValues)||schema.qualifiedValues.length>100||schema.qualifiedValues.some(v=>typeof v!=='string'||!v||v.length>300)))throw new IntegrationError('configuration_error','Confirm the qualified lead status values.');
  if(schema.probabilityScale!==undefined&&![1,100].includes(schema.probabilityScale))throw new IntegrationError('configuration_error','Attio probability scale must be 1 or 100.');
  if(schema.deals?.probability&&!schema.probabilityScale)throw new IntegrationError('configuration_error','Confirm the Attio probability scale before forecasting.');
  return schema;
}
function stageCategory(schema,id,title){const mapping=schema.stageCategories||{};return (id&&Object.hasOwn(mapping,id)?mapping[id]:null)||(title&&Object.hasOwn(mapping,title)?mapping[title]:null)||null;}

export async function attioSnapshot(config,options={}){
  const request=transport({source:'Attio',origin:'https://api.attio.com',authorization:`Bearer ${config.token}`,...options});
  const schema=attioSchema(config),result=[],warnings=[],objects=[['people','lead','people'],['companies','company','companies'],[config.dealsObject||'deals','deal','deals']];
  for(const [object,kind,type] of objects){
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(object))throw new IntegrationError('configuration_error','The Attio deals object slug is invalid.');
    for(let page=0;page<MAX_PAGES;page++){
      let response;try{response=await request(`/v2/objects/${encodeURIComponent(object)}/records/query`,{method:'POST',body:{limit:500,offset:page*500}});}catch(e){if(kind==='deal'&&e.code==='configuration_error'){warnings.push('Deal records unavailable: confirm that the configured Attio deals object is enabled and readable.');break;}throw e;}
      const rows=arrayBody(response,['data']);
      for(const row of rows){const v=row.values||{},mapping=schema[type]||{},name=first(v,'name'),stage=first(v,mapping.stage||'stage'),value=first(v,mapping.value||'value'),ref=first(v,mapping.owner||'owner');
        const stageTitle=choiceValue(stage),stageId=safeText(stage?.status?.id?.status_id),leadStatus=mapping.leadStatus?choiceValue(first(v,mapping.leadStatus)):null,probability=mapping.probability?first(v,mapping.probability)?.value:null,ratio=typeof probability==='number'&&Number.isFinite(probability)?probability/schema.probabilityScale:null;
        const refs=key=>(Array.isArray(v[key])?v[key]:[]).map(x=>safeText(x.target_record_id)).filter(Boolean);
        result.push(record('attio',kind,row.id?.record_id,{title:textValue(name)||`${kind==='lead'?'Person':kind==='company'?'Company':'Deal'} ${stableId(row.id?.record_id)}`,external_owner_id:ref?.referenced_actor_type==='workspace-member'?owner(ref.referenced_actor_id):null,stage:stageTitle,stage_id:stageId,stage_category:kind==='deal'?stageCategory(schema,stageId,stageTitle):null,amount:typeof value?.currency_value==='number'&&Number.isFinite(value.currency_value)?value.currency_value:null,currency:typeof value?.currency_code==='string'&&/^[A-Z]{3}$/.test(value.currency_code)?value.currency_code:null,email:safeText(first(v,'email_addresses')?.email_address),phone:safeText(first(v,'phone_numbers')?.normalized_phone_number)||safeText(first(v,'phone_numbers')?.original_phone_number),job_title:textValue(first(v,'job_title')),domain:safeText(first(v,'domains')?.domain),lead_status:leadStatus,is_qualified:leadStatus&&schema.qualifiedValues?.length?schema.qualifiedValues.includes(leadStatus):null,company_ids:refs(kind==='lead'?'company':'associated_company'),people_ids:refs('associated_people'),projected_close_on:mapping.closeDate?calendarDate(first(v,mapping.closeDate)?.value):null,closed_on:mapping.closedDate?calendarDate(first(v,mapping.closedDate)?.value):null,probability:ratio!==null&&ratio>=0&&ratio<=1?ratio:null,probability_basis:mapping.probability?'Attio record attribute':null,source_url:safeUrl(row.web_url,['app.attio.com']),occurred_at:dateISO(row.created_at)}));
      }
      if(rows.length<500)break;if(page===MAX_PAGES-1)throw new IntegrationError('limit_exceeded','Attio sync exceeded the safety limit. No partial snapshot was published.');
    }
  }
  return {records:result,warnings,coverage:{period:'current CRM snapshot',deals_available:!warnings.length,reporting_schema_configured:!!config.attioSchema,stage_categories_configured:!!Object.keys(schema.stageCategories||{}).length,lead_status_configured:!!schema.people?.leadStatus,close_date_configured:!!schema.deals?.closeDate,closed_date_configured:!!schema.deals?.closedDate,probability_configured:!!schema.deals?.probability}};
}

async function lemlistPages(request,path){const all=[];for(let page=0;page<MAX_PAGES;page++){const delimiter=path.includes('?')?'&':'?',r=await request(`${path}${delimiter}limit=100&offset=${page*100}&version=v2`),rows=arrayBody(r,['data','activities','campaigns']);all.push(...rows);if(rows.length<100)return all;if(page===MAX_PAGES-1)throw new IntegrationError('limit_exceeded','Lemlist sync exceeded the safety limit. No partial snapshot was published.');}return all;}
export async function lemlistSnapshot(config,options={}){
  const request=transport({source:'Lemlist',origin:'https://api.lemlist.com',authorization:`Basic ${Buffer.from(`:${config.key}`).toString('base64')}`,...options});
  const now=(options.clock||(()=>new Date()))(),start=new Date(now.getTime()-30*86400000).toISOString(),result=[];
  const campaigns=await lemlistPages(request,'/api/campaigns');
  for(const c of campaigns)result.push(record('lemlist','campaign',c._id,{title:safeText(c.name)||'Campaign',external_owner_id:null,creator_id:owner(c.createdBy),stage:safeText(c.status)||safeText(c.state),occurred_at:dateISO(c.createdAt)}));
  for(let index=0;index<campaigns.length;index+=20){const ids=campaigns.slice(index,index+20).map(c=>stableId(c._id));const reports=arrayBody(await request(`/api/campaigns/reports?campaignIds=${encodeURIComponent(ids.join(','))}`),['data']);for(const r of reports)result.push(record('lemlist','campaign_report',r._id,{title:safeText(r.name)||'Campaign report',external_owner_id:null,campaign_id:stableId(r._id),period:'lifetime',leads:finite(r.totalCount),emails_sent:finite(r.emailsSent),emails_replied:finite(r.emailsReplied),linkedin_sent:finite(r.linkedinSent),linkedin_replied:finite(r.linkedinReplied),stage:safeText(r.state)||safeText(r.status)}));}
  const activities=await lemlistPages(request,`/api/activities?minDate=${encodeURIComponent(start)}&maxDate=${encodeURIComponent(now.toISOString())}`);
  for(const a of activities)result.push(record('lemlist','outreach',a._id,{title:safeText(a.type)||'Outreach activity',activity_type:safeText(a.type),external_owner_id:owner(a.sendUserId),attribution:a.sendUserId?'sending user':'unavailable',creator_id:owner(a.createdBy||a.metaData?.createdBy),campaign_id:owner(a.campaignId),lead_id:owner(a.leadId),email:safeText(a.leadEmail),contact_name:[a.leadFirstName,a.leadLastName].filter(x=>typeof x==='string').join(' ').slice(0,300)||null,company:safeText(a.leadCompanyName),is_automated:typeof a.bot==='boolean'?a.bot:null,occurred_at:dateISO(a.createdAt)}));
  return {records:result,warnings:['Outreach ownership uses the sending user when supplied; campaign totals are team-level and never attributed to Omar from a campaign creator. Automated events are not proof of manual work.'],coverage:{period:'Last 30 days of activities; campaign reports are lifetime',from:start,to:now.toISOString(),campaign_reports:'lifetime'}};
}
function finite(value){return typeof value==='number'&&Number.isFinite(value)?value:null;}

export async function justcallSnapshot(config,options={}){
  const request=transport({source:'JustCall',origin:'https://api.justcall.io',authorization:`${config.key}:${config.secret}`,...options});
  const records=[],seen=new Set(),now=(options.clock||(()=>new Date()))(),from=new Date(now.getTime()-30*86400000).toISOString().slice(0,10);let path=`/v2.1/calls?per_page=100&page=0&order=desc&sort=id&from_datetime=${from}`;
  for(let page=0;page<MAX_PAGES;page++){
    if(seen.has(path))throw new IntegrationError('invalid_response','JustCall repeated a pagination cursor. No partial snapshot was published.');seen.add(path);
    const response=await request(path),rows=arrayBody(response,['data','calls']);
    for(const c of rows){const info=c.call_info||{},id=c.id??c.call_id??c.call_sid;records.push(record('justcall','call',id,{title:safeText(c.contact_name)||safeText(c.contact_number)||`Call ${stableId(id)}`,external_owner_id:owner(c.agent_id),email:safeText(c.contact_email),direction:safeText(info.direction),outcome:safeText(info.disposition)||safeText(info.type),notes:safeText(info.notes),duration_seconds:finite(c.call_duration?.total_duration)??finite(info.duration),recording_available:!!safeUrl(info.recording,['justcall.io','jc-recordings.s3.amazonaws.com']),recording_url:safeUrl(info.recording,['justcall.io','jc-recordings.s3.amazonaws.com']),occurred_at:null,source_local_date:/^\d{4}-\d{2}-\d{2}$/.test(c.call_user_date||c.call_date||'')?(c.call_user_date||c.call_date):null,source_local_time:safeText(c.call_user_time||c.call_time,30),time_zone:'JustCall account timezone (unconfirmed)'}));}
    const next=response?.next_page_link||response?.links?.next||null;
    const hasPagination=response&&typeof response==='object'&&(Object.hasOwn(response,'next_page_link')||(response.links&&Object.hasOwn(response.links,'next')));
    if(!next&&rows.length===100&&!hasPagination)throw new IntegrationError('invalid_response','JustCall omitted pagination details on a full page. No partial snapshot was published.');
    if(!next)return {records,warnings:['Call dates follow the JustCall account timezone until that timezone is confirmed. Only the last 30 days are requested; API history is limited by the provider. Missing notes and recordings remain unavailable.'],coverage:{period:'Last 30 days',from}};
    const u=new URL(next,'https://api.justcall.io');if(u.origin!=='https://api.justcall.io'||u.pathname!=='/v2.1/calls')throw new IntegrationError('invalid_response','JustCall returned an unsafe pagination link.');path=u.pathname+u.search;
    if(page===MAX_PAGES-1)throw new IntegrationError('limit_exceeded','JustCall sync exceeded the safety limit. No partial snapshot was published.');
  }
}
