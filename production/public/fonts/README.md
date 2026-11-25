# NAM OS typography

NAM uses **Newsreader** for editorial headings and **Inter** for navigation,
tables, task editing, forms and authentication. The user authorized a different
display font on 25 November 2026. Programa's measured sizes, weights, line heights
and spacing remain the reference; this is a deliberate typeface adaptation.

Both families are self-hosted. No font request goes to Google, Fontsource or
Programa at runtime. The associated copyright notices and OFL licences are
included alongside the binaries.

## Newsreader

Designed by Production Type for screen reading:
https://github.com/productiontype/Newsreader

Unmodified Fontsource Variable 5.3.0 distributions, normal style, weight 200–800,
optical-size axis 6–72. CSS uses automatic optical sizing, with 400 for display
headings. Latin and Latin Extended cover the application's English/French text.
The other weights are available in the same variable files; italic is not bundled.

Source: https://github.com/fontsource/font-files/tree/main/fonts/variable/newsreader

| Local file | Source Git blob SHA-1 | Bytes |
| --- | --- | ---: |
| `newsreader-latin-opsz-normal.woff2` | `c6e5b0ec6ec3903d31ad2864b08108845dec4182` | 132000 |
| `newsreader-latin-ext-opsz-normal.woff2` | `a40ea8c10356edaf4d93e56638080cddee1dae73` | 86608 |
| `LICENSE-Newsreader.txt` | `03ad13c32004b5c7c097e404810b0fdf7410d283` | 4520 |

The files were fetched from `fonts/variable/newsreader/files/` and verified
against those blob hashes. The WOFF2 signature and declared length were checked
before inclusion. `--font-display` in `app/design-tokens.css` is the single
application-wide selection; `app/styles.css` declares the local font faces.

## Inter

Existing Inter Variable 5.2.8 assets and `LICENSE-Inter.txt` are retained.
