# ToolSeer V3

Free, private PDF tools that run **entirely in your browser** — and a Windows desktop companion
for jobs too large for a browser tab. No upload, no account, no watermark, no server.

- **Domain:** [toolseer.com](https://toolseer.com)
- **Status:** Phase 1 — ten tools on the web, desktop app scaffolded (build requires Rust on the
  building machine)
- **Architecture:** static site, no bundler, no build step, engines self-hosted and pinned

---

## The ten Phase-1 tools

| Route | Tool |
|---|---|
| `/image-to-pdf` | Convert images to PDF (drag to reorder, page size, margins, quality) |
| `/merge-pdf` | Merge several PDFs into one, with per-file bookmarks |
| `/compress-pdf` | Compress a PDF — lossless rebuild, plus image downsampling levels |
| `/split-pdf` | Split by page, by custom ranges, or every N pages |
| `/protect-pdf` | Encrypt with a password and set reader permissions |
| `/unlock-pdf` | Remove a password you already know |
| `/pdf-to-images` | Export pages as PNG/JPEG at chosen DPI, zipped |
| `/organize-pdf` | Visually reorder, rotate and delete pages |
| `/extract-text-pdf` | Extract the text layer (OCR arrives in a later phase) |
| `/desktop` | The Windows app: same tools, no memory ceiling |

## Repository layout

```
apps/web/            ← the deployable site (Cloudflare Pages root — no build command)
  assets/css/        design system (one stylesheet, light/dark, RTL-ready)
  assets/js/ui/      shell, toolkit, i18n (EN+AR), icons
  assets/js/core/    the PDF engine (pdf-lib · pdf.js · qpdf-wasm · jszip)
  assets/img/        mascot SVG system, icons, OG image
  vendor/            self-hosted engines, checksummed by vendor.lock.json
  <slug>/index.html  one folder per tool page (programmatic SEO)
apps/desktop/        Tauri v2 scaffold + qpdf/PDFium engine layer (see docs/DESKTOP.md)
docs/                ARCHITECTURE (frozen contracts), REPO-STUDY, DESKTOP, MASCOT,
                     TOOL-PAGE-GUIDE, SEO
tools/               vendor · serve · check · e2e · make-icons (all zero-dependency node)
tests/               engine test suite (Node, no browser needed)
```

## Commands (all plain `node` — this repo intentionally has no npm dependency)

```powershell
node tools/preflight.mjs          # ONE command: is this tree deployable? (run before pushing)
node tools/vendor.mjs install      # download + checksum the pinned engines
node tools/check.mjs               # integrity gate: routes, SEO, JSON-LD, i18n, assets, inline modules
node tools/e2e.mjs --shot          # headless-Chrome E2E: every route, theme, RTL, errors
node tools/e2e.mjs --convert image-to-pdf   # run a real in-browser conversion
node tools/check-live.mjs --base https://www.toolseer.com   # continuity check against a deployment
node tools/serve.mjs 4173          # local preview → http://127.0.0.1:4173/
node tests/run.mjs                 # engine + UI tests
node tools/render-icons.mjs        # regenerate the icon family from the brand mark
node tools/wire-pwa.mjs            # (re-)apply the manifest link and install-prompt capture to pages
```

## Going live

The old site has an audience (~70,000 page views, most arriving by bookmark rather than by search).
The cutover — new site on the main domain, the original page preserved on a subdomain, a bar at the
top linking to it — is written up step by step in [`docs/MIGRATION.md`](docs/MIGRATION.md), including
the two decisions that will bite if they are skipped (which host is canonical, and `noindex` on the
preserved copy). `tools/check-live.mjs` verifies the whole continuity contract against a real origin.

## Why this architecture

The build environment cannot run `npm`, `pnpm`, `git` or pipe-based bundlers, and the product
contract demands zero server costs and instant load. A no-bundler static site is the natural fit:
the files in `apps/web` **are** the deployable artifact. Engines are pinned versions downloaded by
`tools/vendor.mjs` and checked against `apps/web/vendor/vendor.lock.json`. Read
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the frozen contracts and the reasoning.

## Privacy

Files are read, processed and downloaded on the user's own device. There is no upload step in the
code, no analytics, no cookies. See [`/privacy`](apps/web/privacy/index.html).

## The desktop app

The original directive named Stirling-PDF as the desktop engine. Reading its licence files revealed
a blocker: current versions are under a paid licence that forbids redistribution. The scaffold in
`apps/desktop` therefore builds on permissive engines (qpdf, PDFium). The decision record and the
three options open to the owner are in [`docs/DESKTOP.md`](docs/DESKTOP.md).

## License

The ToolSeer site code is the owner's. Third-party engines and their licences are pinned in
`apps/web/vendor/vendor.lock.json` and their licence texts ship beside each binary.
