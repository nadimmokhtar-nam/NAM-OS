import {NextResponse} from 'next/server';
import {acceptProviderLink} from '@/lib/api/auth';
import {applicationOrigin} from '@/lib/api/context';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{const next=await acceptProviderLink(request);return NextResponse.redirect(new URL(next,applicationOrigin(request)),{headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});}
  catch{return NextResponse.redirect(new URL('/auth/link-error',applicationOrigin(request)),{headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});}
}
