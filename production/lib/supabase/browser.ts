'use client';
import {createBrowserClient} from '@supabase/ssr';
// Auth flows use the server API. This client is reserved for RLS-authorized
// realtime/storage features; it uses cookie storage, never custom localStorage.
export function supabaseBrowser(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(!url||!key)throw new Error('Supabase configuration is missing.');return createBrowserClient(url,key);}
