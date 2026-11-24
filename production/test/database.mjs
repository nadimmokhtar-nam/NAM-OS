import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';

// Real PostgreSQL execution in WASM. Only Supabase-managed auth/storage schemas
// are represented here; hosted GoTrue, PostgREST and Storage HTTP are separate
// staging tests. No local SQL success is represented as a hosted-provider pass.
export const ids={w:'10000000-0000-4000-8000-000000000001',otherW:'10000000-0000-4000-8000-000000000002',founder:'20000000-0000-4000-8000-000000000001',sales:'20000000-0000-4000-8000-000000000002',artist:'20000000-0000-4000-8000-000000000003',outsider:'20000000-0000-4000-8000-000000000004',suspended:'20000000-0000-4000-8000-000000000005'};
export async function database({beforeMigration}={}){
 const db=await PGlite.create();
 await db.exec(`
 CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth; CREATE SCHEMA storage;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz);
 CREATE TABLE auth.mfa_factors(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),status text NOT NULL);
 CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz);
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(auth.jwt()->>'role',current_user::text) $$;
 GRANT USAGE ON SCHEMA auth,storage,public TO anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt(),auth.role() TO anon,authenticated,service_role;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(bucket_id,name));
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT SELECT ON storage.buckets TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
 CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
 `);
 const directory=new URL('../supabase/migrations/',import.meta.url),files=(await readdir(directory)).filter(x=>x.endsWith('.sql')).sort();
 for(const file of files){try{await beforeMigration?.(file,db);await db.exec(await readFile(new URL(file,directory),'utf8'));}catch(error){await db.close();throw new Error(`Migration ${file}: ${error.message}`,{cause:error});}}
 await db.query('INSERT INTO public.nam_workspaces(id,name) VALUES($1,$2),($3,$4)',[ids.w,'Policy test workspace',ids.otherW,'Other workspace']);
 for(const [key,name,role,w,active] of [['founder','Founder','founder',ids.w,true],['sales','Sales','sales',ids.w,true],['artist','Artist','freelancer',ids.w,true],['outsider','Other','sales',ids.otherW,true],['suspended','Suspended','sales',ids.w,false]]){
  await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[ids[key],`${key}@policy-test.invalid`]);
  await db.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$1)',[ids[key]]);
  await db.query('INSERT INTO public.nam_memberships(workspace_id,user_id,name,role,active) VALUES($1,$2,$3,$4,$5)',[w,ids[key],name,role,active]);
  await grantFixtureAccess(db,w,ids[key]);
 }
 return db;
}
export async function asUser(db,user,run,{aal='aal2',role='authenticated',sessionId=user}={}){
 await db.exec('BEGIN');
 try{await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role,aal,...(sessionId?{session_id:sessionId}:{})})]);await db.exec(`SET LOCAL ROLE ${role==='service_role'?'service_role':role==='anon'?'anon':'authenticated'}`);const result=await run();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}
}

// Synthetic fixtures deliberately provision their intended baseline. New real
// memberships receive no grants unless a trusted invitation/admin flow sets them.
export async function grantFixtureAccess(db,workspace,user){
 const exists=(await db.query("select to_regclass('public.nam_section_grants') is not null as present")).rows[0].present;
 if(!exists)return;
 await db.query("insert into public.nam_section_grants(workspace_id,user_id,section,can_create) select m.workspace_id,m.user_id,s.section,true from public.nam_memberships m cross join lateral unnest(public.nam_template_sections(m.role)) s(section) where m.workspace_id=$1 and m.user_id=$2 and m.role<>'founder' on conflict do nothing",[workspace,user]);
}
