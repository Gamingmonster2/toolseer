# ToolSeer V3 — Upstream Repository Study

**Question this document answers** (owner's directive §2): *"study `kiss-the-pdf` and `pdfkoi` and pick the best/most
stable one to build the web site on"* — plus the third repo the directive names for the desktop app,
`Stirling-Tools/Stirling-PDF`.

**Method.** Read-only HTTP research (no `git`, no `npm` in this environment). Every licence claim below was read from
the repository's own `LICENSE` file or from the package registry metadata, **not** from a README badge. Star counts,
push dates and licence fields were read from the GitHub REST API on 2026-10-06. Anything I could not verify is marked
**UNVERIFIED**. Sources are listed in §8 and linked inline.

---

## 1. Verdict (read this if you read nothing else)

**No upstream repository changes ToolSeer's locked engine decision, and nothing should be copied verbatim from any of
the three.** `kiss-the-pdf` is MIT and independently converged on **exactly the three engines ToolSeer already
locked** — `pdf-lib` + `pdfjs-dist` + `@neslinesli93/qpdf-wasm` ([package.json](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/package.json))
— which is strong third-party confirmation that the choice in `ARCHITECTURE.md` §5 is correct; copy its **registry
shape and route pattern**, not its code (it is a Next.js/Turbopack app and ToolSeer is a no-build static site).
`pdfkoi` is **AGPL-3.0** ([LICENSE](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/LICENSE)) and additionally
ships an **AGPL-3.0-or-later** CoherentPDF browser bundle in its deployable `public/` directory — read it as a
cautionary example and copy nothing from it at all. `Stirling-PDF` is **not MIT any more**: `LICENSE` on `main` is MIT
*except* for carved-out directories — including the desktop-client and engine directories — that are governed by a
paid "Stirling PDF User License" ([LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/LICENSE),
[engine/LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/engine/LICENSE),
[frontend/editor/src/desktop/LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/frontend/editor/src/desktop/LICENSE)).
That blocks the directive's desktop plan as written (§4.3) and is escalated to the Lead in §5.3.

**Actionable conclusion:** keep `pdf-lib` (MIT) + `pdfjs-dist` (Apache-2.0) + `qpdf-wasm` (ISC) + `jszip` (MIT option
of a dual licence) + `tesseract.js` (Apache-2.0); build the site on ToolSeer's own no-build static HTML + its own V3
design; take the six *patterns* in §6 from `kiss-the-pdf` (registry → prerendered routes, registry-driven internal
links, four JSON-LD blocks per page, justified lazy loading of qpdf, optional MIT TIFF decoder, Cloudflare `_headers`/`_redirects`)
and none of its code.

---

## 2. Comparison table

| | `positiveabhii/kiss-the-pdf` | `pdfkoi/pdfkoi` | `Stirling-Tools/Stirling-PDF` |
|---|---|---|---|
| **Stack** | Next.js `16.3.4` + React `19.2.8` + TypeScript + Tailwind v4 + Turbopack ([package.json](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/package.json)) | Next.js `15.5.14` + React 19 + TS + Tailwind v4 + Zustand + next-intl + React Flow ([package.json](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/package.json)) | Java/Spring Boot server + separate React/TS frontend (`frontend/editor/`); ships Docker, JAR, MSI, DMG ([README](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/README.md)) |
| **Licence (LICENSE file read)** | **MIT** — "MIT License / Copyright (c) 2024 PDF Toolkit Contributors" ([LICENSE](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/LICENSE)) | **AGPL-3.0** — full Affero text, no exceptions ([LICENSE](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/LICENSE)); GitHub API licence field `agpl-3.0` ([API](https://api.github.com/repos/pdfkoi/pdfkoi)) | **MIT + proprietary carve-outs** — "Content outside of the above mentioned directories … available under the MIT License", but `engine/`, `frontend/editor/src/desktop/`, `.../proprietary/`, `app/proprietary/`, `app/saas/` are under a paid licence ([LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/LICENSE)) |
| **Processing model** | 100% client-side; README: "Local Processing … files never touch our servers" ([README](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/README.md)) | 100% client-side static export (`output: 'export'` in production) ([next.config.js](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/next.config.js)) | **Server-side/self-hosted** by design ("Run it as a personal desktop app, in the browser, or deploy it on your own servers") ([README](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/README.md)) |
| **Declared tool count** | Registry is the single source of truth; the category headers visible in it total **58** across five of eight numbered categories (Organization 10, Pages 20, Forms 13, Enhancement 9, Reading 6 — categories 3–5, including Security, were cut off mid-fetch), and the docs advertise a "100 Tools Spec" ([src/config/tools.ts](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/src/config/tools.ts), [README](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/README.md)). Exact implemented count **UNVERIFIED** (file truncated during fetch) | README lists 95 tools across 6 categories (27+19+22+13+8+6) ([README](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/README.md)); registry is `src/config/tools.ts`, 38,683 bytes ([contents API](https://api.github.com/repos/pdfkoi/pdfkoi/contents/src/config)) | "50+ PDF tools" ([README](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/README.md)) |
| **Last activity / health** | Created 2026-09-02, last push 2026-10-06, **4 stars**, 3 forks, **22 open issues**, **0 releases** ([API](https://api.github.com/repos/positiveabhii/kiss-the-pdf), [releases](https://api.github.com/repos/positiveabhii/kiss-the-pdf/releases)) | Fork created 2026-03-27, last push **2026-04-20**, **6 stars**, Issues **disabled** (`has_issues: false`) ([API](https://api.github.com/repos/pdfkoi/pdfkoi)). Upstream `PDFCraftTool/pdfcraft`: 8,666 stars, 1,932 forks, 37 open issues, last push 2026-09-24 ([API](https://api.github.com/repos/PDFCraftTool/pdfcraft)) | Created 2023-01-27, last push 2026-10-06, **93,683 stars**, 10,501 forks, 545 open issues; v3.1.0 released 2026-10-05 ([API](https://api.github.com/repos/Stirling-Tools/Stirling-PDF), [releases](https://api.github.com/repos/Stirling-Tools/Stirling-PDF/releases)) |
| **What it solves well** | A *blueprint*: one flat tool registry → one static per-slug route with full SEO metadata + 4 JSON-LD blocks; lazy per-tool chunks; vendored qpdf served as a classic script | A *deployment blueprint* for Cloudflare Pages static export incl. `_headers`/`_redirects` + Pages Functions for query-param redirects, and i18n routing — under a licence ToolSeer cannot use | The only repo here that actually does heavy server-side PDF work (OCR, office conversion, 50+ ops) and already ships signed Windows/MSI desktop builds |

---

## 3. Licence findings — loud flags first

### 3.1 🚩 AGPL / copyleft flags

| Finding | Evidence | Consequence for ToolSeer |
|---|---|---|
| **`pdfkoi` is AGPL-3.0** | `LICENSE` is the verbatim AGPL-3.0 text; GitHub licence field `agpl-3.0` ([LICENSE](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/LICENSE), [API](https://api.github.com/repos/pdfkoi/pdfkoi)) | Copying **any** code from it makes ToolSeer's web site a derivative work: §5(c) requires the whole work to be licensed AGPL, and §13 requires offering Corresponding Source to every network user. That is incompatible with a commercial-facing product. **Copy zero lines.** |
| **`pdfkoi` inherits AGPL from `PDFCraftTool/pdfcraft`** | GitHub API shows `pdfkoi` is a fork of `zzzhhh1/pdfcraft`, whose `source` is `PDFCraftTool/pdfcraft`, licence `agpl-3.0` ([API](https://api.github.com/repos/pdfkoi/pdfkoi), [API](https://api.github.com/repos/PDFCraftTool/pdfcraft)); README credits BentoPDF as the origin of its "core logic" ([README](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/README.md)) | The AGPL taint is upstream and structural, not a one-file accident. |
| **`pdfkoi` ships an AGPL-3.0-or-later CoherentPDF browser bundle in its deployable output** | Repo tree contains `public/coherentpdf.browser.min.js`, 1,325,062 bytes ([tree](https://api.github.com/repos/pdfkoi/pdfkoi/git/trees/main?recursive=1)); the `coherentpdf` npm package declares `"license":"AGPL-3.0-or-later"` ([npm](https://registry.npmjs.org/coherentpdf/latest)) | With `output: 'export'`, everything in `public/` is published to the live site ([next.config.js](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/next.config.js)). Serving an AGPL binary from a commercial site is exactly the trap to avoid. **ToolSeer must not vendor this file.** Whether it is actually `import`ed by a page is **UNVERIFIED** — presence in the deployed tree is sufficient reason to exclude it. |
| **`pdfkoi`'s README advertises PyMuPDF (WASM)** | README "Tech Stack → PDF Processing: PDF.js, pdf-lib, **PyMuPDF (WASM)**" ([README](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/README.md)); PyMuPDF's licence field is `agpl-3.0` ([API](https://api.github.com/repos/pymupdf/PyMuPDF)) | Same reason. Whether the WASM build is actually bundled is **UNVERIFIED** (no `pymupdf` entry in `package.json`). Treat as a reason not to source engines from this repo. |
| **ToolSeer avoided MuPDF for exactly this reason** | `PROJECT_DIRECTIVE.md` §ج: "امتنعنا عن `mupdf` (AGPL-3.0) لأنه يفرض ترخيصاً فيروسياً" | Decision is correct and independently confirmed by the two AGPL findings above. |

### 3.2 The locked engine set — licences re-verified from registry metadata

| Engine | Declared licence (verified) | Source | Verdict |
|---|---|---|---|
| `pdf-lib@1.17.1` | **MIT** (`"license":"MIT"`, full MIT text (c) 2019 Andrew Dillon) | [npm](https://registry.npmjs.org/pdf-lib/latest) | ✅ matches `ARCHITECTURE.md` §5 |
| `pdfjs-dist@6.4.299` | **Apache-2.0** | [npm](https://registry.npmjs.org/pdfjs-dist/latest) | ✅ |
| `@neslinesli93/qpdf-wasm@0.3.0` | **ISC** | [npm](https://registry.npmjs.org/@neslinesli93/qpdf-wasm/latest) | ✅ permissive — **but see 3.3** |
| `jszip@3.10.2` | **`(MIT OR GPL-3.0-or-later)`** — dual | [npm](https://registry.npmjs.org/jszip/latest) | ✅ permissive **only if** ToolSeer takes the MIT option. Record "MIT" explicitly in the vendor manifest so a future licence audit does not flag GPL. |
| `tesseract.js@7.0.0` | **Apache-2.0** | [npm](https://registry.npmjs.org/tesseract.js/latest) | ✅ (directive pins no version; latest is 7.0.0) |
| `utif2@4.1.0` *(not currently in the set — see §6.5)* | **MIT** | [npm](https://registry.npmjs.org/utif2/latest) | ✅ safe to add for TIFF input |

No AGPL/GPL/SSPL engine is present in the locked set. The AGPL risk in this project comes **entirely** from the two
candidate repos, not from ToolSeer's own stack.

Scope limit, stated honestly: only the PDF/OCR engines and the three packages I recommend or flag above were
licence-checked individually. The remaining non-engine dependencies of `kiss-the-pdf` (`clsx`, `lucide-react`,
`react-icons`, `tailwind-merge`, `qrcode`) were **not** opened — **UNVERIFIED**. They are UI helpers irrelevant to
ToolSeer's decision, and ToolSeer would not inherit them.

### 3.3 Documentation defect found (needs a Lead decision, not my write scope)

`PROJECT_DIRECTIVE.md` §ج lists `qpdf-wasm` as **Apache-2.0**. `ARCHITECTURE.md` §5 lists it as **ISC**. The registry
says **ISC** ([npm](https://registry.npmjs.org/@neslinesli93/qpdf-wasm/latest)). `ARCHITECTURE.md` is correct; the
directive's licence cell should be corrected to ISC. Both are permissive, so no engineering impact — but the vendor
manifest in `apps/web/vendor/` (directive §د.2) must say `ISC`, and a wrong licence string next to a shipped binary is
a commercial-audit problem.

---

## 4. Per-repo verdicts

### 4.1 `positiveabhii/kiss-the-pdf` — **PARTIAL REUSE (patterns only, no code)**

**Facts.** MIT ([LICENSE](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/LICENSE)). Client-side only.
Engines: `@neslinesli93/qpdf-wasm ^0.3.0`, `pdf-lib ^1.17.1`, `pdfjs-dist ^6.3.289`, `jszip ^3.10.1`, `utif2 ^4.1.0`
(TIFF decode), `qrcode ^1.5.4` ([package.json](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/package.json)).

**Routing / registry — confirmed from source, not the README.**
- `src/config/tools.ts` is a flat `ToolDefinition[]` carrying `id`, `name`, `category`, `href` (e.g. `/merge-pdf`),
  `icon`, `status`, `seoTitle`, `seoDescription`, `keywords`, `seoH1`, `seoH2s`, `introParagraph`, `howTo`, `faqs`,
  `relatedTools` — plus a `getToolsByCategory()` helper.
- `src/app/(app)/[tool]/page.tsx` is **one dynamic route for every tool**, with `generateStaticParams()` returning
  `tools.map(t => ({tool: t.id}))`, plus `generateMetadata()` emitting title/description/canonical/OG/Twitter per tool,
  and four inline JSON-LD blocks: `SoftwareApplication`+`WebApplication`, `BreadcrumbList`, `HowTo`, `FAQPage`.
- `src/features/tools/<category>/registry.ts` maps tool id → `() => import("./MergePdf")`, i.e. **one lazy chunk per
  tool** (the file's own comment: "Each import() is its own chunk, loaded only when that tool's page opens").
- Pure operation modules live beside the UI: `src/features/tools/organization/ops/{merge,split,assemble,ranges,pages,move,insert,organize,list}.ts`.
- `scripts/copy-vendor.mjs` copies `qpdf.js` + `qpdf.wasm` into `public/vendor/qpdf/`, with the comment that bundling
  it through Turbopack would pull in Node branches (`fs`/`path`), so it is "loaded with a `<script>` tag on demand —
  only by the tools that need it (encrypt / decrypt / permissions)".

**Why only patterns.** `next.config.ts` is empty — no `output: 'export'` — and the README documents `npm run start`
([next.config.ts](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/next.config.ts), [README](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/README.md)),
so it expects a **Node runtime**. ToolSeer is a no-build static site on Cloudflare Pages (`ARCHITECTURE.md` §1–2), and
this environment cannot run Turbopack/Next at all. Taking the code would import a build step the project has
explicitly rejected.

**Maintenance, honestly.** One month old, 4 stars, 3 forks, 22 open issues, and **zero releases**
([API](https://api.github.com/repos/positiveabhii/kiss-the-pdf), [releases](https://api.github.com/repos/positiveabhii/kiss-the-pdf/releases)).
The repository's own topics include `gssoc26`, `hacktoberfest`, `claude-code`, `cursor`
([API](https://api.github.com/repos/positiveabhii/kiss-the-pdf)). Read that as: *fast-moving hobby project, unproven
at scale* — fine as a design reference, unsuitable as a dependency. Its own `ARCHITECTURE.md` describes the Web-Worker
processing path as *future* work ("Future Architecture"), while the README presents it as current
([ARCHITECTURE.md](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/ARCHITECTURE.md), [README](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/README.md)).

**Also do not copy its copy.** `src/config/tools.ts` contains at least two verifiable textual landmines that collide
with the directive's rule §د.5 ("no false technical claims"):
1. The `merge-pdf` `introParagraph` states "our merging engine is powered by client-side WebAssembly", while the merge
   path is `src/features/tools/organization/ops/merge.ts` and the only WASM engine declared is qpdf — which the repo's
   own `copy-vendor.mjs` comment restricts to "encrypt / decrypt / permissions". The claim is not supported by the
   repo's own files.
2. The `watermark-pdf` entry is unfilled template filler ("Easily watermark pdf directly in your browser…") with
   generic FAQ answers, unlike its richer neighbours — evidence that a 100-tool registry invites copy-paste padding.
   ToolSeer requires 150+ words of genuinely accurate copy per page (`ARCHITECTURE.md` §7.6); a template produces the
   opposite.

### 4.2 `pdfkoi/pdfkoi` — **DO NOT REUSE (any part)**

**Facts.** **AGPL-3.0**, full text in `LICENSE`, no linking exception, no additional permissions
([LICENSE](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/LICENSE)). A fork of `zzzhhh1/pdfcraft`, itself a fork
of `PDFCraftTool/pdfcraft` (8,666 stars, AGPL-3.0) ([API](https://api.github.com/repos/pdfkoi/pdfkoi),
[API](https://api.github.com/repos/PDFCraftTool/pdfcraft)). Last push **2026-04-20**, Issues **disabled** on the fork,
6 stars ([API](https://api.github.com/repos/pdfkoi/pdfkoi)) — activity has effectively moved to upstream PDFCraft,
whose own releases are Tauri-built desktop installers of 414–503 MB
([releases](https://api.github.com/repos/PDFCraftTool/pdfcraft/releases)).

**Engines actually used.** `pdf-lib ^1.17.1`, `pdfjs-dist ^4.8.69` **and** `pdfjs-dist-legacy` (aliased to
`pdfjs-dist@^2.16.105`), `tesseract.js ^6.0.1`, `jspdf ^4.0.0`, `html2canvas`, `html2pdf.js`, `ag-psd ^29.0.0` (PSD),
`cropperjs`, `reactflow ^11.11.4`, `zustand`, `marked`, `highlight.js`
([package.json](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/package.json)). Plus the AGPL CoherentPDF bundle
and the advertised PyMuPDF/WASM in §3.1.

**Why the licence alone is decisive.** AGPL-3.0 §5(c): "You must license the entire work, as a whole, under this
License to anyone who comes into possession of a copy." §13 then extends the source-offer obligation to "all users
interacting with it remotely through a computer network". For a commercial-facing web site this converts a private
codebase into an obligation to publish its source. No amount of "we only took a helper" survives that; and because the
repo is a rebranded fork, even the provenance is ambiguous. **Verdict: do not read its source for implementation
ideas, do not copy files, do not vendor `coherentpdf.browser.min.js`, do not use it as the site's base.**

**What is legitimately useful — its *deployment* facts, which are public knowledge anyway.** It confirms the
Cloudflare Pages static-export recipe the directive already assumes: `output: 'export'`, `images: { unoptimized: true }`,
keep `public/_headers` and `public/_redirects` in the repo so Cloudflare applies them after export, and handle
query-string redirects (e.g. `/tools?category=edit-annotate`) with Pages Functions because `_redirects` cannot match
query parameters ([next.config.js](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/next.config.js), [README](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/README.md); the
repo tree confirms `functions/[[path]].js`, `functions/_lib/legacy-category-redirect.js`, `public/_headers`,
`public/_redirects`) ([tree](https://api.github.com/repos/pdfkoi/pdfkoi/git/trees/main?recursive=1)). That is a pattern
statement, not copyrighted expression; it is also already reflected in `ARCHITECTURE.md` §2.

### 4.3 `Stirling-Tools/Stirling-PDF` — **DO NOT REUSE for the desktop plan as written; MIT only outside the carve-outs**

**Facts.** 93,683 stars, 10,501 forks, 545 open issues, ~540 MB repo, last push 2026-10-06, v3.1.0 published
2026-10-05 ([API](https://api.github.com/repos/Stirling-Tools/Stirling-PDF), [releases](https://api.github.com/repos/Stirling-Tools/Stirling-PDF/releases)).
GitHub reports the licence as `NOASSERTION`/`other` ([API](https://api.github.com/repos/Stirling-Tools/Stirling-PDF)) —
that alone should have stopped the "MIT engine" assumption in the directive.

**The licence, verbatim from the files I read.** Top-level `LICENSE` is MIT (c) 2025 Stirling PDF Inc., then:
"* All content that resides under the `engine/` directory … is licensed under the license defined in `engine/LICENSE`"
— and the same for `app/proprietary/`, `app/saas/`, `frontend/editor/src/{proprietary,desktop,saas,cloud,prototypes,portal,portal-saas}/`.
I fetched three of those carve-out licences (`engine/LICENSE`, `frontend/editor/src/desktop/LICENSE`,
`frontend/editor/src/proprietary/LICENSE`) and **all three contain the same proprietary "Stirling PDF User License"**,
which states:

> "Production use of the Stirling PDF Software is only permitted with a valid Stirling PDF User License."
> "You may not: Use the Software in production environments; Copy, merge, distribute, sublicense, or sell the Software"
> "Any such modifications or derivative works: … May not be distributed or sublicensed; Remain the intellectual property
> of Stirling PDF and/or its licensors"

(Identical text verified at [engine/LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/engine/LICENSE),
[desktop/LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/frontend/editor/src/desktop/LICENSE),
[proprietary/LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/frontend/editor/src/proprietary/LICENSE);
the `contents` API confirms `engine/` also holds `src/`, `pyproject.toml`, `scripts/`, `tests/` — i.e. it is a real
code directory, not a stub ([contents](https://api.github.com/repos/Stirling-Tools/Stirling-PDF/contents/engine)).)

**Why this kills directive §2-ثانياً as written.** The owner's desktop plan is: wrap Stirling-PDF in Tauri, then
"upload the executable to the project repository and offer a direct download inside the site under `/desktop`"
(`PROJECT_DIRECTIVE.md` §2). That is simultaneously (a) use of a carve-out directory that contains the desktop client
and the engine, (b) *distribution* of a derivative work, and (c) a client-facing/commercial context — the three things
the carve-out licence forbids without a paid subscription. The README even labels the project "open-core"
([README](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/README.md)).

**Two further practical points that make the plan unattractive even with a licence.** Stirling PDF already ships its
own first-party desktop builds — `Stirling-PDF-windows-x86_64.msi` (334,426,112 bytes for v3.1.0) and matching DMG/AppImage/deb
([releases](https://api.github.com/repos/Stirling-Tools/Stirling-PDF/releases)) — so a thin Tauri wrapper adds
duplication, not capability; and ~310–460 MB is the opposite of the directive's "lightweight" (خفيف) requirement.
Separately, self-hosting for personal/small use *is* permitted and free: the docs' Free plan is "Free forever, up to 5
users, all PDF operations, self-hosted deployment" ([docs](https://docs.stirlingpdf.com/Paid-Offerings/)) — that
reconciles with the licence's "internal trial, evaluation, or minimal use" clause. **Self-hosting ≠ redistribution**,
and only redistribution is what `/desktop` needs.

**The one legitimate MIT path, if the desktop app stays in scope.** Tag `v0.46.2` — i.e. before the relicense that the
project's own discussion #4332 titles "License change v0.46.2 to v1.0.0" — carries plain MIT: "MIT License /
Copyright (c) 2024 Stirling Tools", with no carve-out list
([v0.46.2/LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/v0.46.2/LICENSE),
[discussion #4332](https://github.com/Stirling-Tools/Stirling-PDF/discussions/4332)). Forking that snapshot is legally
clean, **but** it means freezing on a pre-1.0 architecture and forfeiting all later security fixes, and I have **not**
verified whether any *subdirectory* of v0.46.2 carried different terms (**UNVERIFIED** — a per-file licence scan of the
v0.46.2 tree is required before anyone relies on this). Recommendation: do not build `/desktop` as a Stirling wrapper;
either ship the web app's own engine inside a Tauri shell (no third-party licence involved), or link to Stirling's own
download page. The Lead owns that decision — see §5.3.

---

## 5. The owner's question, answered directly

### 5.1 Engine choice ≠ UI choice

The directive fuses two decisions. They must be separated:

- **Engine** (what parses and writes the PDF bytes) — already locked in `ARCHITECTURE.md` §5 and **not** a choice
  these repos offer: `pdf-lib` (MIT) for merge/split/organize/images→PDF, `pdfjs-dist` (Apache-2.0) for rendering and
  text extraction, `qpdf-wasm` (ISC) for protect/unlock/lossless compress, `jszip` (MIT) for ZIP, `tesseract.js`
  (Apache-2.0) for opt-in OCR. All five are permissive and self-hostable; the licences are verified in §3.2.
- **UI / architecture** (how pages are structured, routed, and discovered) — this *is* where the repos are informative,
  and where ToolSeer has already decided: its own `ToolSeer V3` design (`design/reference-ui.png`,
  `ARCHITECTURE.md` §6) on a no-build static site.

### 5.2 Does either repo change the locked decision?

**No.**

- `kiss-the-pdf` is the closest analogue and it independently uses **the same three engines** ToolSeer locked, in a
  Next.js shell. Same engine set, different shell → the shell is the only transferable part, and ToolSeer's shell is
  already frozen and better suited to the no-build constraint. It does not change the engine decision; it corroborates
  it.
- `pdfkoi` cannot change an engine decision for a commercial product at all: its own codebase is AGPL-3.0 and its
  deployable tree additionally carries an AGPL-3.0-or-later CoherentPDF bundle. Its engine list (with `jspdf`,
  `html2canvas`, `html2pdf.js`, `ag-psd`, React Flow) is also broader and heavier than Phase 1 needs.
- Neither repo offers anything for the two hardest Phase-1 problems — **lossless compress** and **protect/unlock** —
  beyond what ToolSeer already has. Both reach for qpdf-WASM; `kiss-the-pdf`'s `copy-vendor.mjs` confirms the same
  loading problem ToolSeer documented (UMD + runtime-fetched `.wasm`, must not be bundled). Same conclusion from an
  independent codebase.

### 5.3 Escalate to the Lead (outside my write scope)

1. **`PROJECT_DIRECTIVE.md` §2-ثانياً (desktop app) contradicts `Stirling-PDF`'s current licence.** The `/desktop`
   page as specified (bundling Stirling into a Tauri app and redistributing the binary) is prohibited by
   `engine/LICENSE` and `frontend/editor/src/desktop/LICENSE` without a paid subscription. `docs/DESKTOP.md` and the
   `/desktop` landing page must not promise a downloadable Stirling-derived build until this is resolved.
2. **`PROJECT_DIRECTIVE.md` §ج lists `qpdf-wasm` as Apache-2.0; it is ISC** (§3.3).

---

## 6. Patterns worth copying (no code, no licence exposure)

1. **One flat tool registry as the single source of truth → one prerendered page per tool.**
   `src/config/tools.ts` + `src/app/(app)/[tool]/page.tsx` with `generateStaticParams()` and per-tool
   `generateMetadata()` ([tools.ts](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/src/config/tools.ts),
   [page.tsx](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/src/app/(app)/%5Btool%5D/page.tsx)).
   ToolSeer equivalent: one plain-JS registry object (living beside `apps/web/assets/js/core/`, `ARCHITECTURE.md` §2)
   consumed by `tools/check.mjs` to assert that each of the 11 slugs in `ARCHITECTURE.md` §3 exists, has a unique
   `<title>`, and carries the required JSON-LD. Copy the *shape* — id, slug, category, SEO fields, related tools as
   ids — never the file.
2. **Derive internal linking from the registry, not from hand-written HTML.** `relatedTools: ["split-pdf", …]` resolved
   by id at render time. This is what makes programmatic SEO scale past 10 pages without orphan pages.
3. **Four JSON-LD blocks per tool page, generated from the same registry**: `SoftwareApplication`+`WebApplication`,
   `BreadcrumbList`, `HowTo`, `FAQPage` ([page.tsx](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/src/app/(app)/%5Btool%5D/page.tsx)).
   `ARCHITECTURE.md` §7.6 requires `SoftwareApplication` + `FAQPage`; `HowTo` and `BreadcrumbList` are cheap additions
   from data the page already has, and they are *generated from the visible content*, so they cannot drift into
   structured-data spam.
4. **Progressive loading with a documented reason.** `scripts/copy-vendor.mjs` copies only `qpdf.js` + `qpdf.wasm` to
   `public/vendor/qpdf` and loads them by `<script>` on demand for encrypt/decrypt/permissions only, because the
   Emscripten UMD build pulls Node `fs`/`path` branches when bundled
   ([copy-vendor.mjs](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/scripts/copy-vendor.mjs)).
   This is an independent confirmation of `ARCHITECTURE.md` §5's loading rule — cite it in `docs/VERIFICATION.md`.
   Its per-category `registry.ts` lazy `import()` per tool is the same idea one level up, but is not applicable to a
   no-bundler site; ToolSeer's equivalent is a dynamic `import()` of `core/engines.js` from the tool page after the
   user's first interaction, which keeps Tesseract's ~8 MB model off first paint.
5. **`utif2` (MIT) for TIFF input.** `kiss-the-pdf` declares `utif2 ^4.1.0` alongside the PDF engines; its licence is
   MIT ([npm](https://registry.npmjs.org/utif2/latest)). Phase-1 `/image-to-pdf` currently has no TIFF path
   (`ARCHITECTURE.md` §4 accepts images generally). If the owner wants scanned-document input parity with the
   competition, this is a permissive, small (≈105 KB unpacked) addition — a decision for the Lead, not a change I can
   make in this document.
6. **Cloudflare Pages specifics, already public and platform-documented, but worth pinning in the repo.** Keep
   `_headers` and `_redirects` under the publish root (ToolSeer: `apps/web/`), and remember `_redirects` cannot match
   query strings — the legacy Blogger redirects in `ARCHITECTURE.md` §3 must therefore be path-based, with any
   query-string legacy URL handled by a Pages Function ([pdfkoi README](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/README.md)).

## 7. Anti-patterns observed (do not import these)

| Anti-pattern | Where | Why it matters to ToolSeer |
|---|---|---|
| SEO copy asserting an engine technology that the code does not use ("merging engine … powered by client-side WebAssembly") | `src/config/tools.ts`, `merge-pdf` entry ([tools.ts](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/src/config/tools.ts)); contradicting evidence in [copy-vendor.mjs](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/scripts/copy-vendor.mjs) | Violates `PROJECT_DIRECTIVE.md` §د.5 / `ARCHITECTURE.md` §7.6. Every "powered by WASM" claim ToolSeer makes must name the engine that actually does the work. |
| Registry entries left as unfilled template filler | `src/config/tools.ts`, `watermark-pdf` entry (generic FAQ: "Is this Watermark PDF tool free? Yes…") | Scales to 100 pages of thin content; ToolSeer's 150-word accuracy rule is the guard. |
| Shipping an AGPL binary in the deployable static output | `public/coherentpdf.browser.min.js` ([tree](https://api.github.com/repos/pdfkoi/pdfkoi/git/trees/main?recursive=1)) with package licence `AGPL-3.0-or-later` ([npm](https://registry.npmjs.org/coherentpdf/latest)) | `apps/web/vendor/**` must be a licence-whitelisted, checksummed directory (`ARCHITECTURE.md` §7.2): permissive licences only, licence file beside every binary. |
| Two pinned generations of the same engine in one app | `pdfjs-dist ^4.8.69` **and** `pdfjs-dist-legacy` (= `pdfjs-dist@^2.16.105`) ([package.json](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/package.json)) | Doubles the review surface and the bundle; ToolSeer pins exactly one `pdfjs-dist` (6.x). |
| Assuming an open-source project's licence from its README/stars | Stirling-PDF's GitHub licence field is `NOASSERTION` while the README says "open-source" ([API](https://api.github.com/repos/Stirling-Tools/Stirling-PDF), [README](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/README.md)) | The 93 k-star project in the directive is no longer plain MIT. Read `LICENSE` **and** every subdirectory `LICENSE` before vendoring. |

## 8. Sources (all fetched 2026-10-06)

**kiss-the-pdf** — [API metadata](https://api.github.com/repos/positiveabhii/kiss-the-pdf) ·
[LICENSE](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/LICENSE) ·
[package.json](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/package.json) ·
[README](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/README.md) ·
[ARCHITECTURE.md](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/ARCHITECTURE.md) ·
[next.config.ts](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/next.config.ts) ·
[src/config/tools.ts](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/src/config/tools.ts) ·
[src/app/(app)/[tool]/page.tsx](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/src/app/(app)/%5Btool%5D/page.tsx) ·
[organization/registry.ts](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/src/features/tools/organization/registry.ts) ·
[scripts/copy-vendor.mjs](https://raw.githubusercontent.com/positiveabhii/kiss-the-pdf/main/scripts/copy-vendor.mjs) ·
[releases](https://api.github.com/repos/positiveabhii/kiss-the-pdf/releases) ·
[full tree](https://api.github.com/repos/positiveabhii/kiss-the-pdf/git/trees/main?recursive=1)

**pdfkoi** — [API metadata](https://api.github.com/repos/pdfkoi/pdfkoi) ·
[LICENSE](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/LICENSE) ·
[package.json](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/package.json) ·
[README](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/README.md) ·
[next.config.js](https://raw.githubusercontent.com/pdfkoi/pdfkoi/main/next.config.js) ·
[src/config listing](https://api.github.com/repos/pdfkoi/pdfkoi/contents/src/config) ·
[full tree](https://api.github.com/repos/pdfkoi/pdfkoi/git/trees/main?recursive=1) ·
upstream [PDFCraftTool/pdfcraft](https://api.github.com/repos/PDFCraftTool/pdfcraft) and its [releases](https://api.github.com/repos/PDFCraftTool/pdfcraft/releases)

**Stirling-PDF** — [API metadata](https://api.github.com/repos/Stirling-Tools/Stirling-PDF) ·
[LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/LICENSE) ·
[engine/LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/engine/LICENSE) ·
[frontend/editor/src/desktop/LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/frontend/editor/src/desktop/LICENSE) ·
[frontend/editor/src/proprietary/LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/frontend/editor/src/proprietary/LICENSE) ·
[v0.46.2 LICENSE](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/v0.46.2/LICENSE) ·
[README](https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/main/README.md) ·
[releases](https://api.github.com/repos/Stirling-Tools/Stirling-PDF/releases) ·
[docs: Paid Offerings](https://docs.stirlingpdf.com/Paid-Offerings/) ·
[discussion #4332 "License change v0.46.2 to v1.0.0"](https://github.com/Stirling-Tools/Stirling-PDF/discussions/4332)

**Licence verification (npm registry metadata)** — [pdf-lib](https://registry.npmjs.org/pdf-lib/latest) ·
[pdfjs-dist](https://registry.npmjs.org/pdfjs-dist/latest) · [jszip](https://registry.npmjs.org/jszip/latest) ·
[tesseract.js](https://registry.npmjs.org/tesseract.js/latest) ·
[@neslinesli93/qpdf-wasm](https://registry.npmjs.org/@neslinesli93/qpdf-wasm/latest) ·
[coherentpdf](https://registry.npmjs.org/coherentpdf/latest) · [utif2](https://registry.npmjs.org/utif2/latest) ·
[PyMuPDF](https://api.github.com/repos/pymupdf/PyMuPDF)
