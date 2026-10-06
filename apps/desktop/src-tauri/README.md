# src-tauri — directory notes

⚠ **UNVERIFIED SCAFFOLD.** Everything under `apps/desktop/` is unbuilt and untested: Rust/cargo is not
installed on the machine where it was written and installing it was not approved. Nothing here has
been compiled, referenced against a real dependency tree, or run.

These notes exist because the two files that most need comment — `tauri.conf.json` and
`capabilities/default.json` — are JSON, which cannot carry comments. Anything a reviewer would want to
read inline lives here instead.

## Why `frontendDist` points outside this directory

```json
"frontendDist": "../../web",
```

The window *is* the ToolSeer website UI. The site is a static, bundler-free HTML/CSS/ES-module
codebase (see `docs/ARCHITECTURE.md` §1), so Tauri can serve it directly — no second frontend, no
build step, no forked copy of the design system. The desktop app and the site therefore cannot drift
apart visually, which is the whole reason the owner asked for one product with two delivery channels.

Consequences worth knowing:

* `_headers` and `_redirects` are Cloudflare-only files. Tauri copies them into the bundle and ignores
  them. Harmless, not meaningful.
* The site's absolute asset paths (`/assets/js/...`) resolve against the custom-protocol root, which
  maps to the `frontendDist` directory. That is why they need no change for the desktop build.
* Any web-side change to the asset layout is a desktop change too. The `tools/check.mjs` gate that
  guards the site also guards this bundle by extension — which is a good argument for running it
  before every desktop release.

## Why `withGlobalTauri` is on

`"withGlobalTauri": true` exposes `window.__TAURI__` to the loaded pages. Without it the site would
need a bundler or an import map to call our commands, and the project's hard rule is no bundler
(`docs/ARCHITECTURE.md` §7). With it, a page only has to write:

```js
if (window.__TAURI__) { /* the desktop shell is present */ }
```

No import, no build step, no new dependency. The trade-off is that a global object exists on every
page; for an app that only ever loads our own local files from a custom protocol, that is an
acceptable trade. `apps/desktop/bridge/toolseer-desktop.js` is the reference implementation of the
calls the web UI would make — it is **not** loaded by the site today.

## The CSP, and the one clause that is weaker than we would like

```
default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost blob:;
worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self';
form-action 'none'; frame-ancestors 'none'
```

* `connect-src` allows **no remote origin at all**. The app cannot talk to a server even if some future
  code tried to: there is no engine server and there is no telemetry. This is the clause that matters
  most for the project's privacy rule, and it is enforced rather than promised.
* `'unsafe-inline'` in `script-src` is required because the frozen page contract has every tool page
  carry an inline `<script type="module">` (`docs/ARCHITECTURE.md` §6). Removing it would mean
  rewriting the page contract, which is outside this task. Recorded as a known weakness rather than
  quietly dropped.
* `'wasm-unsafe-eval'` is required by the vendored `qpdf.wasm` the web path uses.
* `ipc:` and `http://ipc.localhost` are how Tauri v2 delivers command calls on each platform.

**Not verified:** whether this exact string satisfies a real WebView2 session with the vendored
scripts loaded. It must be re-checked on the first build by watching the devtools console for CSP
violations — that is a five-minute job on a machine with Rust, and an unverifiable one here.

## Why there is no shell plugin permission

`capabilities/default.json` grants `core:default`, the dialog plugin and the opener plugin. It does
**not** grant `shell:allow-execute`, because the qpdf sidecar is spawned by our own Rust code with an
absolute path resolved from the bundle's resource directory. The webview never gets the ability to run
a program, which is a meaningfully smaller attack surface than the usual Tauri sidecar pattern.

## Instructions that are physically missing

`bundle.icon` lists four files. They do not exist yet — see `icons/README.md`. `cargo tauri dev` does
not need them; `cargo tauri build` will fail without them.
