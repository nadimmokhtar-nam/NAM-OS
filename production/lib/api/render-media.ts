import 'server-only';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {ApiError} from './context';

export const MAX_RENDER_BYTES=50*1024*1024;
export const MAX_RENDER_PIXELS=64000000;
export const renderHash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

// Decode the actual stored file, including its pixels. A filename, claimed MIME
// type or image header is not sufficient evidence of a usable review image.
export async function prepareRender(bytes:Buffer,mime:string){
 if(!bytes.length||bytes.length>MAX_RENDER_BYTES)throw new ApiError(413,'Choose a render of at most 50 MiB.','RENDER_SIZE');
 const format=mime==='image/jpeg'?'jpeg':mime==='image/png'?'png':null;
 if(!format)throw new ApiError(400,'Choose a JPEG or PNG render.','RENDER_FORMAT');
 try{
  const image=sharp(bytes,{limitInputPixels:MAX_RENDER_PIXELS,failOn:'warning',sequentialRead:true});
  const metadata=await image.metadata();
  if(metadata.format!==format||(metadata.pages||1)!==1||!metadata.width||!metadata.height||metadata.width>16384||metadata.height>16384||metadata.width*metadata.height>MAX_RENDER_PIXELS)throw Error('Invalid image');
  // stats consumes the complete image before the downsampled outputs are made.
  // Preview derivatives are oriented and stripped of source metadata. Original
  // bytes, colour profile and fingerprint remain unchanged for final download.
  await image.clone().stats();
  const preview=await image.clone().autoOrient().resize({width:1920,height:1920,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer({resolveWithObject:true});
  const thumbnail=await image.clone().autoOrient().resize({width:320,height:240,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer();
  const oriented=metadata.orientation&&[5,6,7,8].includes(metadata.orientation);
  return {sha256:renderHash(bytes),width:oriented?metadata.height:metadata.width,height:oriented?metadata.width:metadata.height,preview:preview.data,thumbnail};
 }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'The stored file could not be decoded as a complete JPEG or PNG render.','RENDER_FORMAT');}
}
