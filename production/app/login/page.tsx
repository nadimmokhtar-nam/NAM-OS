import {headers} from 'next/headers';
import {LoginClient} from './login-client';
export const dynamic='force-dynamic';
export default async function Login(){return <LoginClient nonce={(await headers()).get('x-nonce')||undefined}/>;}
