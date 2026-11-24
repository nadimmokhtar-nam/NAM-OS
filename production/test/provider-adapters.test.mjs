import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attioSnapshot,lemlistSnapshot,justcallSnapshot} from '../lib/integrations/adapters.mjs';
import {transport} from '../lib/integrations/http.mjs';
const clock=()=>new Date('2026-11-24T12:00:00Z');
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
test('Attio adapter uses a read-only query with Bearer authentication and preserves missing values',async()=>{
 const result=await attioSnapshot({token:'fixture-attio'},{clock,paceMs:0,fetchImpl:async(url,options)=>{assert.equal(url.origin,'https://api.attio.com');assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer fixture-attio');assert.deepEqual(JSON.parse(options.body),{limit:500,offset:0});return json({data:url.pathname.includes('/deals/')?[{id:{record_id:'d1'},values:{name:[{value:'Deal'}],owner:[{referenced_actor_type:'workspace-member',referenced_actor_id:'owner1'}],stage:[{status:{title:'Qualified'}}],value:[{currency_value:12000,currency_code:'EUR'}]}}]:[]});}});
 assert.equal(result.records[0].amount,12000);assert.equal(result.records[0].currency,'EUR');assert.equal(result.records[0].external_owner_id,'owner1');assert.equal(result.records[0].email,null);
});
test('Lemlist adapter uses Basic authentication and pages outreach separately from lifetime team reports',async()=>{
 const offsets=[];const result=await lemlistSnapshot({key:'fixture-lemlist'},{clock,paceMs:0,fetchImpl:async(url,options)=>{assert.equal(options.headers.Authorization,'Basic '+Buffer.from(':fixture-lemlist').toString('base64'));if(url.pathname==='/api/campaigns')return json([{_id:'c1',name:'Campaign',createdBy:'creator'}]);if(url.pathname==='/api/campaigns/reports')return json([{_id:'c1',emailsSent:11,emailsReplied:2}]);const offset=Number(url.searchParams.get('offset'));offsets.push(offset);assert(url.searchParams.get('minDate'));return json(offset===0?Array.from({length:100},(_,i)=>({_id:'a'+i,type:'emailsSent',sendUserId:'sender'})):[{_id:'reply1',type:'emailsReplied',createdBy:'creator'}]);}});
 assert.deepEqual(offsets,[0,100]);assert.equal(result.records.filter(r=>r.kind==='outreach').length,101);assert.equal(result.records.find(r=>r.kind==='campaign_report').external_owner_id,null);assert.equal(result.records.find(r=>r.external_id==='reply1').external_owner_id,null);
});
test('JustCall adapter retains a genuine zero duration and never creates unsafe recording links',async()=>{
 const result=await justcallSnapshot({key:'fixture-key',secret:'fixture-secret'},{clock,paceMs:0,fetchImpl:async(url,options)=>{assert.equal(options.headers.Authorization,'fixture-key:fixture-secret');return json({data:[{id:1,agent_id:4,call_duration:{total_duration:0},call_info:{recording:'javascript:alert(1)'}}],next_page_link:null});}});
 assert.equal(result.records[0].duration_seconds,0);assert.equal(result.records[0].recording_url,null);assert.equal(result.records[0].occurred_at,null);
});
test('hostile pagination cannot receive a provider credential',async()=>{
 let requests=0;await assert.rejects(justcallSnapshot({key:'fixture-key',secret:'fixture-secret'},{clock,paceMs:0,fetchImpl:async()=>{requests++;return json({data:[{id:1}],next_page_link:'https://untrusted.example/calls'});}}),e=>e.code==='invalid_response');assert.equal(requests,1);
});
test('expired credentials, rate limits and provider failures produce sanitized typed errors',async()=>{
 for(const [status,code] of [[401,'expired'],[403,'permission_denied'],[429,'rate_limited'],[503,'unavailable']]){
 const request=transport({source:'Fixture',origin:'https://api.attio.com',authorization:'fixture-secret',clock,paceMs:0,fetchImpl:async()=>json({secret:'fixture-secret'},status,{'Retry-After':'120'})});
 await assert.rejects(request('/v2/test'),error=>{assert.equal(error.code,code);assert(!error.message.includes('fixture-secret'));if(status===429)assert.equal(error.retryAt,'2026-11-24T12:02:00.000Z');return true;});
 }
});
