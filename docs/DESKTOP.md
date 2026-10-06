# ToolSeer Desktop — why, how big, how it ships, and what could go wrong

> **Status: design + unbuilt scaffold.** `Rust`/`cargo` is not installed on the machine this was
> written on and installing it was not approved, so **no part of `apps/desktop/` has been compiled,
> built, installed or run.** Every Rust file there is an unverified scaffold, and every size and time
> figure in this document is labelled either **measured** (copied from a published artifact's metadata)
> or **estimate**. Nothing here is a benchmark result, because no benchmark was possible.
>
> What *was* run: `node apps/desktop/tools/fetch-engines.mjs --check` (manifest/pin validation, exit 0).
> Everything else about the desktop app is a plan.

---

## 1. The decision this architecture is a consequence of

The owner's directive (§2) specified wrapping **Stirling-PDF** in Tauri and publishing the result as a
Windows app. Work on that stopped because of a licence, and the licence is the first thing a reader of
this document needs, because it changes both the size and the shape of the product.

The blocker, verified by reading the licence files themselves rather than the repository badge:

* `Stirling-Tools/Stirling-PDF` at tag `v3.1.0` has a root `LICENSE` that is MIT **only for content
  outside a set of carve-out directories**. `app/proprietary/`, `app/saas/`, `engine/` and several
  `frontend/editor/src/*` trees each carry their own licence, and the released jar is built from those
  trees.
* `engine/LICENSE` at that tag is the **"Stirling PDF User License"**, which states: *"Production use
  of the Stirling PDF Software is only permitted with a valid Stirling PDF User License"*, and lists
  among prohibited actions: *"Copy, merge, distribute, sublicense, or sell the Software"*, with
  derivative works that *"may not be distributed or sublicensed"*.
* GitHub's licence detector reports the repository as **NOASSERTION**, which is consistent with that.

"Bundle the engine in our installer and publish the installer on GitHub Releases" is distributing the
Software. That is the prohibited action, so the plan as written cannot be executed.

**The three legal paths, for the owner to decide between:**

| | Path | What it costs | What it gets |
|---|---|---|---|
| **i** | Buy a Stirling PDF User Licence, or ask Stirling PDF Inc. for written redistribution permission | Money, and a conversation with a third party; typically a per-user subscription, which a free desktop app cannot absorb | Stirling's full engine: 60+ operations, mature OCR and Office conversion, their maintenance |
| **ii** | Ship the frozen MIT engine, **v0.46.2 or earlier** (its `LICENSE` is plain MIT, verified) | A 2024 codebase, frozen forever: no upstream security fixes, no upstream bug fixes, and a growing gulf from the current engine | Speed: the original plan, almost unchanged, with a Java runtime and a ~250 MB jar |
| **iii** | **Build the clean Rust engine stack — what this scaffold does** (recommended) | Engineering time to reimplement the ten Phase-1 tools natively; no Office conversion; OCR stays in the webview | Roughly **8× smaller** download, no JVM, no server, no third-party build to trust for a 250 MB jar, and no licence question at all |

**Recommendation: (iii).** Not because the licences are scary, but because (iii) is the only option
where the thing we ship is the thing we own. It also happens to be by far the best answer to the
owner's actual requirement — big files on the user's own machine — which is a memory-streaming problem,
not a features problem. Option (i) remains open and if the owner wants Stirling's breadth more than he
wants the small download, this document's architecture can still front a licensed Stirling instance
later; what it cannot do is ship one for free.

---

## 2. Architecture

```
┌─ ToolSeer.exe (Tauri v2 shell, MSVC, ~10-20 MB) ───────────────────────────────┐
│                                                                               │
│  WebView2 window                          Rust side (one process)             │
│  ┌────────────────────────────┐           ┌─────────────────────────────────┐ │
│  │ the ToolSeer web UI        │  paths →  │ commands.rs  (the whole IPC)    │ │
│  │ (apps/web, unchanged,      │  ← paths  │ ops/  merge · compress ·        │ │
│  │  served from the bundle)   │  +progress│       security · render ·      │ │
│  │                            │           │       images_to_pdf             │ │
│  │ drop zone · settings ·     │           │ engine/  qpdf runner (child)    │ │
│  │ previews · i18n · themes   │           │          PDFium bind (in-proc)  │ │
│  └────────────────────────────┘           │          scratch · zip writer   │ │
│                                           └───────────┬─────────────────────┘ │
└───────────────────────────────────────────────────────┼───────────────────────┘
                                                        │ file paths only
                        ┌───────────────────────────────┴──────────────────────┐
                        │  qpdf.exe       (Apache-2.0)   structure: merge,     │
                        │                                split, reorder,       │
                        │                                encrypt, decrypt,     │
                        │                                lossless compress      │
                        │  pdfium.dll     (BSD-3-Clause) render page → file,   │
                        │                                text, page count      │
                        │  image + printpdf crates (MIT / Apache-2.0)          │
                        │                                images → PDF, streamed │
                        └──────────────────────────────────────────────────────┘
```

**Three decisions inside that picture are worth their own line:**

1. **The window is the website.** `frontendDist` points at `apps/web`, so the desktop app and the site
   share one UI, one design system and one i18n layer instead of forking. The site has no bundler
   (`ARCHITECTURE.md` §1), which is exactly what makes this possible: Tauri can serve the static files
   as they are. `withGlobalTauri: true` means a page detects the shell with `if (window.__TAURI__)`
   and calls commands — no import, no build step, no new dependency.

2. **No local server, no port, no JVM.** The previous design had a Spring Boot process on a loopback
   port, health-checked and supervised. This one has none of that: PDFium is loaded in-process from the
   DLL we ship, and qpdf is a child process invoked with argv and file paths. Port conflicts, firewall
   prompts, orphaned servers, health-check timeouts and the entire class of "the engine did not start"
   bugs are gone rather than mitigated.

3. **Paths in, paths out.** The webview sends absolute paths and receives absolute paths, byte counts
   and progress events. **File bytes never cross the IPC boundary.** This is the single most important
   line in the design, and it is what §3 is about.

---

## 3. Why this app exists: the browser memory ceiling, precisely

The owner's reason for wanting a desktop app was "a browser tab cannot process 1000 images or a
700-page PDF". That is correct, and it is worth writing down *where* the tab dies, because the answer
determines what the desktop path must do differently.

### Where the tab dies

**(a) Each rendered page is a raster, and rasters are large.** A PDF page is rendered into a canvas as
4 bytes per pixel (RGBA). A4 is 8.27 × 11.69 in:

| DPI | Pixels per A4 page | RGBA bytes per page |
|---|---|---|
| 72 | 595 × 842 ≈ 0.50 MP | **≈ 2.0 MB** |
| 150 | 1240 × 1754 ≈ 2.17 MP | **≈ 8.7 MB** |
| 300 | 2480 × 3508 ≈ 8.70 MP | **≈ 34.8 MB** |

*Arithmetic, not measurement — but it is arithmetic on numbers everyone can check.*

**(b) Seven hundred pages of that does not fit in one tab.**

| Export | Retained bytes if every page stays alive | Verdict |
|---|---|---|
| 700 pages @ 72 dpi | ≈ 1.4 GB | survives only if each canvas is released immediately |
| 700 pages @ 150 dpi | **≈ 6.1 GB** | past any browser tab's ceiling |
| 700 pages @ 300 dpi | **≈ 24.4 GB** | not close |

**(c) The ceiling itself is low single-digit gigabytes per tab.** V8's heap cap on 64-bit Chromium is a
few GB by default, and a `wasm32` linear memory — which is what the vendored `qpdf.wasm` uses — is
architecturally capped at 4 GB. Whatever the exact number on a given machine, the failure is not
"slow", it is a tab crash with an out-of-memory page, mid-job, after the user has waited.

**(d) A thousand images fails differently but just as hard.** Decoding a 12-megapixel photo to RGBA is
4000 × 3000 × 4 = **48 MB per image**; a thousand of them decoded together is 48 GB. Even holding only
the *encoded* originals — three to five megabytes each as `File`/`Blob` objects plus the object URLs
the UI creates for previews — is **3–5 GB retained**, and object URLs pin their bytes until they are
explicitly revoked. Add the output: building a ZIP in JS holds the whole archive in memory as it grows,
another 3–5 GB for this job.

**(e) The upload path has the same shape even when there is a server.** Sending those files as
`FormData` from a tab still means the bytes live in the JS heap first.

### What the desktop path does instead

| Concern | Browser tab | This desktop app |
|---|---|---|
| Page rasters | every page alive at once, or a preview grid of canvases | **one page at a time**: render → encode → write → drop the buffer |
| Where results live | blob URLs and a growing ZIP in memory | **the user's disk**, streamed, one file per page |
| JS heap ceiling | low single-digit GB, then the tab dies | JS holds a list of path strings (*est. under 1 MB for 10 000 files*) |
| Peak memory for a 700-page export @ 150 dpi | est. 6 GB and a crash | **est. 80–150 MB** (one 8.7 MB bitmap + encoder buffers + WebView2) |
| Peak memory for 1000 photos → PDF | est. 48 GB if decoded, 3–5 GB if not | **est. 50–120 MB** (one 48 MB decoded image at a time, JPEG streamed out) |
| Failure mode | tab crash, work lost | slow, or a clear "not enough disk space" |

The last row of the memory estimate matters: the numbers in the "desktop" column are **estimates**
derived from the raster arithmetic above plus typical encoder overhead, not measurements. The
mechanism, however, is not an estimate — it is enforced by the code shape: `ops::render` renders a
page, writes it, and lets the bitmap drop before the next iteration; `ops::images_to_pdf` decodes one
image per loop iteration; `Scratch` writes to a per-job directory on disk and removes it afterwards.

### One limit we chose to state rather than hide

The native ZIP writer (`engine/zipstore.rs`) does not implement ZIP64, so an archive is capped just
under 4 GiB and the writer **refuses** past ~3.9 GB instead of producing a file other tools misread. A
700-page 300-dpi PNG export can cross that line. When it does, the user keeps the folder of images and
gets a clear message — which is better than a corrupt download.

---

## 4. Size: what the user downloads

All figures below are **estimates** unless marked measured. The measured ones are the published
artifacts' own metadata.

| Component | In the installer | Installed on disk | Basis |
|---|---|---|---|
| `pdfium.dll` (revision `chromium/7881`) | **3,733,154 B ≈ 3.6 MiB** | est. 8–15 MB | **measured** (asset size); extracted size is an estimate |
| qpdf runtime (`qpdf.exe` + DLLs) | est. 10–20 MB | est. 25–40 MB | the measured `msvc64` installer is 13,596,592 B and the archive is 28,183,147 B, but the archive also carries headers and import libraries we do not ship |
| Tauri app + the vendored web UI | est. 10–20 MB | est. 15–30 MB | estimate (Tauri binaries plus the site's vendored engines) |
| NSIS + metadata overhead | est. 1–2 MB | — | estimate |
| WebView2 Runtime | **0 MB** — the Evergreen runtime is part of Windows 11 and present on the vast majority of Windows 10 devices; if missing, a ≈2 MB bootstrapper fetches it | shared with the OS | **measured** (Microsoft's own 2 MB figure) |
| **Total, recommended build** | **est. 35–50 MB** | **est. 60–110 MB** | sum of the above |
| Optional: native OCR (tesseract + language data) | +50 MB, and +not-measured language data | +100–200 MB | **measured** 50,175,248 B installer — *not shipped, see below* |
| *Abandoned design, for contrast:* JVM + Stirling-PDF jar | **est. 320–420 MB** | est. 450–600 MB | anchor: Stirling's own Tauri Windows MSI for the same release is **334,426,112 B ≈ 318.9 MiB** (measured) |

**Headline: ≈35–50 MB, against ≈320–420 MB for the architecture the licence blocker killed — roughly
eight to ten times smaller.** The saving is not clever engineering; it is the 250 MB Java jar and the
Java runtime that are no longer there. The blocker turned out to be a size win as well as a legal
necessity, and the owner should know that this is a side effect he is getting for free rather than a
feature that was optimised for.

**The lighter alternative, evaluated and rejected:** bundling the tesseract CLI for native OCR adds the
measured 50 MB installer plus language data, for a second OCR implementation alongside the tesseract.js
the website already lazy-loads (`ARCHITECTURE.md` §5). Its Windows build, which we examined, publishes
**no sha256 digest at all** in its release metadata — 50 MB of unsigned native code with nothing to
verify against. OCR therefore stays in the webview: same engine as the site, zero installer cost, one
fewer thing to trust. If offline OCR ever becomes a requirement, that trade-off is the one to revisit,
and `engine-manifest.json` → `engines.ocr.rejectedOption` records exactly what was examined so nobody
has to redo it.

---

## 5. RAM and start-up, honestly estimated

| | Estimate | Why |
|---|---|---|
| Idle (window open, no job) | **est. 120–250 MB** | WebView2 with the UI loaded, plus a Tauri process that has loaded no PDF yet |
| During a 700-page export | **est. 200–450 MB** | one page raster at a time (up to 34.8 MB at 300 dpi) + encoder + WebView2 |
| During 1000 images → PDF | **est. 150–350 MB** | one decoded image at a time (48 MB for 12 MP) + the PDF writer's buffers |
| Start-up to usable window | **est. under 2 s** | no server to boot, no JVM to warm; the self-check hashes a few MB and binds one DLL |

Compare with what the abandoned design implied: a Spring Boot application whose upstream documentation
asks for **at least 2 GB of RAM, 4 GB recommended**, with a JVM heap of up to 4 GB and a cold start
measured in seconds rather than milliseconds. The estimate above is a fraction of that, and the user
does not pay it twice.

---

## 6. What this build cannot do

Stated plainly, because these will otherwise appear as bug reports, and because the project's rule is
that nothing on the site may overstate what a tool does:

* **Lossy compression** ("balanced" / "strong") is **not implemented**. Only the lossless structural
  pass exists. The engine *refuses* the other two levels with an explicit message instead of quietly
  doing something weaker and labelling it "strong". Image downsampling via PDFium re-rendering is the
  Phase-2b task that fixes this.
* **OCR is not native.** It stays in the webview. Text extraction here reads the text layer; a scanned
  page correctly reports "no text layer" rather than pretending to have extracted something.
* **No Office/Word conversion.** That was a Stirling feature; it left with Stirling. It needs
  LibreOffice (est. +300–700 MB) and it is not in the Phase-1 tool list as a *desktop-only* capability.
* **Windows x64 only.** No macOS, no Linux, no ARM64 — the manifest pins a Windows x64 payload.
* **No auto-update.** `createUpdaterArtifacts` is `false` and no updater endpoint is configured,
  deliberately: Tauri's updater needs a signed `latest.json` and a minisign keypair that do not exist
  yet. Configuring an updater that cannot reach a real endpoint would be worse than none.
* **The Rust code has never been compiled.** This is the largest caveat in the document and it is not a
  figure of speech — see §9.

---

## 7. Distribution

### Which repository?

**The project's own monorepo — the same repository that hosts the website (`C:\toolseer`, published as
the ToolSeer repo) — using its GitHub Releases.** Not a separate repository, and no fork or vendored
copy of any engine: the two engine binaries are downloaded from *their* upstream release URLs, pinned
by version and verified by sha256.

**One honest gap:** the repository slug cannot be read from this machine. `git` is blocked in the build
environment and there is no `.git` directory in the workspace, so the owner must confirm the GitHub
`OWNER/REPO`. It appears in exactly one place — `release.repo` in `engine-manifest.json` — and the
build script **refuses to produce a release payload** while it still says `OWNER/REPO`.

### Release assets

Each release publishes:

| Asset | Purpose |
|---|---|
| `ToolSeer-Setup.exe` | the **stable** name. The `/desktop` page links `https://github.com/OWNER/REPO/releases/latest/download/ToolSeer-Setup.exe` — the constant name is what makes `latest/download` resolve at all |
| `ToolSeer-Setup-<version>.exe` | the same file with the version in the name, for humans and reproducible installs |
| `ToolSeer-Setup-<version>.exe.sha256` | so the download can be verified independently of the site |

### One place for the version

`apps/desktop/engine-manifest.json` is the single source of truth: engine versions, artifact URLs,
**sizes and sha256 digests**, the release repo, the stable download URL and the licence policy. It is
read three ways:

1. **by the app**, at compile time (`include_str!` in `engine/manifest.rs`), so a shipped installer can
   never disagree with the manifest it was built from;
2. **by the build script**, which refuses to download anything whose hash does not match;
3. **by the website's `/desktop` page**, via a byte-identical copy at `apps/web/desktop/engine-manifest.json`
   made by `tools/build.mjs` at deploy time. The site has no bundler and no runtime build, so the copy
   happens at publish; `tools/check.mjs` should assert the two files are identical, which stops the site
   ever advertising a version the app is not pinned to.

The page fetches that copy **same-origin** (no CDN, satisfying `ARCHITECTURE.md` §7 rule 5) and must
also hard-code the stable URL into the button so it still works with JavaScript disabled. That is a
handoff item, not something done here: `apps/web/**` is outside this task's write scope.

### Signing, and the prompt users will see

Nothing is code-signed and no certificate is configured. The consequence is concrete: Windows
SmartScreen will show *"Windows protected your PC"* for an unsigned, not-yet-reputable installer, and
some antivirus engines treat any fresh unsigned binary that way. Mitigations, in order of effect: buy
an OV or EV code-signing certificate and sign the installer at release (a timestamp URL is already
configured); submit the binary to Microsoft's and the major vendors' false-positive portals; keep the
sha256 published so cautious users can verify what they downloaded. This is a real cost — typically a
few hundred dollars a year plus a hardware token — and it belongs in the Phase-2 budget rather than
being discovered on launch day.

---

## 8. Build recipe, for a machine that has the prerequisites

Assumes Windows 10 21H2+ / 11 x64, Rust ≥ 1.90 (`rustup`, `x86_64-pc-windows-msvc`), Visual Studio
Build Tools 2022 with "Desktop development with C++", Node ≥ 20 and the Tauri CLI
(`cargo install tauri-cli --version "^2"`). **No JDK is needed** — that is the redesign.

```powershell
# 0. confirm the pins (no network, no writes) - this one runs even in a bare environment
node apps/desktop/tools/fetch-engines.mjs --check

# 1. fetch the payload: ~32 MB, sha256-verified while streaming, extracted into src-tauri/payload
node apps/desktop/tools/fetch-engines.mjs --download
node apps/desktop/tools/fetch-engines.mjs --verify-only

# 2. icons - required before a build, not before dev (see src-tauri/icons/README.md)
cargo tauri icon path/to/logo-1024.png

# 3. the qpdf argv check that MUST happen before the first release
#    every flag in src-tauri/src/engine/qpdf.rs is marked VERIFY; run the binary by hand and compare
apps/desktop/src-tauri/payload/qpdf/bin/qpdf.exe --help

# 4. develop: the site is served live from devUrl, the shell from the debug binary
node tools/serve.mjs            # from the repository root; port must match devUrl (8788)
cargo tauri dev --manifest-path apps/desktop/src-tauri/Cargo.toml
#    in a dev build the payload is found via resources; if not, point at it explicitly:
#    $env:TOOLSEER_PAYLOAD_DIR = "$PWD\apps\desktop\src-tauri\payload"

# 5. test and build
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo tauri build --manifest-path apps/desktop/src-tauri/Cargo.toml
#    -> src-tauri/target/release/bundle/nsis/ToolSeer_1.0.0_x64-setup.exe

# 6. publish (rename for the stable URL, then create the release with three assets)
#    ToolSeer-Setup.exe · ToolSeer-Setup-1.0.0.exe · ToolSeer-Setup-1.0.0.exe.sha256
```

Release checklist, in the order that catches the most expensive mistakes first:

1. `--check` and `--verify-only` pass;
2. the qpdf `VERIFY` step has been done against the pinned binary, and encrypt/decrypt output has been
   opened in a **third-party PDF reader**, not only in qpdf;
3. `src-tauri/bundle/license-notices.txt` no longer contains its "SCAFFOLD STATE" heading and the full
   Apache-2.0 text plus the PDFium aggregate licence are included;
4. the smoke test below passes;
5. the installer's sha256 is published next to it;
6. the site's copy of `engine-manifest.json` matches the app's byte for byte.

---

## 9. Verification plan — what has to be proven, and by whom

Nothing in `apps/desktop/` is verified. This is the list that turns it from a scaffold into a product,
written so it can be executed top to bottom on a machine with Rust:

| # | Check | Passes when |
|---|---|---|
| 1 | `cargo check` | it compiles at all — first real signal, and several `VERIFY` comments will need fixing here |
| 2 | `cargo test` | the argv-shape tests in `qpdf.rs`, the manifest tests in `manifest.rs` and the CRC-32 vector in `zipstore.rs` pass |
| 3 | `fetch-engines.mjs --download` then `--verify-only` | the extracted `qpdf.exe` and `pdfium.dll` exist and hash consistently across two builds |
| 4 | self-check | `engine_preflight()` reports four green rows, including that `pdfium.dll` actually **binds** (a revision mismatch fails here, not mid-job) |
| 5 | merge smoke | 3 PDFs → 1, opens in a third-party reader, page count correct |
| 6 | split smoke | 20-page PDF → 20 files, and the ZIP opens in Explorer |
| 7 | protect/unlock round trip | encrypt with AES-256 → opens with the password in a third-party reader → unlock → matches the original |
| 8 | **the job that justifies the app** | 700-page PDF → images at 150 dpi, watched in Task Manager: memory stays flat, the folder fills, no crash |
| 9 | **the other job** | 1000 images → PDF, same monitor, and the output opens |
| 10 | cancellation | cancel mid-export; no partial file is presented as finished, and the scratch directory is gone |
| 11 | the browser path, for contrast | the same 700-page export in a browser tab, to record *where* it dies — this is the number the whole product argument rests on and it has never been measured on this hardware |
| 12 | AV/SmartScreen | install the built MSI/EXE on a clean Windows VM and record what happens, signed and unsigned |

Checks 8, 9 and 11 are the three that decide whether this product keeps its reason to exist. They need
a build machine before anyone can run them, which is precisely why the honest current status is
"designed, not demonstrated".

---

## 10. Risk register

| # | Risk | Severity | Mitigation / status |
|---|---|---|---|
| 1 | **The owner has not yet chosen between the three licence paths** (§1). Everything here assumes (iii) | High — it is the whole design | Decision requested; the architecture can front a licensed Stirling instance later, so the work is not wasted if he picks (i). The one thing that cannot happen is shipping Stirling for free |
| 2 | **PDFium is a third-party build** (`bblanchon/pdfium-binaries`), not a Chromium-published Windows binary, and it statically includes FreeType, HarfBuzz, ICU, libjpeg-turbo, libpng, OpenJPEG, Skia and zlib | Medium-high | Releases are marked immutable and carry a build attestation; we pin the tag **and** the sha256; the aggregate licence must ship with it. Residual risk accepted for v1, and re-evaluating it means building PDFium ourselves, which needs the Chromium toolchain |
| 3 | **The pdfium-render binding revision is a trap.** The crate's `pdfium_latest` feature names revision **7881**; the newest PDFium release is **8086** | Medium | The manifest pins 7881 and records *why*, so the next person does not "helpfully" update the DLL alone. Bump crate and DLL together, then re-run the render tests |
| 4 | **Every qpdf argv in the code is unverified**, and qpdf's CLI syntax has changed across majors (`--encrypt` especially) | Medium | All flags are marked `VERIFY` in one file; the release checklist runs `qpdf --help` against the pinned binary and opens encrypted output in a third-party reader |
| 5 | **No code signing** → SmartScreen warnings and possible AV false positives | Medium | Budget a certificate; timestamp URL already configured; publish checksums; submit false positives. Until then, users see a warning, which costs downloads |
| 6 | **Pinned native engines have no update feed.** A CVE in qpdf, PDFium or any Rust dependency is ours to notice | Medium | `--check` refuses mutable URLs; a documented, deliberate bump procedure (version + sha256 + test run); a scheduled check for upstream releases is worth adding to CI |
| 7 | **The 4 GiB ZIP limit** (no ZIP64) | Low-medium | The writer refuses rather than corrupts; the user keeps the folder of images. Real fix is ZIP64 if large exports become common |
| 8 | **The web-side integration does not exist yet.** `apps/web/**` is out of this task's scope; today the site has no idea it is running inside a shell | Medium | The command surface and a reference bridge are written and documented (`bridge/toolseer-desktop.js`); the web task adds one `if (window.__TAURI__)` branch per tool page. Until then the desktop window shows browser behaviour with the native commands unused |
| 9 | **Lossy compression and Office conversion are missing**, and Stirling's feature list is a marketing asset the owner may have been counting on | Medium | Stated in §6 and surfaced at runtime by `app_info()`. Phase-2b can add downsampling; Office conversion would mean bundling LibreOffice (+est. 300–700 MB) and is a decision, not a task |
| 10 | **Something in the scaffold is simply wrong** — unverified code usually is | High, and expected | `cargo check` is the first step of the verification plan, and step 1 of the risk register is that this document currently describes intent, not fact |

---

## 11. Verdict, and the sequencing I would recommend

**Is it worth it? Yes — but for a narrower reason than "the browser cannot do it".**

The browser path is not broken: for the ten Phase-1 tools at ordinary sizes it is excellent, free to
host, private by construction and needs no install. What it cannot do is hold a big job in memory, and
that is not a bug to fix — it is what a browser tab is. The desktop app is worth building because it is
the *only* way to serve the two jobs the owner named, and because (iii) makes it small, JVM-free and
legally clean at the same time. What it is not worth is pretending it is a second product: it is one UI
with a native engine behind it, and every hour spent making the two channels look identical is an hour
well spent.

**Phase-2 sequencing:**

1. **Get the owner's licence decision** (§1). Everything else is conditional on it, and it is the only
   thing on this list that needs a human outside the team.
2. **Prove the toolchain**: `cargo check` → fix the `VERIFY` items → `cargo test`. Expect this to be
   the noisiest step; that is normal for unverified code and it is why it comes before any polish.
3. **Prove the two headline jobs** (checks 8, 9 and 11 in §9). If 700 pages at 150 dpi does not stay
   flat in memory, the architecture is wrong and this is the cheapest moment to find out.
4. **Wire the web UI** to the shell (one `if` per tool page, plus the four native-only behaviours:
   pickers, progress, cancel, "show in folder").
5. **Ship honestly**: the release checklist in §8, a `/desktop` page that shows the real size and the
   real sha256, and copy that claims only what §6 says is implemented.
6. **Then**, in order of value: lossy compression (it is what people mean by "compress"), a signed
   installer, and only after that an updater with a real signing keypair.

---

## 12. Sources for every external claim

Versions, sizes and licences in this document and in `engine-manifest.json` were read from these URLs.
Nothing in either file is a remembered version string.

| Claim | Source |
|---|---|
| Stirling-PDF `v3.1.0` assets, sizes, sha256; the Windows MSI at 334,426,112 B | `https://api.github.com/repos/Stirling-Tools/Stirling-PDF/releases/latest` |
| The Stirling PDF User License (production restriction, redistribution prohibition) | `https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/v3.1.0/engine/LICENSE` |
| v0.46.2 is plain MIT | `https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/v0.46.2/LICENSE` |
| Stirling's own Tauri desktop config (bundled jar + JRE), and its updater pointing at a `releases/latest/download/latest.json` URL | `https://raw.githubusercontent.com/Stirling-Tools/Stirling-PDF/v3.1.0/frontend/editor/src-tauri/tauri.conf.json` |
| Stirling's RAM sizing ("at least 2 GB, 4 GB recommended"), the 50 MB → 200–500 MB expansion figure, the disk-backed strategy for files over 50 MB, `JAVA_TOOL_OPTIONS -Xms/-Xmx` guidance, `/api/v1/info/status` | `https://docs.stirlingpdf.com/Production-Deployment-Guide/` and `https://docs.stirlingpdf.com/Configuration/Operations/Performance-Optimization/` |
| qpdf 12.4.2 assets, sizes, sha256; the release note claiming up to 30× better linearisation memory | `https://api.github.com/repos/qpdf/qpdf/releases/latest` |
| qpdf is Apache-2.0 | `https://raw.githubusercontent.com/qpdf/qpdf/v12.4.2/LICENSE.txt` |
| PDFium `151.0.7881.0` (revision `chromium/7881`) sizes, sha256, attestation, immutable release | `https://api.github.com/repos/bblanchon/pdfium-binaries/releases/tags/chromium%2F7881` |
| PDFium's aggregate licence (BSD-3-Clause + Apache-2.0 and components) | `https://raw.githubusercontent.com/chromium/pdfium/main/LICENSE` |
| GitHub reports PDFium as NOASSERTION | `https://api.github.com/repos/chromium/pdfium` |
| `pdfium-render` 0.9.4, `MIT OR Apache-2.0`, `pdfium_latest` → `pdfium_7881` | `https://crates.io/api/v1/crates/pdfium-render/versions` |
| `image` 0.25.10 `MIT OR Apache-2.0`; `printpdf` 0.12.8 MIT with `html` as its default feature | `https://crates.io/api/v1/crates/image/versions`, `https://crates.io/api/v1/crates/printpdf/versions` |
| Tauri 2.12.1 is the latest stable crate; 3.0.0-alpha.4 is an alpha; Rust 1.90 required | `https://crates.io/api/v1/crates/tauri` |
| WebView2: Evergreen is part of Windows 11, the bootstrapper is ≈2 MB, the Fixed Version runtime is over 250 MB | `https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution` |
| Tesseract is Apache-2.0; the examined Windows build (5.4.0.20240606, 50,175,248 B) publishes no sha256 | `https://api.github.com/repos/tesseract-ocr/tesseract`, `https://api.github.com/repos/UB-Mannheim/tesseract/releases/latest` |
