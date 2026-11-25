import {createServerClient} from '@supabase/ssr';
import {NextResponse,type NextRequest} from 'next/server';
import {expectedOrigin} from './lib/api/security-helpers';

export async function proxy(request:NextRequest){
  const nonce=Buffer.from(crypto.randomUUID()).toString('base64');
  const development=process.env.NODE_ENV==='development';
  let providerOrigin='';
  try{const configured=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'');if(configured.protocol==='https:'||(configured.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(configured.hostname)))providerOrigin=configured.origin;}catch{}
  const csp=["default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development?" 'unsafe-eval'":''}`,`style-src 'self' ${development?"'unsafe-inline'":`'nonce-${nonce}'`}`,"img-src 'self' data: blob:","font-src 'self'",`connect-src 'self' ${providerOrigin}${development?' ws:':''}`,"object-src 'none'","base-uri 'self'","form-action 'self'","frame-ancestors 'none'",...(!development?["upgrade-insecure-requests"]:[])].join('; ');
  const next=()=>{const headers=new Headers(request.headers);headers.set('x-nonce',nonce);headers.set('Content-Security-Policy',csp);return NextResponse.next({request:{headers}});};
  const secure=(response:NextResponse)=>{response.headers.set('Content-Security-Policy',csp);response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Frame-Options','DENY');response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');response.headers.set('Cache-Control','private, no-store');if(!development&&request.nextUrl.protocol==='https:')response.headers.set('Strict-Transport-Security','max-age=31536000');return response;};
  // Public assets contain no workspace data. Keep their security headers, but
  // refresh sessions only on pages and APIs, whose handlers verify identity.
  if(!request.nextUrl.pathname.startsWith('/api/')&&/\.(?:js|mjs|css|woff2|webmanifest|json)$/.test(request.nextUrl.pathname))return secure(next());
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)return secure(next());
  let appOrigin:string;
  try{appOrigin=expectedOrigin(process.env.NAM_APP_ORIGIN||process.env.NEXT_PUBLIC_APP_URL||process.env.APP_ORIGIN,request.url);const project=new URL(url);if(project.username||project.password||project.search||project.hash||project.pathname!=='/'||!(project.protocol==='https:'||(project.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(project.hostname))))return secure(next());}catch{return secure(next());}
  let response=next();
  const supabase=createServerClient(url,key,{cookies:{
    getAll(){return request.cookies.getAll();},
    setAll(values){
      for(const {name,value} of values)request.cookies.set(name,value);
      response=next();
      for(const {name,value,options} of values)response.cookies.set(name,value,{...options,httpOnly:true,sameSite:'lax',secure:appOrigin.startsWith('https:')});
    }
  }});
  try{await supabase.auth.getClaims();}catch{/* The API reports provider/configuration errors without interrupting public sign-in. */}
  return secure(response);
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)']};
