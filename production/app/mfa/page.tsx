import {redirect} from 'next/navigation';
import {getContext,ApiError,safeNext} from '@/lib/api/context';
import MfaForm from './mfa-form';
export const dynamic='force-dynamic';
export default async function Mfa({searchParams}:{searchParams:Promise<{next?:string}>}){const params=await searchParams,next=safeNext(params.next);let context;try{context=await getContext(undefined,{allowMfaPending:true});}catch(error){if(error instanceof ApiError&&error.status===401)redirect('/login');throw error;}if(!context.mfa.required||context.mfa.verified)redirect(next);return <main id="main" className="auth-shell"><section className="auth-panel"><img src="/nam-logo.png" alt="NAM" width={96}/><h1>Verify it’s you.</h1><p>Use the authenticator enabled for your account to continue.</p><MfaForm next={next}/></section></main>;}
