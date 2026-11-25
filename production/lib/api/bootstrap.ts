import type {APIContext} from './context';
import {taskStats,notifications} from './tasks';
import {listCourses} from './academy';
import {effectiveAccess} from './access';
import {dailyBrief} from './daily';
import {ApiError} from './context';

const roles:Record<string,string>={founder:'Founder',sales_manager:'Sales Manager',sales:'Sales Representative',production_manager:'Production Manager',artist:'CGI Artist',freelancer:'Freelancer'};
export async function bootstrap(context:APIContext,briefScope?:string,view='overview'){
 if(!['overview','tasks','sales','projects','academy','library','team','operations','settings'].includes(view))throw new ApiError(400,'Choose a valid workspace.');
 if(briefScope&&!['mine','studio'].includes(briefScope))throw new ApiError(400,'Choose a valid daily view.');
 if(briefScope==='studio'&&context.actor.role!=='founder')throw new ApiError(403,'Founder access is required for the studio view.');
 const gated=context.mfa.required&&!context.mfa.verified;
 const access=gated?{sections:[],create_sections:[],revision:null,member_sections:{} as Record<string,string[]>}:await effectiveAccess(context);
 // The selected workspace fetches its task page; the brief has its own bounded lists.
 const [stats,inbox,courses,brief]=gated?[{total:0,open:0,dueToday:0,overdue:0},[],[],null]:await Promise.all([taskStats(context),notifications(context),access.sections.includes('academy')&&['overview','academy'].includes(view)?listCourses(context):Promise.resolve([]),view==='overview'?dailyBrief(context,briefScope):Promise.resolve(null)]);
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),part=(name:string)=>parts.find(p=>p.type===name)?.value;
 const date=`${part('year')}-${part('month')}-${part('day')}`;
 return {actor:context.actor,members:(gated?[context.actor]:context.members).map(member=>({...member,sections:access.member_sections[member.id]||[]})),sections:access.sections,tasks:[],taskStats:stats,brief,courses,notifications:inbox,today:date,csrf:context.csrf,mode:'authenticated',account:{email:context.user.email||null},securityRequired:gated,security:null,roleLabels:roles,accessRevision:access.revision,capabilities:{createTaskSections:access.create_sections,productionAuth:true,database:'postgresql',attio:false,projects:'records',deliverables:'records',renders:'versions',clientReviews:'records',projectPlanning:'records',projectDelivery:'records',projectMilestones:'records',projectResources:'records',taskScheduling:'records',taskCalendar:'records',learningPaths:'records',teamProfiles:'records',salesWorkspace:'records',library:'tasks_only',desktopPackaging:false}};
}
