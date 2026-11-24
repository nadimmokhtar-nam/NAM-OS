import {createClient} from '@supabase/supabase-js';
import {createJobsHandler} from '@/lib/jobs/handler';
import {runScheduledIntegrations} from '@/lib/integrations/service';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

// Never reuse the cookie/SSR client for privileged scheduled work. This separate
// client receives no incoming user cookies or Authorization headers.
const handle=createJobsHandler({
 env:process.env,
 createClient:(url,key,options)=>createClient(url,key,options),
 runIntegrations:({supabase,workspaceId})=>runScheduledIntegrations({supabase:supabase as ReturnType<typeof createClient>,workspaceId}),
});
export async function GET(request:Request){return handle(request);}
export async function POST(request:Request){return handle(request);}
