export class IntegrationError extends Error {code:string;retryAt:string|null;constructor(code:string,message:string,options?:{retryAt?:string|null});}
export function retryTime(value:string|null,now?:Date):string;
