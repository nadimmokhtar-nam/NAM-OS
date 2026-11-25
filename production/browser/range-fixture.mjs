import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {qaRoot} from './support.mjs';

// A valid MP4 free box places real H.264 media beyond the first 4 MiB range.
// Adjust actual chunk offsets so the browser must fetch a later range to play.
// This is a synthetic protocol fixture, not a bandwidth or codec benchmark.
export async function rangeFixture(){
 const bytes=Buffer.from(await readFile(new URL('./fixtures/academy-demo.mp4',import.meta.url))),padding=4*1024*1024+32768;
 let media=-1;
 function boxes(start,end){let offset=start;while(offset+8<=end){const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);if(length<8||offset+length>end)throw Error('Invalid base MP4 test fixture');if(type==='mdat')media=offset;if(['moov','trak','mdia','minf','stbl'].includes(type))boxes(offset+8,offset+length);if(type==='stco'){const count=bytes.readUInt32BE(offset+12);for(let i=0;i<count;i++){const at=offset+16+i*4;bytes.writeUInt32BE(bytes.readUInt32BE(at)+padding,at);}}offset+=length;}}
 boxes(0,bytes.length);if(media<0)throw Error('Base MP4 has no media box');
 const free=Buffer.alloc(padding);free.writeUInt32BE(padding);free.write('free',4,'ascii');
 const result=Buffer.concat([bytes.subarray(0,media),free,bytes.subarray(media)]),path=resolve(qaRoot,'academy-range-fixture.mp4');await writeFile(path,result,{mode:0o600});return {path,size:result.length,chunk:4*1024*1024};
}
