import {headers} from 'next/headers';
import type {Metadata} from 'next';
import {ReviewClient} from './review-client';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Project review — NAM Studio',robots:{index:false,follow:false}};
export default async function Review(){const nonce=(await headers()).get('x-nonce')||undefined;return <ReviewClient nonce={nonce}/>;}
