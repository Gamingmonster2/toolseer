# icons/ — REQUIRED BEFORE `cargo tauri build`

⚠ These files do not exist yet. `cargo tauri dev` works without them; `cargo tauri build` fails, and
Tauri's own error message points at `bundle.icon` but not at what the sizes should be. Hence this note.

`tauri.conf.json` expects exactly these four:

| File | Size | Purpose |
|---|---|---|
| `32x32.png` | 32×32 | taskbar / small icon |
| `128x128.png` | 128×128 | Explorer, Start menu |
| `128x128@2x.png` | 256×256 | high-DPI Explorer |
| `icon.ico` | multi-size ICO (16, 32, 48, 256) | the Windows executable and the installer |

## Where they come from

The brand artwork is owned by the mascot/design task (`apps/web/assets/img/mascot/**`, and the brand
document). Do not invent a separate mark here: the app icon must match the site's logo or the two
channels look like different products.

The Tauri CLI can generate the whole set from one square PNG:

```
cargo tauri icon path/to/logo-1024.png
```

That writes into `src-tauri/icons/` and needs a source image of at least 1024×1024 with no transparency
artefacts at the edges. It requires the CLI, i.e. a machine with Rust.

## Design constraints nobody remembers until review

* Recognisable at 16×16. Thin strokes and small text disappear; a single bold silhouette survives.
* A transparent background looks wrong in the Windows taskbar on light themes — give the mark a
  contained shape (a rounded square) with its own background.
* The brand primary from the design system is `--ts-primary: #0040ff`. The taskbar is dark in the
  default Windows theme, so the icon should not also be dark-on-dark.

## One more thing that must be replaced at release

`bundle.publisher` is the string `"ToolSeer"` in `tauri.conf.json`, and there is no code-signing
certificate configured. An unsigned installer named by an unverified publisher is what produces the
"Windows protected your PC" prompt. See the distribution section of `docs/DESKTOP.md`.
