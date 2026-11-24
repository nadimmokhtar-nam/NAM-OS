import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {supabaseServer} from '@/lib/supabase/server';
import {signOut} from '../login/actions';
import {WorkspaceClient} from './workspace-client';

export const dynamic='force-dynamic';

export default async function Workspace(){
  const supabase=await supabaseServer();
  // A verified identity and active server-controlled membership are both
  // required. Roles in user-editable auth metadata never authorize this page.
  const {data,error}=await supabase.auth.getClaims();
  if(error||!data?.claims?.sub)redirect('/login');
  const {data:memberships,error:membershipError}=await supabase
    .from('nam_memberships')
    .select('workspace_id,name,role')
    .eq('user_id',data.claims.sub)
    .eq('active',true);

  if(membershipError||!memberships?.length){
    return <main id="main" className="production-access-state" tabIndex={-1}>
      <img src="/assets/nam-logo.png" alt="NAM" width={68}/>
      <h1>{membershipError?'Workspace unavailable':'Your invitation is needed.'}</h1>
      <p role={membershipError?'alert':undefined}>{membershipError
        ?'Membership could not be checked. Please retry before opening studio records.'
        :'Your account has no active NAM Studio membership. Contact the workspace owner to arrange access.'}</p>
      <form action={signOut}><button type="submit" className="button primary">Sign out</button></form>
    </main>;
  }

  if(memberships.some(member=>member.role==='founder')&&data.claims.aal!=='aal2')redirect('/mfa');

  const nonce=(await headers()).get('x-nonce')||undefined;
  return <WorkspaceClient nonce={nonce}/>;
}
