// Task identity belongs to the URL; records and authorization stay in the API.
export function parseWorkspaceRoute(hash=''){
 const raw=String(hash).replace(/^#/,''),split=raw.indexOf('?');
 const path=(split<0?raw:raw.slice(0,split))||'overview';
 const query=new URLSearchParams(split<0?'':raw.slice(split+1));
 const taskId=query.get('task')||'';query.delete('task');
 const parts=path.split('/'),suffix=query.toString();
 return {view:parts[0],recordId:parts[1]||'',projectView:['work','images'].includes(parts[2])?parts[2]:'overview',taskId,parentHash:'#'+path+(suffix?'?'+suffix:'')};
}

export function taskPageHash(hash,id){
 const route=parseWorkspaceRoute(hash),split=route.parentHash.indexOf('?');
 const path=split<0?route.parentHash:route.parentHash.slice(0,split);
 const query=new URLSearchParams(split<0?'':route.parentHash.slice(split+1));
 query.set('task',String(id));return path+'?'+query.toString();
}
