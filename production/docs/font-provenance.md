# Self-hosted Inter

NAM OS uses unmodified Inter variable weight fonts from the official npm registry package `@fontsource-variable/inter@5.2.8`. The package was downloaded with npm pack and install scripts disabled. Only Latin and Latin Extended normal WOFF2 assets are served; the full package license is retained at `public/fonts/LICENSE-Inter.txt`. No third-party font request or new runtime dependency is required.

CSS names these faces Inter, uses the package's supplied Unicode ranges and weights 100–900, and preloads the Latin face. Other scripts use the documented system fallback. Final alignment checks must wait for `document.fonts.ready` in a real browser.

| Asset | SHA-256 |
| --- | --- |
| inter-latin-wght-normal.woff2 | 3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62 |
| inter-latin-ext-wght-normal.woff2 | 34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956 |

Sources: [Fontsource Inter package](https://www.npmjs.com/package/@fontsource-variable/inter), [Inter project](https://github.com/rsms/inter).
