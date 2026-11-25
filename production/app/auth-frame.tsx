import type {ReactNode} from 'react';

/** NAM imagery is not yet selected. The rail uses the original identity only;
 * no borrowed reference photography or invented studio work is displayed. */
export function AuthFrame({title,intro,children,footer}:{title?:string;intro?:ReactNode;children:ReactNode;footer?:ReactNode}){
  return <main id="main" className="auth-shell" tabIndex={-1}>
    <aside className="auth-rail" aria-label="NAM Studio">
      <img className="auth-rail-logo" src="/nam-logo.png" alt="NAM" width={96} height={29}/>
      <div className="auth-rail-copy"><span>NAM OS</span><p>Private studio workspace.</p></div>
    </aside>
    <div className="auth-content"><section className="auth-form" aria-labelledby={title?'auth-page-title':undefined} aria-label={title?undefined:'NAM OS access'}>
      <div className="auth-mobile-brand"><img src="/nam-logo.png" alt="NAM" width={80} height={24}/></div>
      {title&&<h1 id="auth-page-title" className="auth-title">{title}</h1>}
      {intro&&<p className="auth-intro">{intro}</p>}
      {children}
      {footer&&<div className="auth-help">{footer}</div>}
    </section></div>
  </main>;
}
