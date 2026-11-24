# NAM OS

NAM Studio operating workspace. Application source lives in **production/**. Use **production** as the Vercel Root Directory.

This is an active development checkpoint, not a production launch. Hosted Supabase, real integrations, desktop installation and the four full QA cycles remain release gates.

See production/README.md and production/docs/QA_CHECKPOINT.md for implementation and verification.

```sh
cd production
npm ci
npm test
npm run build
```
