import 'server-only';
import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {ApiError,expectedOrigin} from '@/lib/api/security-helpers';

export async function supabaseServer() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new ApiError(503,'Supabase project configuration is missing.','CONFIGURATION_REQUIRED');
  let project:URL;try{project=new URL(url);}catch{throw new ApiError(503,'Supabase project configuration is invalid.','CONFIGURATION_REQUIRED');}
  if(project.username||project.password||project.search||project.hash||project.pathname!=='/'||!(project.protocol==='https:'||(project.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(project.hostname))))throw new ApiError(503,'Supabase project configuration is invalid.','CONFIGURATION_REQUIRED');
  const configuredOrigin=process.env.NAM_APP_ORIGIN||process.env.NEXT_PUBLIC_APP_URL||process.env.APP_ORIGIN;
  if(process.env.NODE_ENV==='production'&&!configuredOrigin)throw new ApiError(503,'The application origin is not configured.','CONFIGURATION_REQUIRED');
  const secure=expectedOrigin(configuredOrigin,'http://localhost:3000').startsWith('https:');
  const jar=await cookies();
  return createServerClient(url,key,{cookies:{
    getAll(){return jar.getAll();},
    setAll(values){try{for(const {name,value,options} of values)jar.set(name,value,{...options,httpOnly:true,sameSite:'lax',secure});}catch{
      // Server Components cannot write cookies. proxy.ts refreshes them.
    }}
  }});
}
