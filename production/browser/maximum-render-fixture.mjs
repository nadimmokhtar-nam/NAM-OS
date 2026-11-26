import sharp from 'sharp';
import {crc32} from 'node:zlib';

export const MAXIMUM_RENDER_BYTES=50*1024*1024;

// Exercise the exact transport ceiling without making this a decoder load test.
// PNG permits private ancillary chunks; npAD has a correct CRC and sits before
// IEND, so the padding belongs to the complete image rather than trailing bytes.
export async function maximumRenderPNG(){
 const image=await sharp({create:{width:400,height:240,channels:3,background:'#ac927c'}}).png().toBuffer();
 if(image.subarray(-8,-4).toString('ascii')!=='IEND')throw Error('The render fixture must end with a complete PNG IEND chunk.');
 const length=MAXIMUM_RENDER_BYTES-image.length-12;
 if(length<0)throw Error('The base render fixture exceeds the maximum PNG size.');
 const padding=Buffer.alloc(length+12);
 padding.writeUInt32BE(length,0);padding.write('npAD',4,'ascii');
 padding.writeUInt32BE(crc32(padding.subarray(4,-4)),padding.length-4);
 return Buffer.concat([image.subarray(0,-12),padding,image.subarray(-12)],MAXIMUM_RENDER_BYTES);
}
