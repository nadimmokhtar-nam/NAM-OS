'use client';
import {useEffect,useState,type FormEvent} from 'react';
type Security={csrf:string;factors:Array<{id:string;status:string;factor_type:string}>;mfaRequired:boolean;mfaVerified:boolean};
export default function MfaForm({next}:{next:string}){const [security,setSecurity]=useState<Security|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
  async function load(){const response=await fetch('/api/auth/security',{credentials:'same-origin',cache:'no-store'}),body=await response.json();if(!response.ok)throw new Error(body.error||'Authenticator status could not load.');if(!body.mfaRequired||body.mfaVerified){location.assign(next);return;}setSecurity(body);}
  useEffect(()=>{load().catch(error=>setError(error.message));},[]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(pending||!security)return;setPending(true);setError('');const form=event.currentTarget,values=new FormData(form),factor=security.factors.find(f=>f.status==='verified'&&f.factor_type==='totp');try{if(!factor)throw new Error('No supported authenticator is available. Contact the workspace owner for account recovery.');const response=await fetch('/api/auth/mfa/verify',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':security.csrf},body:JSON.stringify({challenge_token:factor.id,code:String(values.get('code')||'')})}),body=await response.json();if(!response.ok)throw new Error(body.error||'Authenticator verification failed.');form.reset();location.assign(next);}catch(e){setError(e instanceof Error?e.message:'Authenticator verification failed.');}finally{setPending(false);}}
  if(!security&&!error)return <p className="auth-intro" role="status">Checking your authenticator…</p>;
  return <>
    <p role="alert" className="form-error">{error}</p>
    {!security?<button type="button" className="button primary auth-submit" onClick={()=>load().catch(error=>setError(error.message))}>Try again</button>:<form className="auth-form-fields" onSubmit={submit} aria-busy={pending}>
      <div className="field"><label htmlFor="mfa-code">Six-digit authenticator code</label><input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required/></div>
      <button className="button primary auth-submit" type="submit" disabled={pending}>{pending?'Verifying…':'Verify authenticator'}</button>
    </form>}
    <p className="auth-help"><a className="auth-help-link" href="/login">Return to sign in</a></p>
  </>;
}
