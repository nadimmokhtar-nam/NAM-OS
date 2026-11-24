import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {ApiError,getContext} from '@/lib/api/context';
import {signOut} from '../login/actions';
import {WorkspaceClient} from './workspace-client';

export const dynamic='force-dynamic';

export default async function Workspace(){
  // Use the same verified identity, active membership and elected-factor policy
  // as the API. A role alone never enrolls or requires an authenticator.
  let context;
  try{context=await getContext(undefined,{allowMfaPending:true});}
  catch(error){
    if(!(error instanceof ApiError))throw error;
    if(error.status===401)redirect('/login');
    const unavailable=error.status!==403;
    return <main id="main" className="production-access-state" tabIndex={-1}>
      <img src="/assets/nam-logo.png" alt="NAM" width={68}/>
      <h1>{unavailable?'Workspace unavailable':'Your invitation is needed.'}</h1>
      <p role={unavailable?'alert':undefined}>{unavailable
        ?'Workspace access could not be checked. Please retry before opening studio records.'
        :'Your account has no active NAM Studio membership. Contact the workspace owner to arrange access.'}</p>
      <form action={signOut}><button type="submit" className="button primary">Sign out</button></form>
    </main>;
  }
  if(context.mfa.required&&!context.mfa.verified)redirect('/mfa');
  const nonce=(await headers()).get('x-nonce')||undefined;
  return <WorkspaceClient nonce={nonce}/>;
}
