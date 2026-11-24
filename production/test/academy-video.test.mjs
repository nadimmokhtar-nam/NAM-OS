import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {database,asUser,ids} from './database.mjs';
import {client,context,loadServerModule,serial} from './support/runtime.mjs';
import {privateStorage} from './support/storage.mjs';
import {validateVideo,videoRange,MAX_VIDEO_BYTES} from '../lib/api/video-media.ts';

const bytes=await readFile(new URL('../browser/fixtures/academy-demo.mp4',import.meta.url));
let db,storage,dispatch,ApiError;
before(async()=>{db=await database();storage=privateStorage(db);({dispatchAcademyVideo:dispatch}=await loadServerModule('lib/api/academy-video.ts'));({ApiError}=await loadServerModule('lib/api/context.ts'));});
after(async()=>{await db?.close();});
async function rpc(user,name,args,options={}){const result=await client(db,user,options).rpc(name,args);if(result.error)throw result.error;return result.data;}
const admin=(op,c,changes={})=>rpc(ids.founder,'nam_academy_admin',{w:ids.w,op,p_course_id:c?.id||null,expected_revision:c?.revision||null,changes});
const read=course=>rpc(ids.founder,'nam_academy_admin_course',{w:ids.w,c_id:course.id});
async function course(){let result=await admin('create',null,{title:'Lighting with intent',area:'3d',summary:'A synthetic training fixture.'});return admin('lesson',result,{title:'Balance daylight and materials',body:'Written steps and a descriptive transcript remain available with the video.'});}
async function attest(ctx,video,revision,digest){
 try{return await rpc(null,'nam_attest_academy_video',{w:ids.w,vid:video.id,expected_revision:revision,verified_actor:ctx.user.id,verified_session:ctx.sessionId,verified_aal2:ctx.mfa.verified,content_sha256:digest},{role:'service_role'});}
 catch(error){throw new ApiError(error.code==='42501'?403:error.code==='40001'?409:400,'Isolated attestation rejected the operation.');}
}
const dependencies=()=>({attest,fetchStorage:storage.stream,storageOrigin:storage.origin});
async function call(user,path,method='GET',body,headers={},deps=dependencies()){
 const ctx=await context(db,user,{storage:storage.storage(user)});
 return dispatch(ctx,path.split('/'),new Request(storage.origin+'/api/'+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),deps);
}
const captions='WEBVTT\n\n00:00.000 --> 00:01.000\nA synthetic architectural frame.\n';
async function reserve(c,key,title='Light study'){
 const response=await call(ids.founder,'academy/videos','POST',{course_id:c.id,lesson_id:c.lessons[0].id,expectedRevision:c.revision,title,file_name:'academy-demo.mp4',mime:'video/mp4',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),caption_vtt:captions},{'Idempotency-Key':key});
 assert.equal(response.status,201);return response.json();
}
async function upload(plan,contents=bytes){const token=new URL(plan.uploadUrl).pathname.split('/').at(-1);await storage.acceptUpload(token,contents,'video/mp4');}
const denied=error=>['42501','P0002'].includes(error.code)||[403,404].includes(error.status);

test('real MP4 container validation and bounded byte ranges reject truncated, active and malformed content',()=>{
 assert.equal(validateVideo(bytes,'video/mp4'),createHash('sha256').update(bytes).digest('hex'));
 for(const invalid of [Buffer.from('<html><script>alert(1)</script></html>'),bytes.subarray(0,bytes.length-8),Buffer.concat([bytes,Buffer.from('junk')])])assert.throws(()=>validateVideo(invalid,'video/mp4'));
 assert.throws(()=>validateVideo(bytes,'text/html'));assert.throws(()=>validateVideo(Buffer.alloc(MAX_VIDEO_BYTES+1),'video/mp4'),{status:413});
 assert.deepEqual(videoRange('bytes=0-15',100),{start:0,end:15,length:16,partial:true});
 assert.deepEqual(videoRange('bytes=-10',100),{start:90,end:99,length:10,partial:true});
 assert.equal(videoRange('bytes=50-',100).length,50);assert.equal(videoRange('bytes=0-999',100).length,100);
 for(const value of ['bytes=','bytes=-0','bytes=100-','bytes=80-20','bytes=0-1,5-8','items=0-5','bytes=999999999999999-'])assert.throws(()=>videoRange(value,100),{status:416});
});

test('private video upload verifies actual stored bytes, streams ranges and captions, and pins the assigned publication',async()=>{
 let c=await course();const plan=await reserve(c,'video-real-bytes-0001');assert.equal(plan.status,'pending');
 c=await read(c);assert.equal(c.videos[0].status,'pending');
 await assert.rejects(admin('publish',c),e=>e.code==='40001');
 await assert.rejects(call(ids.artist,`academy/videos/${plan.id}/content`),denied);
 await upload(plan);
 const finished=await call(ids.founder,`academy/videos/${plan.id}/finish`,'POST',{expectedRevision:plan.courseRevision});assert.equal((await finished.json()).status,'ready');
 c=await admin('publish',await read(c));await admin('enroll',c,{member_id:ids.artist,course_version:c.version,mandatory:true});
 const assigned=await rpc(ids.artist,'nam_academy_course',{w:ids.w,c_id:c.id});assert.equal(assigned.videos.length,1);assert.equal(assigned.videos[0].id,plan.id);assert.equal(assigned.videos[0].lesson_id,assigned.lessons[0].id);assert.equal(assigned.videos[0].has_captions,true);
 let response=await call(ids.artist,`academy/videos/${plan.id}/content`,'GET',undefined,{Range:'bytes=0-31'});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes 0-31/${bytes.length}`);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(0,32));
 response=await call(ids.artist,`academy/videos/${plan.id}/content`,'GET',undefined,{Range:'bytes=-16'});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(-16));
 response=await call(ids.artist,`academy/videos/${plan.id}/content`,'GET',undefined,{Range:'bytes=999999-'});assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),`bytes */${bytes.length}`);
 response=await call(ids.artist,`academy/videos/${plan.id}/captions`);assert.equal(await response.text(),captions);assert.match(response.headers.get('content-type'),/text\/vtt/);
 await rpc(ids.artist,'nam_academy_progress',{w:ids.w,l_id:assigned.lessons[0].id,mark_complete:true});
 c=await read(c);const replacement=await reserve(c,'video-replacement-0001','Revised light study');await upload(replacement);await call(ids.founder,`academy/videos/${replacement.id}/finish`,'POST',{expectedRevision:replacement.courseRevision});c=await admin('publish',await read(c));
 assert.equal((await rpc(ids.artist,'nam_academy_course',{w:ids.w,c_id:c.id})).videos[0].id,plan.id);
 await assert.rejects(call(ids.artist,`academy/videos/${replacement.id}/content`),denied);
 assert.equal((await call(ids.artist,`academy/videos/${plan.id}/content`)).status,200);
 await admin('enroll',c,{member_id:ids.artist,course_version:c.version,mandatory:true});
 const latest=await rpc(ids.artist,'nam_academy_course',{w:ids.w,c_id:c.id});assert.equal(latest.videos[0].id,replacement.id);assert.equal(latest.completed,0);
 await assert.rejects(call(ids.artist,`academy/videos/${plan.id}/content`),denied);
 assert.equal((await call(ids.artist,`academy/videos/${replacement.id}/content`)).status,200);
 assert.equal((await serial(db,()=>db.query('select count(*)::integer n from nam_course_completions where user_id=$1 and course_id=$2',[ids.artist,c.id]))).rows[0].n,1);
 // A working-copy removal retains published playback until enrollment changes.
 await call(ids.founder,`academy/videos/${replacement.id}/unlink`,'POST',{expectedRevision:(await read(c)).revision});
 assert.equal((await read(c)).videos.length,0);assert.equal((await call(ids.artist,`academy/videos/${replacement.id}/content`)).status,200);
 await admin('revoke',await read(c),{member_id:ids.artist});await assert.rejects(call(ids.artist,`academy/videos/${replacement.id}/content`),denied);
 assert.equal(storage.objects.size,2);
});

test('bad bytes, unsupported files and absent trusted configuration never create a ready video',async()=>{
 let c=await course();
 await assert.rejects(call(ids.founder,'academy/videos','POST',{course_id:c.id,lesson_id:c.lessons[0].id,expectedRevision:c.revision,title:'Unconfigured',file_name:'file.mp4',mime:'video/mp4',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},{'Idempotency-Key':'no-service-binding-01'},{}),e=>e.status===503&&e.code==='CONFIGURATION_REQUIRED');
 assert.equal((await read(c)).videos.length,0);
 const plan=await reserve(c,'malformed-video-0001');await upload(plan,Buffer.alloc(bytes.length,60));
 await assert.rejects(call(ids.founder,`academy/videos/${plan.id}/finish`,'POST',{expectedRevision:plan.courseRevision}),e=>e.status===400);
 c=await read(c);assert.equal(c.videos[0].status,'pending');
 await assert.rejects(call(ids.sales,'academy/videos','POST',{}),e=>e.status===403);
 await assert.rejects(rpc(ids.founder,'nam_attest_academy_video',{w:ids.w,vid:plan.id,expected_revision:c.revision,verified_actor:ids.founder,verified_session:ids.founder,verified_aal2:false,content_sha256:'a'.repeat(64)}),e=>e.code==='42501');
 const bucket=(await db.query("select public,file_size_limit from storage.buckets where id='nam-academy-videos'")).rows[0];assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),MAX_VIDEO_BYTES);
});

test('video attestation rechecks original sessions and optional MFA; ready object bytes cannot be replaced',async()=>{
 const c=await course(),plan=await reserve(c,'video-live-access-0001');await upload(plan);
 const asset=(await db.query('select * from nam_academy_videos where id=$1',[plan.id])).rows[0];
 const proof={w:ids.w,vid:plan.id,expected_revision:plan.courseRevision,verified_actor:ids.founder,verified_session:ids.founder,verified_aal2:false,content_sha256:createHash('sha256').update(bytes).digest('hex')};
 await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$1,'verified')",[ids.founder]);
 try{await assert.rejects(rpc(null,'nam_attest_academy_video',proof,{role:'service_role'}),e=>e.code==='42501');}finally{await db.query('delete from auth.mfa_factors where user_id=$1',[ids.founder]);}
 await assert.rejects(rpc(null,'nam_attest_academy_video',{...proof,verified_session:ids.sales},{role:'service_role'}),e=>e.code==='42501');
 await db.query('delete from auth.sessions where id=$1',[ids.founder]);
 try{await assert.rejects(rpc(null,'nam_attest_academy_video',proof,{role:'service_role'}),e=>e.code==='42501');}finally{await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[ids.founder]);}
 await call(ids.founder,`academy/videos/${plan.id}/finish`,'POST',{expectedRevision:plan.courseRevision});
 const update=await asUser(db,ids.founder,()=>db.query("update storage.objects set metadata='{}' where name=$1 returning id",[asset.storage_path]),{aal:'aal1'});assert.equal(update.rows.length,0);
 await assert.rejects(storage.put(ids.founder,asset.storage_path,Buffer.from('replacement'),'video/mp4'),e=>e.code==='23505');
 await assert.rejects(asUser(db,ids.founder,()=>db.query("update nam_academy_videos set status='ready' where id=$1",[plan.id]),{aal:'aal1'}),e=>e.code==='42501');
});
