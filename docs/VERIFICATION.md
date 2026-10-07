# Verification record — what was actually run, and what was not

This project was built by six agents in parallel, so verification is deliberately separated from
authorship: the gates below are mechanical, reproducible, and independent of the agent that wrote the
code. Every number in this file comes from a command that was executed, and the two bugs described in
§7 were found *by* these gates rather than by review.

---

## Summary of the final verification pass

| Gate | Command | Result |
|---|---|---|
| Static integrity | `node tools/check.mjs` | **404 checks, 0 problems** |
| Engine + UI tests | `node tests/run.mjs` | **101 passed, 0 failed** (84 engine + 17 toolbox UI) |
| Real browser | `node tools/e2e.mjs --convert image-to-pdf,merge-pdf,protect-pdf,extract-text-pdf` | **201 checks, 0 failed, across 19 routes** (recorded before the toolbox/PWA/OCR additions — see §8) |
| Vendor integrity | `node tools/vendor.mjs verify` | **216 files match `vendor.lock.json`** |
| Mascot geometry | `node tools/validate-mascots.mjs` | all checks pass (11 gecko SVGs; the rabbit set too) |
| OCR stack in a real browser | probe page driving `vendor/ocr/` over CDP | **OCR read a real 1920×8537 scanned page in 2.1 s** |
| Desktop engine pins | `node apps/desktop/tools/fetch-engines.mjs --check` | exit 0, 13 sources validated |

The tree was frozen before each pass; the git commits record the exact verified state.

---

## 0. Open verification item (read this first)

The browser gates need Chrome to start, and Chrome cannot start under the DSH `workspace-write`
file policy (crashpad cannot open its own process handles). **The sandbox mode changed mid-session**,
so the last full browser pass (201/201) predates the toolbox hub, the PWA layer, the gecko artwork,
the OCR wiring and the `_redirects`/`serve.mjs` placeholder fix. Those changes are covered by the
static gate (404 checks) and by targeted browser probes that ran while the wider mode was available,
but **the complete 19-route browser pass has not been re-run against the final tree.** Re-run exactly:

```powershell
node tools/e2e.mjs --shot --convert image-to-pdf,merge-pdf,protect-pdf,extract-text-pdf
```

One concrete symptom was observed and is still open: with the sign-in redirect emulation in
`serve.mjs` fixed, `--only privacy` passed 10/10 but `--only home` timed out on a `Runtime.evaluate`
while a debugger pause showed the main thread was **not** blocked and the console was clean. The
privacy route and the home route share `renderShell`; they differ by the toolbox and the PWA module.
That is the first thing the re-run should bisect if it reproduces.

## 1. Static integrity gate — `node tools/check.mjs`

404 checks across every route. What it proves without a browser:

| Area | Check |
|---|---|
| Route inventory | hub + 10 tools + `/desktop` + privacy/terms/works/contact all exist |
| SEO structure | exactly one `<h1>`; title ≤ 70 chars; description 90–200 chars; canonical matches the slug |
| Social tags | `og:type/site_name/title/description/url/image` and `twitter:card/title/description` non-empty |
| Structured data | JSON-LD parses; `SoftwareApplication` + `BreadcrumbList` + `FAQPage` on tool pages; `WebSite` + `FAQPage` on the hub |
| FAQ honesty | FAQPage JSON-LD questions are compared against the visible `<details>` summaries after normalisation — any divergence fails |
| Privacy rule | any `https://` script, stylesheet or image fails the gate (no runtime CDN, no tracker) |
| Asset integrity | every local `src`/`href` resolves to a real file |
| i18n completeness | every referenced key exists, and EN/AR dictionaries have identical key sets (250/250) |
| Engine syntax | `node --check` on every `.js`/`.mjs` under `apps/web/assets/js` |
| Vendor integrity | every vendored file matches its recorded sha256; licences must be MIT/ISC/Apache-2.0 |
| Content volume | ≥ 300 words of prose on every tool page |

## 2. Engine tests — `node tests/run.mjs` (84/84)

Zero-dependency runner; all fixtures are generated at runtime (pdf-lib for PDFs, hand-built encoder for
JPEG/baseline, `zlib`+CRC32 for PNG) — **no binary fixture is committed**. Oracles are deliberately
foreign to the engine: raw pdf.js for page counts, `qpdf --check` for document validity, a real
`qpdf --decrypt` attempt for "is it really protected?", and the `/P` bits of the encryption dictionary.

Coverage by file: `core-util` (16) — range grammar edge cases, `formatBytes`, `pdfInfo`, ES2025 shims;
`core-pdf` (30) — merge order/count, split by each/ranges/every-n, organize reorder+rotate+drop,
`imagesToPdf` geometry, `zipFiles`; `core-qpdf` (21) — protect/unlock round-trips, wrong password,
owner-password-only files, all three compression levels, metadata stripping; `core-render` (17) —
text extraction order/layout/subset, `pdfToImages` dpi/format/quality, `renderThumbnails`, and feeding
rendered pages back into `imagesToPdf`.

One test asserts the published surface still matches the frozen contract in `docs/ARCHITECTURE.md §4`,
so an accidental rename fails the suite rather than silently breaking a page.

## 3. Real browser gate — `node tools/e2e.mjs`

Headless Chrome 154 driven over the DevTools Protocol by `tools/e2e.mjs`, using only Node's built-in
`fetch` and `WebSocket` — no Playwright, no Puppeteer, no npm.

**Per-route checks (201 total, 0 failures):** shell mounts, title present, exactly one `<h1>` on every
route, all shell containers, toolkit mounts and renders its settings controls, no broken images, the
dark-theme control actually flips `data-theme`, the language control actually switches language and
flips `dir` to `rtl` for Arabic, and **zero console errors, zero failed requests, zero page exceptions**
on all 15 routes.

**Real conversion suites** — each drives the actual UI (file injected into the real `<input type=file>`
via `DOM.setFileInputFiles`, the real run button clicked, the real download captured to disk and then
inspected with independent tooling):

| Suite | What it proves | Result |
|---|---|---|
| `image-to-pdf` | PNG → PDF; downloaded bytes start `%PDF-`, 1 page | 9/9 |
| `merge-pdf` | two PDFs (2 + 3 pages) → one PDF; page count re-read with pdf-lib = 5 | 6/6 |
| `protect-pdf` | **qpdf-wasm loads as a classic script in a real browser** and produces a genuinely encrypted file (`/Encrypt` dictionary present) | 6/6 |
| `extract-text-pdf` | **the pdf.js module worker runs in a real browser** and recovers every page marker | 3/3 |

These four suites exist because they cover the four seams that Node *cannot* reach: canvas rendering,
multi-document assembly, the Emscripten/classic-script loading path, and the Web Worker path.

## 4. Independent agent checks

| Artifact | Command | Result |
|---|---|---|
| Mascot SVGs (11) | `System.Xml.XmlDocument.Load` on each file | 11/11 parse; namespace + viewBox correct |
| Mascot theme contract | `node tools/validate-mascots.mjs` | paints limited to `currentColor` / `var(--ts-primary,#0040ff)`; geometry gates green |
| Vendor fetch/extract | `node tools/vendor.mjs install` + `verify` | 209 files, all hashes matched |
| Desktop engine pins | `node apps/desktop/tools/fetch-engines.mjs --check` | exit 0, 13 sources, pins validated |
| Desktop JS | `node --check` on both `.js` files | exit 0 |

## 5. Bugs these gates caught (not found by reading code)

1. **Security: a "protected" PDF that opened with no password.** The first `protectPdf` followed qpdf's
   documented advice and passed `--allow-insecure` when the user password was non-empty and the owner
   password empty; the resulting file opened without any password — measured, not theorised. Fix: the
   empty owner password is filled with the user password (the PDF-spec rule), `--allow-insecure` is
   never passed, and every protect now *proves* non-bypassability with a passwordless decrypt attempt.
   A permanent test covers it.
2. **A blank home page.** `_redirects` opened with the rewrite rule `/ / 200`; the preview server
   treated it as a redirect and served an empty body, so the hub rendered nothing. The E2E gate failed
   the route, and the server now implements rewrite semantics.
3. **Invisible page breaks in extracted text.** The engine separates pages with `\f` (the `pdftotext`
   convention, and correct), but HTML collapses form feeds, so a multi-page extraction read as one
   run-on paragraph. The UI now renders visible page markers.
4. **Two false negatives in the tooling itself** — both fixed: `check.mjs` captured `node --check`
   through a pipe (EPERM under a confined sandbox, flagging every JS file), and the E2E result-waiter
   only recognised file results, not text results.

## 6. What is NOT verified (stated plainly)

1. **Human visual judgement.** No agent here could view a rendered page (the model has no image input).
   Screenshots for every route, light and dark, are in `.screenshots/` — they exist so a human can
   compare the result against `design/reference-ui.png`. Layout, contrast and CSS are verified by
   construction and by the DOM/token checks, not by eye.
2. **The desktop binary.** `apps/desktop` is a scaffold. Rust/cargo is not installed on this machine,
   so nothing there has been compiled, packaged or run; `docs/DESKTOP.md` labels every figure as an
   estimate and lists the 12-step plan that would prove it.
3. **OCR.** Deliberately deferred: no language data is vendored, the engine throws
   `ToolError('ocr-unavailable')`, and the extract-text page states this rather than advertising a
   feature that would fail.
4. **Enormous files** (1000 images, 700 pages). The browser memory ceiling and the desktop streaming
   path are both described as estimates; neither was measured on real files of that size.
5. **The pdf.js legacy build caveat.** pdf.js 6.4.299 calls `Uint8Array.prototype.toHex`,
   `Map.prototype.getOrInsertComputed` and `Math.sumPrecise`; `engines.js` installs guarded shims, but a
   real Worker thread cannot be shimmed from the main thread. It works in the tested Chrome 154; older
   browsers may need the vendored *legacy* build.

## 7. Reproduce everything

```powershell
node tools/vendor.mjs verify          # 209 engine files match their pinned hashes
node tools/check.mjs                  # static integrity gate  → 355 checks
node tests/run.mjs                    # engine suite            → 84 tests
node tools/make-icons.mjs             # regenerate favicon / apple-touch / OG raster assets
node tools/serve.mjs 4173             # preview → http://127.0.0.1:4173/
node tools/e2e.mjs --shot             # browser gate + screenshots (needs a Chrome-capable sandbox)
node tools/e2e.mjs --convert image-to-pdf,merge-pdf,protect-pdf,extract-text-pdf
```

> **Sandbox note.** The browser gate needs Chrome to start. Under the DSH `workspace-write` file policy
> Chrome's crashpad cannot open its own process handles (`OpenProcess: Access is denied`) and its mojo
> platform channel is refused, so no browser can run and the gate cannot be executed in that mode. The
> recorded runs were made with the wider policy; re-running after any change to `apps/web/**` requires
> the same.
>
> The harness now narrates its steps (`· home: toolbox search`, …) and every CDP call has a 20 s
> timeout that names the step it was in. That was added because a run can die on a stall and the
> report previously said only `Runtime.evaluate`, which is not enough to bisect with. **It has not yet
> been used to re-run the failing home route** — the first thing to do when a browser is available
> again.
