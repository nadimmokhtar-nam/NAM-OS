import {createHash} from 'node:crypto';

export const MAX_VIDEO_BYTES=50*1024*1024;
export class VideoValidationError extends Error {
 status:number;
 constructor(message:string,status=400){super(message);this.name='VideoValidationError';this.status=status;}
}
function check(value:unknown,message:string,status=400):asserts value{if(!value)throw new VideoValidationError(message,status);}

/** Container validation, not transcoding, codec certification or malware scanning. */
export function validateVideo(bytes:Buffer,mime:string){
 check(bytes.length>0&&bytes.length<=MAX_VIDEO_BYTES,'Choose a video of at most 50 MiB.',413);
 if(mime==='video/mp4'){
  let offset=0,boxes=0,ftyp=false,moov=false,mdat=false;
  while(offset+8<=bytes.length){
   let size=bytes.readUInt32BE(offset),header=8;const type=bytes.toString('ascii',offset+4,offset+8);
   if(size===1){check(offset+16<=bytes.length,'The MP4 box header is incomplete.');const extended=bytes.readBigUInt64BE(offset+8);check(extended<=BigInt(bytes.length),'The MP4 box size is invalid.');size=Number(extended);header=16;}
   else if(size===0)size=bytes.length-offset;
   check(size>=header&&offset+size<=bytes.length&&++boxes<=10000,'The MP4 container is incomplete or invalid.');
   if(boxes===1){check(type==='ftyp'&&size>=16,'Choose a complete MP4 video.');const brand=bytes.toString('ascii',offset+header,offset+header+4);check(/^(?:isom|iso[2-9]|avc1|mp4[12]|M4V |dash)$/.test(brand),'This MP4 file uses an unsupported container brand.');ftyp=true;}
   if(type==='moov')moov=size>header+8&&bytes.subarray(offset+header,offset+size).includes(Buffer.from('vide'));
   if(type==='mdat')mdat=size>header;
   offset+=size;
  }
  check(offset===bytes.length&&ftyp&&moov&&mdat,'The MP4 is missing complete video metadata or media bytes.');
 }else if(mime==='video/webm'){
  check(bytes.length>=32&&bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])),'The file does not contain a WebM header.');
  check(bytes.subarray(0,4096).includes(Buffer.from('webm'))&&bytes.includes(Buffer.from([0x18,0x53,0x80,0x67]))&&bytes.includes(Buffer.from([0x16,0x54,0xae,0x6b])),'The WebM container is incomplete.');
 }else throw new VideoValidationError('Choose an MP4 or WebM video.');
 return createHash('sha256').update(bytes).digest('hex');
}

export function videoRange(value:string|null,size:number){
 check(Number.isSafeInteger(size)&&size>0&&size<=MAX_VIDEO_BYTES,'Video size is invalid.',503);
 if(!value)return {start:0,end:size-1,length:size,partial:false};
 const match=/^bytes=(\d{0,12})-(\d{0,12})$/.exec(value.trim());
 check(match&&(match[1]||match[2]),'Only one valid byte range is supported.',416);
 let start:number,end:number;
 if(!match[1]){const suffix=Number(match[2]);check(suffix>0,'The video byte range is invalid.',416);start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;}
 check(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start,'The video byte range is outside this file.',416);
 return {start,end,length:end-start+1,partial:true};
}
