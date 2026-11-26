import {type APIContext,ApiError,json} from './context';

export async function dailyBrief(ctx:APIContext,scope=ctx.actor.role==='founder'?'studio':'mine'){
 if(!['mine','studio'].includes(scope))throw new ApiError(400,'Choose a valid daily view.');
 if(scope==='studio'&&ctx.actor.role!=='founder')throw new ApiError(403,'Founder access is required for the studio view.');
 const {data,error}=await ctx.supabase.rpc('nam_daily_brief',{w:ctx.workspaceId,scope});
 if(error)throw new ApiError(error.code==='42501'?403:503,'The daily brief could not be loaded. Please retry.','BRIEF_UNAVAILABLE');
 const names=new Map(ctx.members.map(member=>[member.id,member]));
 for(const group of ['attention','priorities','upcoming','completed'])data[group]=(data[group]||[]).map((task:Record<string,unknown>)=>({...task,owner_name:names.get(String(task.owner_id))?.name||'Studio member',can_archive:ctx.actor.role==='founder'&&(!ctx.mfa.required||ctx.mfa.verified)}));
 for(const group of ['sales','reviews'])data[group]=(data[group]||[]).map((row:Record<string,unknown>)=>({...row,owner_name:names.get(String(row.owner_id))?.name||'Studio member'}));
 return data;
}
export async function dispatchDaily(ctx:APIContext,path:string[],request:Request):Promise<Response|null>{
 if(path.length!==1||path[0]!=='brief')return null;
 if(request.method!=='GET')throw new ApiError(405,'Method not allowed.');
 return json(await dailyBrief(ctx,new URL(request.url).searchParams.get('scope')||undefined));
}
