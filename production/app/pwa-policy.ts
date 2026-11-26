/** Generated from deployment source by scripts/pwa-release.mjs before builds. */
export const PWA_RELEASE='build-09e3b8fadaafbba8';
export function deploymentChanged(value:unknown):boolean{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const release=(value as {release?:unknown}).release;
  return typeof release==='string'&&/^build-[a-f0-9]{16}$/.test(release)&&release!==PWA_RELEASE;
}
