const number=new Intl.NumberFormat('en-GB',{maximumFractionDigits:1});

// Keep file metadata readable at both thumbnail and production-image sizes.
export function formatFileSize(bytes){
 const value=Number(bytes);
 if(!Number.isFinite(value)||value<0)return 'Size unavailable';
 if(value<1024)return number.format(value)+' B';
 if(value<1048576)return number.format(value/1024)+' KiB';
 return number.format(value/1048576)+' MiB';
}
