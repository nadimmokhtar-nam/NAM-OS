import Link from 'next/link';
import {AuthFrame} from '../../auth-frame';
export default function LinkError(){return <AuthFrame title="This link could not be used."><p role="alert" className="form-error">It may be expired, revoked, already used or intended for another account.</p><p className="auth-help">Ask your NAM workspace administrator for a new private link. Your account permissions were not changed by an unsuccessful request.</p><Link className="button primary auth-submit" href="/login">Return to sign in</Link></AuthFrame>;}
