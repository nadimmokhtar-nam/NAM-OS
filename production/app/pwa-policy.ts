/** Generated from deployment source by scripts/pwa-release.mjs before builds. */
export const PWA_RELEASE='build-c8c89b2b85df510b';
export function deploymentChanged(value:unknown):boolean{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const release=(value as {release?:unknown}).release;
  return typeof release==='string'&&/^build-[a-f0-9]{16}$/.test(release)&&release!==PWA_RELEASE;
}
