# ToolSeer V3 — Architecture & Frozen Contracts

**Status: FROZEN.** Teammates build against this document. If something here is wrong, report it to the
Lead — do not silently diverge, because other agents are building against the same contract in parallel.

---

## 1. Why the architecture looks like this

The build environment has hard constraints that were verified by direct probing, not assumed:

| Capability | Result | Consequence |
|---|---|---|
| `node` v24 + network | works | we can vendor libraries programmatically |
| `npm` / `pnpm` / `npx` / `git` | denied by sandbox | no package manager, no `git clone` |
| `spawn()` with piped stdio | EPERM | **no Vite, no esbuild, no webpack, no bundlers** |
| headless Chrome/Edge | cannot start | no automated browser/E2E verification here |
| Rust / `cargo` | not installed | Tauri cannot be *built* in this session |

Therefore: **a static site with no build step.** Plain HTML + CSS + native ES modules + self-hosted
engines. This is not a compromise — for a browser-side PDF toolbox it is the fastest possible delivery
(pages are already the deployable artifact, first paint needs no JS bundle parse, Cloudflare Pages serves
it free), and it removes an entire class of toolchain failure.

## 2. Repository layout (canonical paths — do not invent new ones)

```
C:\toolseer\
├─ PROJECT_DIRECTIVE.md          owner's directive + environment appendix
├─ README.md                     entry point for humans
├─ toolseer.txt                  LEGACY source (frozen, never edit)
├─ design/reference-ui.png       official visual reference
├─ docs/                         ARCHITECTURE, REPO-STUDY, DESKTOP, SEO, MASCOT, VERIFICATION
├─ tools/
│  ├─ vendor.mjs                 download+extract pinned engines from npm registry
│  ├─ serve.mjs                  zero-dependency static dev server
│  ├─ check.mjs                  integrity gate (routes, assets, SEO, syntax, vendor hashes)
│  └─ build.mjs                  produce the deployable artifact + report
├─ apps/
│  ├─ web/                       ← THE DEPLOYABLE SITE (Cloudflare Pages root)
│  │  ├─ index.html              tool hub / home
│  │  ├─ <slug>/index.html       10 tool pages, one folder each
│  │  ├─ assets/css/toolseer.css design system
│  │  ├─ assets/js/ui/*.js       shell, toolkit, i18n, icons
│  │  ├─ assets/js/core/*.js     PDF engine (the only place PDF logic lives)
│  │  ├─ assets/img/mascot/*.svg illustration system
│  │  ├─ vendor/**               self-hosted engines (GENERATED — never hand-edit)
│  │  ├─ robots.txt, sitemap.xml, _headers, _redirects
│  └─ desktop/                   Tauri + Stirling-PDF packaging scaffold
└─ tests/                        Node test runner + engine tests
```

**Cloudflare Pages settings:** build command = *(none)*, output directory = `apps/web`.

## 3. URL contract (programmatic SEO)

| Slug | Tool | Phase |
|---|---|---|
| `/` | hub, links to all tools | 1 |
| `/image-to-pdf` | Images → PDF | 1 |
| `/merge-pdf` | Merge PDFs | 1 |
| `/compress-pdf` | Compress / reduce size | 1 |
| `/split-pdf` | Split / extract pages | 1 |
| `/protect-pdf` | Encrypt with password | 1 |
| `/unlock-pdf` | Remove password | 1 |
| `/pdf-to-images` | PDF → PNG/JPEG (+ZIP) | 1 |
| `/organize-pdf` | Reorder / rotate / delete pages | 1 |
| `/extract-text-pdf` | Extract text (+ OCR) | 1 |
| `/desktop` | Windows app landing page | 1 |

Legacy Blogger URLs must 301 to the new slugs via `_redirects`.

## 4. Engine contract — `apps/web/assets/js/core/`

Rules that make the engine testable in Node (no browser needed):

1. **Pure ESM, zero DOM access at module scope.** Anything needing `document`, `canvas`, `Blob` URL
   creation or `Worker` is injected or isolated in `render.js`.
2. **Bytes in, bytes out.** Every operation takes `Uint8Array` and returns `Uint8Array`.
   Never `File`, never `Blob`, never object URLs — the UI layer adapts.
3. **Never throw a bare error.** Throw `ToolError` with `{ code, message, hint }` where `code` is a
   stable identifier the UI localises (`need-password`, `wrong-password`, `corrupt`, `too-large`, …).
4. **Report what happened.** Operations that can degrade (compression that grew the file, OCR fallback)
   return `warnings: string[]`.

```js
// apps/web/assets/js/core/index.js  — public surface
export class ToolError extends Error { constructor(code, message, hint) }

/** @typedef {{ name: string, bytes: Uint8Array, type?: string }} Input */

export async function mergePdfs(inputs, opts = {})            // → { bytes, pageCount, warnings }
export async function splitPdf(bytes, opts)                   // → { outputs: [{name, bytes}], pageCount }
export async function organizePdf(bytes, opts)                // → { bytes, pageCount, warnings }
export async function imagesToPdf(images, opts)               // → { bytes, pageCount, warnings }
export async function compressPdf(bytes, opts)                // → { bytes, before, after, ratio, warnings }
export async function protectPdf(bytes, opts)                 // → { bytes, warnings }
export async function unlockPdf(bytes, opts)                  // → { bytes, warnings }
export async function extractText(bytes, opts)                // → { text, pages: [{page,text}], meta }
export async function pdfToImages(bytes, opts, io)            // → { outputs: [{name, bytes}], pageCount }
export async function pdfInfo(bytes)                          // → { pageCount, encrypted, version, meta }
export async function zipFiles(outputs)                       // → Uint8Array (real .zip)

/* browser-only helpers; throw ToolError('unsupported') instead of crashing in Node */
export function setCanvasFactory(factory)
export async function renderThumbnails(bytes, { maxWidth = 220, pages } = {})

export function parsePageRanges(spec, maxPage)                // 'all' | '1-3,5' → number[] (1-based)
export function formatBytes(n)                                // 1536 → '1.5 KB'  (binary units)
export function safeBaseName(name, fallback)                  // strips path + unsafe chars + .pdf
```

**Warning codes are part of the contract.** Operations that degrade return stable codes in
`warnings`, and the UI localises them centrally (`describeWarning` in `toolkit.js`); an unmapped code
is shown verbatim so nothing is hidden. Known set:
`compression-ineffective:<pct>%`, `image-recompression-unavailable:<level>`, `not-encrypted`,
`weak-encryption:<algo>`, `ocr-failed:page-<n>`, `metadata-unavailable`, `outline-unavailable`,
`reencoded:<name>`, `text-layer-lost`, `password-removed`.

**Required option shapes** (exact key names — the UI writes these):

```js
mergePdfs(inputs, { addBookmarks?: boolean, failOnEncrypted?: boolean })
splitPdf(bytes, { mode: 'each'|'ranges'|'every-n', ranges?: '1-3,7', everyN?: number, mergeToOne?: boolean })
organizePdf(bytes, { order: number[], rotate?: { [sourcePage: string]: 90|180|270 }, drop?: number[] })
imagesToPdf(images, { pageSize: 'a4'|'letter'|'legal'|'fit', orientation: 'auto'|'portrait'|'landscape',
                      margin: 'none'|'small'|'medium'|'large', quality: 0.1..1.0 })
compressPdf(bytes, { level: 'lossless'|'balanced'|'strong', removeMetadata?: boolean, dpi?: number, quality?: number })
protectPdf(bytes, { userPassword: string, ownerPassword?: string, allow: { print, copy, modify, annotate },
                    algorithm?: 'aes-256'|'aes-128'|'rc4-128' })
unlockPdf(bytes, { password: string })
extractText(bytes, { pages?: number[], layout?: boolean, ocr?: boolean, ocrLang?: 'eng'|'ara'|'eng+ara' })
pdfToImages(bytes, { format: 'png'|'jpeg', dpi: 72|150|300, pages?: number[], quality?: number },
            io?: { createCanvas(w,h), toBytes(canvas, format, quality) })
```

**`organizePdf` page numbering is unambiguous and must stay that way.** Both `order` and `rotate` are
keyed by **1-based source page number as it appears in the input file** — never by output position.
`order` lists the source pages in their new sequence; any source page left out is dropped, so `order`
alone fully determines the output. `drop` is a convenience for "remove these pages, keep the rest"
and is ignored when `order` is supplied. Example: input pages 1–4, `order: [3,1,2]`,
`rotate: {'3': 90}` → output has three pages: old page 3 (rotated), old page 1, old page 2.

`io` is the **only** browser dependency, and it is injected: `render.js` supplies a canvas-backed
implementation in the browser, tests inject a stub.

### Page-grid tools

Tools that edit pages one by one (`/organize-pdf`) use `preview: 'pages'` in `defineTool()`. The
toolkit then asks the engine for thumbnails (`renderThumbnails`), renders the grid, and owns
reordering, per-page rotation and deletion. The tool's `run()` receives:

```js
run({ files, settings, pages, allPages, onProgress })
// pages:    [{ source, rotation }]  — kept pages, in output order, rotation ∈ {0,90,180,270}
// allPages: [{ src, rotation, deleted }] — the raw grid state, for undo-style features
```

## 5. Engine → library mapping (no wheel reinvention)

| Operation | Library | Notes |
|---|---|---|
| merge, split, organize, images→PDF | `pdf-lib` (MIT) | pure JS, works in Node too |
| page rendering, text extraction | `pdfjs-dist` (Apache-2.0) | worker must be a module worker |
| protect, unlock, lossless compress | `qpdf-wasm` (ISC) | Emscripten, `callMain(args)`, MEMFS |
| zip download | `jszip` (MIT) | global `JSZip` from classic script |
| OCR (opt-in, lazy) | `tesseract.js` (Apache-2.0) | +8MB model download, never on first paint |

Loading rules: `pdf-lib` and `pdf.js` are ES modules (`import`). `qpdf.js` and `jszip.min.js` are
**classic** UMD scripts — load them with a `<script>` tag and use the global, or via a lazy loader in
`core/engines.js`. Never assume `require` exists in the browser.

## 6. UI contract — the "ToolSeer V3" shell

Matches `design/reference-ui.png`: fixed left settings sidebar (320px) + top bar + centred work area.

```
┌─ support bar (dismissible, optional) ───────────────────────────────┐
├──────────────┬──────────────────────────────────────────────────────┤
│ SETTINGS     │  logo   Converter  Our Works  Contact   [AR] [Upgrade]│
│ sidebar      ├──────────────────────────────────────────────────────┤
│ (per-tool    │   H1 + subtitle                                       │
│  controls)   │   ┌ drop zone ───────────────────────────────┐        │
│              │   │  click or drag files here                │        │
│              │   └──────────────────────────────────────────┘        │
│              │   file list / previews / page grid                    │
│              │   [ primary action button ]                           │
│ theme+lang   │   no-files empty state                                │
└──────────────┴──────────────────────────────────────────────────────┘
```

**Design tokens** live in `:root` of `toolseer.css` and switch on `html[data-theme="dark"]`.
Brand primary is `--ts-primary: #0040ff` (from the reference image and the legacy code's
`theme-color`). Class naming is `ts-*` for components, `is-*` for states.

**Every tool page is authored with `toolkit.js`:**

```html
<link rel="stylesheet" href="/assets/css/toolseer.css">
<script type="module">
  import { defineTool } from '/assets/js/ui/toolkit.js';
  defineTool({
    slug: 'merge-pdf',
    accept: '.pdf', multiple: true, minFiles: 2,
    settings: [ {type:'switch', id:'bookmarks', labelKey:'setting.bookmarks', default:true} ],
    action: { labelKey: 'action.merge', icon: 'stack' },
    async run({ files, settings, onProgress }) {
      const inputs = await Promise.all(files.map(f => f.asInput()));
      return { outputs: [{ name: 'merged.pdf', bytes }] };   // or { text } or { preview: [...] }
    },
  });
</script>
```

`toolkit.js` owns: drop zone, file list, reordering, validation, progress, error display, download,
the empty state, and the settings sidebar rendering. A tool page supplies **only** its settings schema
and its `run()`.

**i18n contract:** all user-visible strings come from `assets/js/ui/i18n.js` keyed by
`data-i18n` attributes; `ar` is RTL (`html[dir="rtl"]`). No hard-coded Arabic or English inside
`run()` — return error codes, not sentences.

## 7. Hard rules for every agent

1. Never run `npm`, `pnpm`, `npx`, `git`, `vite`, or any command that spawns a process with pipes.
   `node <file>` and `node -e` are safe.
2. Never edit `apps/web/vendor/**` (generated + checksummed by `vendor.lock.json`).
3. Never edit `toolseer.txt` (legacy reference) or `design/reference-ui.png`.
4. Stay inside your task's declared write scope. If you need a file outside it, message the Lead.
5. No runtime CDN, no external font, no analytics, no ads, no tracking. Privacy is a hard requirement:
   **no user file ever leaves the browser.**
6. Every tool page must carry: unique `<title>`, meta description, canonical, OG/Twitter tags,
   `SoftwareApplication` + `FAQPage` JSON-LD, one `<h1>`, and 150+ words of genuinely useful,
   technically accurate copy (not filler).
7. Accessibility is not optional: labels on every control, keyboard-operable drop zone, visible focus,
   `aria-live` for progress, 4.5:1 contrast in both themes.
