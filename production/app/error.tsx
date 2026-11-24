'use client';
export default function ErrorState({reset}:{reset:()=>void}){return <main id="main"><h1>The workspace could not open.</h1><p role="alert">Please retry. If the problem continues, contact the workspace owner.</p><button onClick={reset}>Try again</button></main>;}
