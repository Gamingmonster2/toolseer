# Best practices for the problems this project actually hit

The rule the owner set: do not reinvent the wheel — find how the established
projects solved each failure and build on that. This file records, per error, what
the industry does, the source, and what this project now does. Nothing here is
original research; the value is in matching our specific failures to known answers.

---

## Error 1 — a file download that is refused on a phone

**What we saw:** converting on Android produced no file, or the previous file, and
the OS asked "download this again?".

**What the platform actually does.** A navigation that carries the `download`
attribute — which is what a blob-URL download is — **never reaches a service
worker's `fetch` handler at all**. [Chromium issue 40410035](https://issues.chromium.org/issues/40410035)
documents this explicitly for "Save link as", "Save image as" and `<a download>`
links. So no cleverness inside our own service worker can rescue that path; the
request is outside the pipeline we control.

**What the alternatives really are.**

| Option | Verdict |
|---|---|
| `showSaveFilePicker()` (File System Access API) | **Desktop-only.** [Feature support](https://web-platform-dx.github.io/web-features-explorer/features/file-system-access/) — and even on desktop the picker [needs a user gesture](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/fileordirectorypickerwithoutgestureallowedfororigins). Not a mobile answer. |
| `navigator.share({ files })` | The documented mobile route, but it must be inside a gesture and behaviour in an *installed* app is inconsistent — we tested it: WhatsApp received nothing. Removed at the owner's request. |
| Progressive download streams ([DiskWriterJS](https://github.com/wcroachie/DiskWriterJS)) | Interesting for very large outputs, still ultimately a download. |
| **Write the file natively, through the OS** | **What the ecosystem actually does in an app** — see [Capgo on Android scoped storage](https://capgo.app/blog/android-scoped-storage-in-capacitor-apps/). No download manager is involved, so nothing can be refused or hidden. |

**What this project does now.** `assets/js/ui/native-save.js` detects the app's own
bridge (`ToolSeerNative.saveBase64`) and hands the bytes to Kotlin, which writes into
the public **Documents** collection through MediaStore and then opens the system
viewer. The website keeps the ordinary download and, on top of it, a real anchor the
user can tap — a tap on a real anchor is always honoured because the gesture is the
user's own.

---

## Error 2 — loading our own files into a WebView

**What we saw:** we needed `assets/` served so ES modules, `fetch` and storage all
behave as they do on the real site. A `file://` URL is an opaque origin and modules
fail there.

**What the platform does.** Android's own guidance is
[Load in-app content](https://developer.android.com/develop/ui/views/webapps/load-local-content),
which is built around **`WebViewAssetLoader`**
([reference](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader)):
serve the APK's assets on the reserved `https://appassets.androidplatform.net/` origin
so the page runs on a secure origin like a real site.

**What this project does now.** `MainActivity.shouldInterceptRequest` implements the
same convention with no extra dependency: the reserved host, correct MIME types per
extension, and the site's directory routes (`/merge-pdf` → `merge-pdf/index.html`).
Moving to `androidx.webkit` later would add range requests and streaming for free —
a candidate improvement, not a defect.

---

## Error 3 — memory when the images are large

**What we saw:** "low memory" on a phone; and the deeper cause, finally found in the
owner's own legacy source: **never decode the pixels**.

**What the established tools do.**

- PDF writers such as **jsPDF** and **pdf-lib** embed JPEG bytes **verbatim**; pdf-lib
  also supports [streaming to the browser](https://devbytes.co.in/news/stream-pdfs-directly-to-the-browser-with-pdf-lib).
  The win is that the browser never allocates an RGBA buffer — a 12 MP photo would
  cost roughly 48 MB decoded, against a few MB embedded.
- **pdf.js** guidance for memory is to render **one page at a time** and release the
  canvas/page afterwards rather than holding every page's bitmap
  ([memory-management practice](https://skillsmp.com/creators/impertio-studio/pdfjs-claude-skill-package/skills-source-pdfjs-core-pdfjs-core-memory-management)).

**What this project does now.** `image-to-pdf` defaults to "Original size" — pure
pass-through, no decode. Resizing is opt-in and happens one image at a time with the
bitmap closed immediately. `render.js` renders a single page per canvas and releases
it (`releaseCanvas`) instead of accumulating pages. The low-memory advisory only
appears for a genuinely large full-resolution batch, because noise trains people to
ignore warnings.

---

## Error 4 — publishing to Google Play

**Two documented routes exist.**

1. **Trusted Web Activity** — Google's own codelab,
   [Add a PWA to Google Play](https://developers.google.com/codelabs/pwa-in-play), and
   the [chromeos/pwa-play-billing](https://github.com/chromeos/pwa-play-billing)
   sample. The wrapper loads the live site and requires **Digital Asset Links**
   (`/.well-known/assetlinks.json`) tying the app to the domain, so the site must stay
   reachable and identical to the store listing.
2. **A native shell that bundles the assets** — what this project built. No asset-links
   requirement, works fully offline, and the file-saving bridge replaces the download
   path that fails on Android.

**Why this project chose (2).** The failure being fixed is *inside* the browser's file
handling. A TWA is still the browser, so it would inherit the same problem; the shell
lets us call native code for exactly the one thing the browser cannot do.

---

## Error 5 — the mistakes that were ours, not the platform's

Worth recording so they are not repeated, since none of them needed research — they
needed a check:

| Mistake | Guard that now prevents it |
|---|---|
| Deploy config fought the redirect rules; every tool page went blank | `wrangler.jsonc` html_handling + a preflight check that fails on the conflict |
| `Set.forEach` visits entries added during iteration — the language button looped | a snapshot before notifying, plus `tests/ui-i18n.test.mjs` |
| Hub labels built in code were never checked | the gate now verifies every label the hub resolves, in both languages |
| A fixed output filename made the OS ask "download again?" | `stampName` with second precision |
| A download started outside a user gesture, on a mobile browser | no download without a tap; a real link beside the button |

---

## Standing rules that came out of this

1. **Prefer not to decode.** Structure-only work (page numbers, rotate, split,
   organize, metadata) is the safest class of tool in a browser.
2. **Any save path must work when the platform refuses.** A native writer in the app,
   a real anchor on the web.
3. **A failure must say what failed.** The diagnostics panel exists because "it does
   not work" cost a week.
4. **Read the legacy source before proposing a fix.** It had already solved the image
   path and the download path, a year earlier.
