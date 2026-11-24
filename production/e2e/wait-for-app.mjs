const target='http://127.0.0.1:3000/login';
const deadline=Date.now()+90000;
let ready=false;
while(Date.now()<deadline){try{const response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(2500)});if(response.status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}
if(!ready){process.stderr.write('The isolated Next.js login page did not become ready. Private server output was not published.\n');process.exitCode=1;}
else process.stdout.write('Isolated Next.js application is ready.\n');
