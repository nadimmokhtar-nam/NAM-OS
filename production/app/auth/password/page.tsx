import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {supabaseServer} from '@/lib/supabase/server';
import {requireSecret,validCsrf} from '@/lib/api/security-helpers';
import PasswordForm from './password-form';
export const dynamic='force-dynamic';
export default async function PasswordSetup(){const supabase=await supabaseServer(),{data:{user},error}=await supabase.auth.getUser();if(error||!user)redirect('/login');const proof=(await cookies()).get('nam_password_setup')?.value,secret=requireSecret(process.env.NAM_CSRF_SECRET);if(!['invite','recovery'].some(kind=>validCsrf(proof,user.id,`password:${kind}`,secret)))redirect('/auth/link-error');return <main id="main" className="auth-shell"><section className="auth-panel"><img src="/nam-logo.png" alt="NAM" width={96}/><h1>Choose your password.</h1><p>Use a unique passphrase of at least 12 characters.</p><PasswordForm/></section></main>;}
