import type {APIContext} from './context';
import {taskPage,taskStats,notifications} from './tasks';
import {listCourses} from './academy';
import {effectiveAccess} from './access';

const roles:Record<string,string>={founder:'Founder',sales_manager:'Sales Manager',sales:'Sales Representative',production_manager:'Production Manager',artist:'CGI Artist',freelancer:'Freelancer'};
export async function bootstrap(context:APIContext){
 const gated=context.mfa.required&&!context.mfa.verified;
 const access=gated?{sections:[],create_sections:[],revision:null,member_sections:{} as Record<string,string[]>}:await effectiveAccess(context);
 const [page,stats,inbox,courses]=gated?[{items:[]},{total:0,open:0,dueToday:0,overdue:0},[],[]]:await Promise.all([taskPage(context,{page:1,pageSize:100}),taskStats(context),notifications(context),access.sections.includes('academy')?listCourses(context):Promise.resolve([])]);
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),part=(name:string)=>parts.find(p=>p.type===name)?.value;
 const date=`${part('year')}-${part('month')}-${part('day')}`;
 return {actor:context.actor,members:(gated?[context.actor]:context.members).map(member=>({...member,sections:access.member_sections[member.id]||[]})),sections:access.sections,tasks:page.items,taskStats:stats,courses,notifications:inbox,today:date,csrf:context.csrf,mode:'authenticated',account:{email:context.user.email||null},securityRequired:gated,security:null,roleLabels:roles,accessRevision:access.revision,capabilities:{createTaskSections:access.create_sections,productionAuth:true,database:'postgresql',attio:false,projects:'tasks_only',library:'tasks_only',desktopPackaging:false}};
}
