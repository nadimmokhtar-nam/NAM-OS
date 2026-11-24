/** Generated from deployment source by scripts/pwa-release.mjs before builds. */
export const PWA_RELEASE='build-179776f15dd4250c';
export function deploymentChanged(value:unknown):boolean{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const release=(value as {release?:unknown}).release;
  return typeof release==='string'&&/^build-[a-f0-9]{16}$/.test(release)&&release!==PWA_RELEASE;
}
