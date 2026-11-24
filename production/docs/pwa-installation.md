# NAM OS desktop installation

NAM OS is an online-only installable web app. Its manifest supplies a standalone window, a stable application identity and the original NAM logo. Installing the app does not grant access: sign-in, MFA and workspace permissions remain in force.

## Install on Mac or Windows

1. Open the deployed HTTPS NAM OS address in an up-to-date Chrome or Edge browser. Localhost can be used for development checks.
2. Select **Install NAM OS**. If the browser offers a native install prompt, approve it there. If the page shows instructions instead, use the browser's address-bar install icon or its menu option to install the current page as an app.
3. Open NAM OS from your applications or Start menu. It should open its own window at the protected workspace URL. Sign in when required.

Installation always requires browser-controlled user consent. The page does not claim installation succeeded until the browser reports it. Some browsers, profiles, policies or operating systems may not offer installation; the normal website remains usable.

## Connectivity and privacy

This release deliberately registers no service worker. Current Chromium desktop installation does not require a service worker. No application response cache, offline record store or background mutation queue is introduced by the PWA feature. The manifest and icons contain no studio records. Authenticated responses retain the application's server-side cache policy.

A connection is required to open the app and save work. An already-open window reports an offline connection and explains that changes are not queued. A cold launch while offline may show the browser's own offline page. Unsaved forms are not guaranteed to survive closing or reloading a window. This is not offline editing support.

## Updates

The app checks a public, credential-free deployment identity when visible and every 15 minutes while visible and online. Requests bypass the browser's response cache. A different deployment offers **Reload for update**. Reload requires explicit confirmation so an update cannot silently discard a form.

`npm run build` and `npm run dev` run `scripts/pwa-release.mjs` through their lifecycle hooks. It hashes the runtime source, public assets, package inputs and migrations, normalising its generated constant and excluding its generated JSON to prevent recursive changes. It writes matching client/public identities. A direct invocation of `next build` must run that generator first. Do not manually edit one generated identity without the other.

## Verification status

Automated checks cover manifest launch/scope/icons, actual PNG dimensions, deployment identity validation, public network-only update requests, cancellation on teardown, hidden/offline polling suppression, browser-controlled install prompting, the fallback instructions, explicit update confirmation and offline messaging. They execute component policy/effects with a bounded hook/event harness; they are not native browser install tests.

Before release, retain evidence from Chrome and Edge on Mac and Windows: inspect manifest errors and icons; install, close and relaunch the app; verify standalone display; sign in/out; check an expired session; open offline and restore connectivity; confirm authenticated responses are not stored in Cache Storage; publish another deployment and verify the update prompt preserves unsaved work until the user chooses to reload. No completed operating-system installation is claimed by the automated checks.

## Primary references

- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [Chrome: Installing web applications](https://developer.chrome.com/docs/modern-web-guidance/guides/pwa/install-web-app)
