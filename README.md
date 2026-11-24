# NAM OS

NAM Studio's operating workspace. The application lives in **production/**. Existing hosting is Netlify `nam-os-staging`, with `production` as its base directory.

The reinvention branch is `codex/nam-os-reinvention`; the current trial and `main` remain separate. Today connects work, real production projects, sales accountability and Academy decisions. Academy supports actual private video uploads and authenticated playback.

See [the application guide](production/README.md), [product decisions](production/docs/PRODUCT_REINVENTION.md), [current test evidence](production/docs/REINVENTION_VALIDATION.md) and [delivery instructions](production/DEPLOYMENT.md). Local results do not establish hosted acceptance or a production launch.

```sh
cd production
npm ci
npm run typecheck
npm test
npm run build
```
