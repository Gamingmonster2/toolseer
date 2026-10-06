# Tool page guide — the exact recipe for building a ToolSeer tool page

Read `docs/ARCHITECTURE.md` first for the why. This file is the *how*, and it is precise on purpose:
several agents build tool pages in parallel and they must come out identical in structure.

The reference implementation is **`apps/web/image-to-pdf/index.html`**. When in doubt, open it and copy
its shape. Do not invent a new structure.

---

## 1. File layout for one tool

```
apps/web/<slug>/index.html      ← everything for that tool lives in this one file
```

One file per tool, containing: head metadata, JSON-LD, static editorial content, and one
`<script type="module">` that calls `defineTool()`. There is no per-tool CSS and no per-tool JS file.
That is deliberate: it keeps each tool page a single write scope for a single agent.

## 2. Non-negotiable page skeleton

```html
<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>…</title>                                  <!-- ≤ 60 chars, tool name first -->
  <meta name="description" content="…">             <!-- 140–160 chars, no fluff -->
  <link rel="canonical" href="https://toolseer.com/<slug>">
  <meta name="theme-color" content="#0040ff">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <!-- og:type, og:site_name, og:title, og:description, og:url, og:image -->
  <!-- twitter:card, twitter:title, twitter:description, twitter:image -->
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="stylesheet" href="/assets/css/toolseer.css">
  <script>/* the pre-paint theme/lang snippet — copy verbatim from the reference page */</script>
  <script type="application/ld+json">/* @graph: SoftwareApplication + BreadcrumbList + FAQPage */</script>
</head>
<body>
<a class="ts-skip-link" href="#ts-main">Skip to content</a>
<div class="ts-app">
  <div class="ts-support" id="ts-support"></div>
  <aside class="ts-rail" id="ts-rail" aria-label="Tool settings"></aside>
  <div class="ts-main">
    <header class="ts-header" id="ts-header"></header>
    <main class="ts-view" id="ts-main">
      <section class="ts-hero"> … h1 + sub + mascot img … </section>
      <div id="ts-tool" style="display:contents"></div>
      <section class="ts-prose"> … 300+ words of accurate explanation … </section>
      <section class="ts-faq"> … 4–6 <details> … </section>
      <section class="ts-prose"> … internal links to sibling tools … </section>
      <footer class="ts-footer" id="ts-footer"></footer>
    </main>
  </div>
</div>
<script type="module"> … defineTool({...}) … </script>
</body>
</html>
```

The chrome containers (`ts-support`, `ts-rail`, `ts-header`, `ts-footer`) are **empty on purpose** —
`toolkit.js` → `shell.js` fills them. Never hand-write header markup.

## 3. `defineTool()` — the full option set

```js
defineTool({
  slug: 'merge-pdf',              // required; must equal the folder name
  accept: 'application/pdf,.pdf', // <input accept>; also used to reject dropped files
  multiple: true,                 // false → replaces the current file
  minFiles: 2,                    // action button refuses below this
  maxFiles: 0,                    // 0 = unlimited
  maxFileSize: 0,                 // bytes, 0 = unlimited
  preview: 'rows',                // 'rows' | 'image' | 'pages' | 'none'
  dropIcon: 'stack',              // any key from assets/js/ui/icons.js
  emptyIcon: 'images',
  actionIcon: 'sparkle',
  bigJobHint: 60 * 1024 * 1024,   // show the desktop-app advisory above this total
  dropHint: 'Supports PDF up to …',// plain string shown under the drop title
  settings: [ /* see §4 */ ],

  async run({ files, settings, onProgress }) {
    // files: [{ id, name, size, type, file, url, asInput() }]
    //   asInput() → { name, bytes: Uint8Array, type }
    // settings: plain object of current control values
    // onProgress({ value: 0..1, label: 'text' })
    return {
      outputs: [{ name: 'x.pdf', bytes, type: 'application/pdf' }], // or omit for text tools
      text: 'optional plain text result',
      before: 1234, after: 567,     // optional, drives the "saved %" line
      warnings: ['optional advisory strings'],
    };
  },
});
```

### Rules inside `run()`

1. **Import the engine dynamically, never at the top of the module:**
   `const { mergePdfs } = await import('/assets/js/core/index.js');`
   A top-level import failure would leave the page blank with no error message; a dynamic import
   failure surfaces in the toolkit's error banner.
2. **Never build user-facing sentences.** Return engine error codes; the toolkit maps them to
   localised text. `onProgress` labels are the one exception and should use plain, short English
   (they are progress verbs, not content).
3. **Report progress honestly.** Reading N files should advance the bar; never fake 100% before the
   work is done. Cap at 0.95 until the bytes actually exist.
4. **Do not mutate `settings`.** Read it, convert ranges with `parsePageRanges()`, pass the rest through.
5. Read every file through `asInput()`; never touch `file.file` internals.

## 4. Settings schema — the only control types that exist

```js
{ id, type:'select',   default, options:[{value, labelKey?}], hintKey?, labelKey? }
{ id, type:'segment',  default, options:[{value, icon?, labelKey?}] }        // 2–3 buttons
{ id, type:'pills',    default, options:[{value, labelKey?, hintKey?}] }     // radio list
{ id, type:'switch',   default:boolean, hintKey? }
{ id, type:'range',    default, min, max, step, minLabelKey?, maxLabelKey? }
{ id, type:'text'|'password'|'number', default, placeholderKey?, min?, max? }
{ id, type:'select',   group:'Category name' }   // `group` starts a labelled group in the rail
```

Label resolution order: `labelKey` → `setting.<id>.label` → the raw key (visible, so it gets fixed).
Option label: `labelKey` → `opt.<value>`. Those keys already exist in
`assets/js/ui/i18n.js` for every option value listed in the project (a4, letter, portrait, lossless,
balanced, strong, png, jpeg, each, ranges, every-n, …). **If you need a new string, add it to both the
`EN` and `AR` dictionaries in `i18n.js`** — and if another agent owns that file in your wave, ask the
Lead instead of editing it.

## 5. SEO and content requirements (checked by `tools/check.mjs`)

- exactly one `<h1>`;
- `<title>`, `description`, `canonical`, `og:*`, `twitter:*` all present and non-empty;
- JSON-LD parses, contains `SoftwareApplication`, `BreadcrumbList` and `FAQPage`;
- the FAQ in the JSON-LD matches the visible `<details>` questions (they must not diverge — that would
  be structured-data spam);
- at least 300 words of prose that is **technically true**: explain what the operation actually does to
  the bytes, what it preserves, what it cannot do, and when a browser is the wrong tool;
- do not claim features the engine does not have. If a setting is cosmetic, say so.

## 6. Accessibility requirements

- every control has a real `<label>` (the toolkit does this for settings);
- the drop zone is keyboard reachable (the toolkit does this);
- progress is announced (`aria-live`) — the toolkit does this;
- decorative images get `alt=""` plus `aria-hidden="true"`;
- colour contrast: use the tokens, never hand-picked hex values.

## 7. Self-check before you call your task complete

```powershell
node tools/check.mjs --only <your-slug>     # structure + SEO + JSON-LD + asset existence
node --check <file>                          # only for .js; HTML has no checker
```

Then re-read your own page in a text editor and ask: *if I were a user who knows PDFs, would any
sentence here be wrong?* If yes, fix it before finishing.
