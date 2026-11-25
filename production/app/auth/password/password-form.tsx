'use client';
import {useState,type FormEvent} from 'react';
export default function PasswordForm(){const [pending,setPending]=useState(false),[error,setError]=useState(''),[mfa,setMfa]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(pending)return;setPending(true);setError('');const form=event.currentTarget,values=new FormData(form),password=String(values.get('password')||'');if(password!==String(values.get('confirm')||'')){setError('The passwords do not match.');setPending(false);return;}try{const response=await fetch('/api/auth',{credentials:'same-origin',cache:'no-store'}),status=await response.json();if(!response.ok)throw new Error(status.error||'Your session could not be checked.');const result=await fetch('/api/auth/reset-password',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':status.csrf||''},body:JSON.stringify({password})}),body=await result.json();if(!result.ok){if(body.code==='MFA_REQUIRED')setMfa(true);throw new Error(body.error||'The password could not be saved.');}form.reset();location.assign('/login?changed=1');}catch(e){setError(e instanceof Error?e.message:'The password could not be saved.');}finally{setPending(false);}}
  return <form className="auth-form-fields" onSubmit={submit} aria-busy={pending}>
    <div role="alert" className="form-error">{error}</div>
    <div className="field"><label htmlFor="new-password">New password</label><input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required/></div>
    <div className="field"><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={256} required/></div>
    <button className="button primary auth-submit" type="submit" disabled={pending}>{pending?'Saving…':'Save password'}</button>
    {mfa&&<p className="auth-help"><a className="auth-help-link" href="/mfa?next=%2Fauth%2Fpassword">Verify your authenticator</a></p>}
  </form>;
}
