import type {APIContext} from './context';
import {taskPage,taskStats,notifications} from './tasks';
import {listCourses} from './academy';

const roles:Record<string,string>={founder:'Founder',sales_manager:'Sales Manager',sales:'Sales Representative',production_manager:'Production Manager',artist:'CGI Artist',freelancer:'Freelancer'};
export function sectionsFor(role:string){if(role==='founder')return ['sales','academy','projects','library','team','operations'];if(['sales','sales_manager'].includes(role))return ['sales','academy','operations'];if(['production_manager','artist','freelancer'].includes(role))return ['projects','academy','library','operations'];return [];}
export async function bootstrap(context:APIContext){
 const gated=context.mfa.required&&!context.mfa.verified;
 const [page,stats,inbox,courses]=gated?[{items:[]},{total:0,open:0,dueToday:0,overdue:0},[],[]]:await Promise.all([taskPage(context,{page:1,pageSize:100}),taskStats(context),notifications(context),listCourses(context)]);
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),part=(name:string)=>parts.find(p=>p.type===name)?.value;
 const date=`${part('year')}-${part('month')}-${part('day')}`;
 return {actor:context.actor,members:gated?[context.actor]:context.members,sections:gated?[]:sectionsFor(context.actor.role),tasks:page.items,taskStats:stats,courses,notifications:inbox,today:date,csrf:context.csrf,mode:'authenticated',account:{email:context.user.email||null},securityRequired:gated,security:null,roleLabels:roles,capabilities:{productionAuth:true,database:'postgresql',attio:false,projects:'tasks_only',library:'tasks_only',desktopPackaging:false}};
}
