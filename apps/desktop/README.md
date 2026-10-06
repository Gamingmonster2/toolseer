# ToolSeer Desktop — `apps/desktop/`

> ⚠ **UNVERIFIED SCAFFOLD — NOTHING HERE HAS EVER BEEN COMPILED OR RUN.**
> Rust/cargo is not installed on the machine where this was written, and installing it was not
> approved. So `cargo check`, `cargo build`, `cargo tauri dev` and `cargo tauri build` have not run
> once, not even to type-check. Treat every Rust file as a design document that happens to be written
> in Rust: correct in intent, unproven in fact.
>
> The one thing here that *has* been run is
> `node apps/desktop/tools/fetch-engines.mjs --check`, which validates `engine-manifest.json`. Its
> `--download` path has not been run either — it would pull ~32 MB of third-party binaries into the
> repository.
>
> Do not report this directory as "working", "done" or "tested" to anyone until a machine with Rust
> has built it and the smoke test in `docs/DESKTOP.md` has passed.

## What this is

A Windows desktop shell that does the jobs a browser tab cannot hold: a thousand images, a
seven-hundred page PDF. The window is the existing ToolSeer web UI; the work happens in two native
engines under permissive licences.

**It does not bundle Stirling-PDF.** That was the original plan and it was dropped for a licensing
reason, not a technical one: from v1.0 onwards Stirling-PDF is under a paid licence that forbids
redistribution. The full reasoning, the licence quotes and the three options open to the owner are in
`docs/DESKTOP.md` and in `engine-manifest.json` → `policy.excluded`. Read one of them before proposing
Stirling again.

## Layout

```
apps/desktop/
├─ engine-manifest.json          the pinned engine versions, URLs, sizes, sha256 values, the licence
│                                policy and the exclusions. Single source of truth; the website copies it.
├─ tools/fetch-engines.mjs       validate / verify / download the payload. `--check` runs anywhere.
├─ bridge/toolseer-desktop.js    reference bridge for the web UI (not loaded by the site today)
└─ src-tauri/
   ├─ Cargo.toml                 dependencies, with the licence-relevant notes inline
   ├─ tauri.conf.json            window, CSP, bundle, resources  (no comments possible in JSON: see README.md)
   ├─ README.md                  the constraints that belong next to the JSON
   ├─ capabilities/default.json  what the webview is allowed to call
   ├─ bundle/license-notices.txt third-party notices that ship in the installer (INCOMPLETE - see its header)
   ├─ icons/README.md            the four icon files that must exist before a build
   └─ src/
      ├─ lib.rs                  shell setup, self-check, window reveal
      ├─ commands.rs             the whole IPC surface (paths in, paths out)
      ├─ engine/                 manifest pins, qpdf runner, PDFium binding, scratch, zip writer
      └─ ops/                    merge · compress · security · render · images_to_pdf
```

## Prerequisites (a machine that has these)

| Need | Why | Note |
|---|---|---|
| Windows 10 21H2+ / 11 x64 | target platform | WebView2 comes with Windows 11 and almost all Windows 10 |
| Rust ≥ 1.90 (`rustup`, `x86_64-pc-windows-msvc`) | `tauri` 2.12.1 declares `rust_version = 1.90`; `image` and `printpdf` need 1.88 | not installed here |
| Visual Studio Build Tools 2022, "Desktop development with C++" | the MSVC linker and Windows SDK | not installed here |
| Tauri CLI v2 (`cargo install tauri-cli --version "^2"`) | `cargo tauri build` | no npm needed |
| Node ≥ 20 | only for `tools/fetch-engines.mjs` | node 24 is available here |
| ~2 GB free disk during the build | Rust `target/` + the payload | |

**No JDK, no JRE, no Java.** That is the point of the redesign: the previous architecture needed a Java
25 runtime and a 250 MB jar, and this one needs neither.

## Build steps, in order

```powershell
# 1. from the repository root
node apps/desktop/tools/fetch-engines.mjs --check        # no network: validates the pins
node apps/desktop/tools/fetch-engines.mjs --download     # ~32 MB, sha256-verified, extracted

# 2. icons must exist before a *build*; `dev` works without them
#    see src-tauri/icons/README.md

# 3. verify the payload is intact and record the extracted hashes
node apps/desktop/tools/fetch-engines.mjs --verify-only

# 4. run it
$env:TOOLSEER_PAYLOAD_DIR = "$PWD\apps\desktop\src-tauri\payload"   # lets a debug build find the payload
cargo tauri dev --manifest-path apps/desktop/src-tauri/Cargo.toml

# 5. build the installer -> apps/desktop/src-tauri/target/release/bundle/nsis/
cargo tauri build --manifest-path apps/desktop/src-tauri/Cargo.toml

# 6. rename for distribution, then publish to GitHub Releases
#    ToolSeer-Setup.exe  (stable name: the /desktop page links releases/latest/download/ToolSeer-Setup.exe)
#    ToolSeer-Setup-1.0.0.exe  (versioned, for humans and for reproducibility)
```

Before step 4, do the **qpdf flag verification** in `src-tauri/src/engine/qpdf.rs` — the argv
spellings there are marked `VERIFY` and have never been run against a real binary.

## Running the bundled UI without building the shell

The desktop window is the website (`frontendDist: "../../web"`), so the quickest way to look at the UI
that will ship inside the app is to serve the site and open it in a normal browser:

```powershell
# from the repository root - this is the repo's own zero-dependency static server
node tools/serve.mjs
```

Open whatever URL that script prints. Two caveats, both worth knowing before you conclude something is
broken:

* `tauri.conf.json` sets `devUrl` to `http://127.0.0.1:8788`, so if `tools/serve.mjs` defaults to a
  different port, either pass it the matching port or change `devUrl`. The two must agree for
  `cargo tauri dev` to load the live site instead of the bundled copy.
* In a plain browser there is no `window.__TAURI__`, so every native command is unavailable by design.
  The UI should show its browser behaviour in that case, which is a useful check of the "one product,
  two channels" idea — but it tells you nothing about the native engine.

## What this build can and cannot do

Stated here because it will otherwise be discovered by a user and reported as a bug. The app surfaces
the same two lists at runtime through `app_info()`.

**Implemented:** merge · split (each page / ranges) · organize (reorder, rotate, delete) ·
protect (AES-256/128, RC4) · unlock · lossless structural compression · PDF to images (PNG/JPEG, page
by page, optional native ZIP) · extract text · images to PDF (streamed, one decode at a time).

**Not implemented:** lossy "balanced"/"strong" compression, which needs image downsampling —
the engine refuses those levels with a clear message rather than silently doing something weaker;
native OCR (**OCR stays in the webview**, via the tesseract.js the site already lazy-loads);
Office/Word conversion (that was a Stirling feature and it is gone with Stirling).

## Licence obligations that are easy to forget

The installer redistributes qpdf (Apache-2.0) and PDFium (BSD-3-Clause, whose own LICENSE aggregates
further component licences). `src-tauri/bundle/license-notices.txt` ships inside the installer and is
**intentionally incomplete** — it lists what must be added before release and why. A release that skips
that step is distributing other people's code without their notices.
