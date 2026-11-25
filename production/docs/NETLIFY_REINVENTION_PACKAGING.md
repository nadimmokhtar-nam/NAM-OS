# Netlify packaging checkpoint for the reinvention branch

Verified committed source: `31a22449ea93c4ce020f5240446322227ef025df`. Product source identity: `build-179776f15dd4250c`. This supplements the completed isolated workflow tests; it does not establish a deployment.

## Executed check

The official Netlify Build **37.7.6** public API ran in offline CLI mode against a Git archive of the committed branch, with the repository's `production` base, `npm run build` command and pinned Next.js adapter **5.16.9**. Node **24.22.3** and official Deno **2.4.2** were used. Dependencies installed from the candidate's committed lockfile.

The snapshot, build output, tooling and private diagnostics stayed outside the application checkout. No account, token, site link, deployment, database mutation or paid service was used. The original app's source/build remained intact. The reproducible helper strips hosted app/integration credentials from its build child and never runs a deploy command.

The Netlify engine completed with **success=true, severityCode=0**, packaging:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| SSR function ZIP | 17,808,431 | `79bc1cadbf51d378d027d68ae1a217d7ffc142976d0947f30fd5f3c4ff0f888e` |
| Proxy Edge bundle | 2,035,455 | `ad60e7419c5b27f06dc5ab49a8a2037dbe227adf4f402c5cc8882b2d3ce061fd` |

The server manifest targets **nodejs24.x**, uses streamed invocation and retains the catch-all application route. The generated Edge manifest covers `/workspace`, `/api/bootstrap` and private-video API paths, while excluding static chunks and images. These are artifact/manifest checks, not HTTP runtime checks.

Machine-readable results: [netlify-packaging.json](evidence/reinvention/netlify-packaging.json).

## Incomplete Edge inspection

The engine's Edge configuration loader reported:

```text
Could not load configuration for edge function …
Import 'https://edge.netlify.com/bootstrap/globals/types.ts' failed.
… unsuccessful tunnel
```

The live environment's restricted network does not permit `edge.netlify.com`. The engine still produced both artifacts and a route manifest, but **Edge configuration inspection is incomplete**. The helper intentionally returns **exit 2** for this state; engine success must not be presented as a clean hosted release check. No TLS verification, type import or vendor implementation was disabled or replaced.

The required host was added to the saved environment draft, preserving existing hosts and package-manager presets. That draft is not applied/published. Once the network setting is active, rerun this exact check and require no Edge-inspection warning before accepting its configuration.

## Reproduce

From `production/`, install the isolated tooling outside the app:

```sh
npm install --prefix /workspace/.cache/nam-os/netlify-build-tools --cache /workspace/.cache/npm --no-audit --no-fund --save-exact @netlify/build@37.7.6 deno@2.4.2
node tools/verify-netlify.mjs
```

The helper builds **committed HEAD**, leaves uncommitted source untouched, creates a new private job directory and prints its proof path. Its first actual build and separate artifact inspection were executed. Exit 0 means packaging/configuration inspection passed; exit 2 means artifacts exist with the recorded inspection warning; exit 1 means the required build/artifacts/checks failed. To re-inspect an existing job without rebuilding:

```sh
node tools/verify-netlify.mjs inspect /workspace/.cache/nam-os/netlify-jobs/COMMIT-JOB
```

Only substitute the actual private job directory printed by the helper. Logs may contain provider/tool diagnostics; do not publish raw logs. Copy only the bounded proof JSON after review. Build ZIP timestamps and embedded source-path metadata can differ between runs, so the recorded hashes identify these artifacts rather than promise bit-for-bit reproducibility.

The explicit supported `repositoryRoot` option prevents Netlify's config discovery from finding the cloud workspace's outer Git metadata and resolving `production/` against `/workspace`. The ordinary NAM repository configuration did not need changing. Supported Deno lookup/cache settings avoid writing to the read-only home directory.

## Remaining delivery gates

No hosted Netlify identity, cookies, CSP/nonce handling, private video, real sales tenant or deployed latency was tested by this packaging check. Artifacts are unconfigured and must not be deployed as the real studio application. The intended secure provider context must rebuild the reviewed source.

Current missing access remains: approved network configuration; NAM-owned Netlify deployment access; the existing Supabase/workspace bindings; and a deliberately configured separate HTTPS preview origin that preserves the main trial. Follow [DEPLOYMENT.md](../DEPLOYMENT.md). No paid upgrade or modification of `main` was performed.
