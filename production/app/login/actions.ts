'use server';
import {redirect} from 'next/navigation';
import {supabaseServer} from '@/lib/supabase/server';
export async function signIn(data:FormData){
  const email=String(data.get('email')||'').trim(),password=String(data.get('password')||'');
  if(!email||!password||email.length>254||password.length>256)redirect('/login?error=invalid');
  const supabase=await supabaseServer();
  const {error}=await supabase.auth.signInWithPassword({email,password});
  if(error)redirect('/login?error=invalid');
  redirect('/workspace');
}
export async function signOut(){const supabase=await supabaseServer();await supabase.auth.signOut({scope:'local'});redirect('/login');}
