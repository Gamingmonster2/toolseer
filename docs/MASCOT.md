# ToolSeer Mascot &amp; Illustration System (v2 — the gecko)

**Status: shipped.** 11 standalone SVGs in `apps/web/assets/img/mascot/` + a brand glyph in
`apps/web/assets/img/brand/mark.svg` + the previous animal preserved as an alternate skin.

The character is a **gecko**. It is *not named* (see §3.2). The rabbit from v1 is kept
byte-for-byte in `mascot/alternates/rabbit/`, so the swap in §8 is reversible in one scripted pass.

Owner-facing summary: §3 argues the choice honestly and §9 is the verification record.

> ⚠️ **Two things to know before wiring this up**
> 1. **`<img src="…svg">` is light-mode-only.** `currentColor` and `var(--ts-primary)` cannot cross
>    into the separate document an `<img>` creates — see §5. Inlining the SVG fixes it with zero JS.
> 2. **The 16 px favicon cannot be a mascot file.** At 16 px the 120-unit stage makes the 3-unit
>    stroke 0.4 px. That is why `brand/mark.svg` exists as a solid-fill 64-unit glyph with nothing
>    thinner than 1.4 px at 16 px, and why it is gated separately in §9.

---

## 1. What is in this folder

| File | Purpose | Bytes |
|---|---|---|
| `base.svg` | The canonical character, neutral pose, no prop. The reference every other file is diffed against. | 2463 |
| `image-to-pdf.svg` | holding a page whose corner folds open into a photo (sun + mountains) | 2821 |
| `merge-pdf.svg` | carrying a three-page cascade | 2819 |
| `compress-pdf.svg` | a page squeezed by two arrows | 2833 |
| `split-pdf.svg` | scissors biting down a dashed cut line | 3070 |
| `protect-pdf.svg` | holding a closed padlock | 2706 |
| `unlock-pdf.svg` | holding a key by its bow | 2714 |
| `pdf-to-images.svg` | one page, an arrow, two picture cards | 3081 |
| `organize-pdf.svg` | two pages over a re-order arrow | 2897 |
| `extract-text-pdf.svg` | a text page under a magnifier, one line highlighted | 2820 |
| `desktop.svg` | presenting the desktop app on a monitor | 2779 |
| `alternates/rabbit/*.svg` | the v1 rabbit skin, same 11 filenames, byte-exact (1589–2207 B) | — |
| `_validate.mjs` | **verification helper, not a site asset.** Runs the whole geometry gate on either directory. Nothing references it. | — |
| `../brand/mark.svg` | the logo glyph alone: gecko head + one big eye + a short thick tail. `viewBox="0 0 64 64"`. | 1241 |

Every SVG is self-contained: no `<image>`, no raster, no `<text>`, no external reference, no
`<script>`, no filter, no gradient, no `style` attribute, no `href`, no `url()`, no CSS class.
The mascot files are all inside the 8 KB budget (limit 8192 B).

---

## 2. The construction contract

`viewBox="0 0 120 120"`. Absolute path commands only (`M L C Q A Z`). One stroke weight —
**3 units** (1.6 px at 64 px, **1.15 px at 46 px**, 1.0 px at 40 px) — round caps, round joins.

Each file is cut into three groups, each opening with a marker comment:

| Group | Marker | Content | Mutable? |
|---|---|---|---|
| **A — skeleton** | `<!-- A: skeleton (identical in every file) -->` | skull, two neck lines, tail, body, far foreleg, mouth | animal-specific |
| **B — ink** | `<!-- B: ink (identical in every file) -->` | feet + toe pads, the one big eye, tail spots, far paw, three crest teeth (all solid), then the accent group: slit pupil + tail tip | animal-specific |
| **C — pose** | `<!-- C: pose … -->` | reaching arm + paw + this tool's prop | **never touched by an animal swap** |

Groups A and B are **byte-identical across all 11 files** — asserted by the validator, so the set
cannot silently drift apart. Group C is **byte-identical to the v1 rabbit files** — also asserted
(see §9).

### The 120 × 120 stage (gecko)

```
   x=4.5                                                x=113
 y=11.5 +----------------------------------------------------+
        |   ^^^ crest (solid teeth, sit on the skull arc)     |
        |  /----------\  <- SKULL  bbox 42.7 x 30.6           |
        |  |  o       |     one solid eye r 8.6 = 17.2 dia    |
        |  \--+   +---/     (6.6 px at 46 px)                 |
        |   neck \ / throat   identity ink ends y 46.6 <= 55  |
        |   ( body  )  \ arm origin (56.8,70.3)               |
        |  ( tail    )  \       +-- PROP ZONE --------------+ |
        |  ( hook    )   o paw  | x 66...114, y 25...106    | |
        |   == == feet w/ toe pads         (group C only)   | |
 y=106.4+----------------------------------------------------+
```

ASCII only on purpose: the surrounding docs are UTF-8, and this block should stay readable in any
editor and any diff tool.

Named anchors a redraw must preserve:

| Anchor | Value | Note |
|---|---|---|
| Skull | closed path `M53.5,29.5 …Z`, bbox `x 10.8…53.5`, `y 16.0…46.6` | the identity box; ≥ 34 × 26 units, ink must stay above `y 55` |
| Eye | solid `currentColor` circle `(35.4,27.6) r=8.6` | exactly one; never occluded by a prop |
| Pupil | accent `rect 4 × 12.6 rx=2` at the eye centre, `rotate(-8)` | the character's first accent job |
| Nostril | solid `currentColor` circle `(50.2,24.6) r=1.4` | inside the skull, ~2 units off the snout |
| Crest | three solid teeth seated on the cranium arc, apexes 4.6 units out, tops `y ≈ 11.5` | they must break the skull outline, not sit inside it |
| Neck L (back) | `(25.4,59) → (18.6,43.8)` | both ends land exactly on the body / skull outlines |
| Neck R (throat) | `(50.6,59) → (42.4,44.2)` | the jaw hinge is a skull on-curve knot |
| Mouth | `(46.82,40.91) → (35.4,42.4)` | starts **on** the skull outline, free end inside |
| Tail | base `(17.05,84.48) → (20.40,93.72)` on the body outline, hook to `x 4.5…20.4`, `y 74.6…93.8` | 9.8-unit thick base, 15.9 × 18.5 box, ≥ 60° of turn |
| Tail tip accent | solid accent circle `(7.37,80.1) r=2.6` | the character's second accent job |
| **Body** | `M25.4,59 … C59,75 56,65 50.6,59` | **the v1 rig, byte-identical** |
| **Arm origin R** | `(56.8, 70.3)` — midpoint (t=0.5) of the body's right shoulder curve | every pose arm starts exactly here; asserted twice (start point *and* on-the-outline) |
| Far foreleg | `(19.2,70.3) → (27.6,92.4)` | starts at the mirrored rig anchor, folds onto the lap |
| Far paw | solid `r=4.2` at `(28.7,93.3)` | the validator asserts the leg ends at it |
| Feet | solid ellipses `rx 6.4 ry 3.4` at `(30.5,103)`, `(49.5,103)` | each with three `r=1.5` toe pads — gecko feet splay forward |
| Prop zone | `x 60…114` | group C must stay in `x ≥ 60` |
| Accent | `var(--ts-primary,#0040ff)` | exactly two jobs on the character (slit pupil, tail tip) + one meaning-bearing element per prop |

The body is deliberately the **v1 rabbit body, unchanged**. It is a generic upright torso, it keeps
the rig (`56.8,70.3` + the mirrored `19.2,70.3`) exactly where the ten preserved pose arms expect it,
and it is why an animal swap cannot break a single tool illustration. All the gecko identity is in
the skull, the eye, the crest and the tail — which is also where the 46 px argument lives (§3).

### The one drawing rule that matters

> **Two stroked elements may only ever meet at a shared endpoint.** Anything that must overlap must
> be a **solid** shape (`fill="currentColor"` or the accent), because solids are free to cross lines.

Enforced numerically: the validator walks every stroked outline as a polyline and reports any
*proper* mid-line crossing. Current state: **0 crossings**, 23 drawn joints, worst offset 0.197 units
(0.158 px at 96 px). Two contacts in `split-pdf` remain whitelisted and are *printed*, not hidden:
the scissor blades crossing at the pivot screw and the blades biting the page edge.

---

## 3. The gecko: the decision and its honest cost

The owner chose the animal and drew concept art; this section records what the system does with that
choice and where it is weaker than the animal it replaced. It is not a re-argument of the decision.

### 3.1 What actually survives 46 px, and what does not

Gecko identity in a drawing normally lives in **surface detail** — toe pads, dorsal pattern, the curl
of a thin tail. Every one of those dies at 46 px (and everything dies at 16 px). So the recognition
was moved into the **silhouette**, and the gate measures it instead of asserting it:

| Feature | Size at 120 | At 46 px | At 16 px | Role |
|---|---|---|---|---|
| Skull | 42.7 × 30.6 | 16.4 × 11.7 px | 5.7 × 4.1 px | the mass that says "big head" |
| One solid eye | 17.2 across | 6.6 px | 2.3 px | the feature that says "animal" |
| Crest teeth | 4.6 out of the outline | 1.8 px | 0.6 px | secondary silhouette event |
| Tail | 15.9 × 18.5 box, 9.8 thick base | 6.1 × 7.1 px | 2.1 × 2.5 px | the shape that says "lizard, not bird" |
| Tail spots, toe pads, nostril | 2.8–3.4 | ~1 px | gone | **surface detail, deliberately expendable** |
| Smallest accent (split-pdf cut line) | 2.80 | 1.07 px | 0.37 px | the "precise blue accent" floor |

The numbers above are the ones the validator asserts (skull ≥ 34 × 26, one solid eye r ≥ 7, identity
ink inside `y ≤ 55`, tail base ≥ 6 units turning ≥ 60°, every accent feature ≥ 2.5 units). The prop
accents are measured too: the smallest is the 2.8-unit scissor stroke, the largest is the 5.19-unit
unlock dot.

### 3.2 The Arabic naming rule (binding)

**The risk is the word, not the animal, and the character therefore has no name.**

* The everyday Arabic words for a house gecko are **برص / أبو بريص** and **وزغ**. *برص* is a
  near-homograph of **بَرَص** (vitiligo / leprosy) — a genuine stigma word — and *وزغ* carries
  unfavourable household-folk associations in parts of the region.
* **Rule:** in any user-facing string (UI copy, i18n values, `alt` text, metadata, marketing), use
  **سحلية** ("lizard") if a neutral word is genuinely required, and **never** برص or وزغ.
* **Preferred:** leave the character unnamed, exactly like PDF24's sheep. It is a mascot, not a
  character with a biography; nothing in the UI needs to name the animal.
* The words above appear **only in this document**, because a future contributor cannot avoid a word
  they have not been told about. Do not copy them into `i18n.js`, page markup, image metadata or
  filenames. If you find them anywhere outside this section, that is a bug.
* Consequence for assets: no SVG carries text, an accessible name or a title (see §6), so no asset
  can leak the word by itself.

### 3.3 Where the gecko is honestly weaker than the rabbit

1. **The rabbit's recognition is an outline event; the gecko's is an interior one.** Two narrow ears
   protrude from the head silhouette: a high-frequency edge that survives blur, downscale and even a
   monochrome mask. The gecko's dominant feature is a *filled eye inside the head mass*; if the eye is
   lost (a `mask:`-based monochrome rendering, or heavy downscale), what remains is one rounded blob
   plus a tail. The crest (1.8 px of protrusion at 46 px) is not a full replacement for a
   7.7 × 4.6 px ear pair.
2. **The tail overlaps the body's own footprint.** The rabbit's ears stick up into empty space; the
   gecko's tail hook sits beside the body's left flank, so at chip size the head, body and tail bias
   toward merging into one mass. The channel between the tail's inner edge and the body is ~10 units
   (measured), which is workable but still tighter than an ear.
3. **Culturally the animal is neutral, but it is not warm.** A rabbit is a children's-story animal in
   Arabic as well as English; a gecko is a household animal with the word problem in §3.2. That is a
   branding cost geometry cannot fix, and the unnamed-character rule is the mitigation.
4. **It is heavier to draw.** The rabbit skeleton was 6 paths + 9 solids; the gecko is 7 paths +
   16 solids, and 2.46 KB against 1.59 KB for `base.svg`. Both are far inside budget.

What it buys: an ownable silhouette in the PDF-tool category (no mainstream PDF brand uses a
lizard), a mascot that reads at a glance as "something watching your file", and a shape that survives
to 16 px once it is re-cut as solid fills (`brand/mark.svg`, 86% × 82% box fill, smallest feature
1.42 px at 16 px, eye 4.3 px).

---

## 4. Pose library

Group C is inherited from v1 **byte-for-byte**; only the animal behind it changed.

| Slug | Pose | The one silhouette event at 64 px | Accent element | Prop ink @64 px |
|---|---|---|---|---|
| `image-to-pdf` | holds a page, corner unfolding | a folded corner + mountain + sun in a portrait page | sun dot + folded corner | 20 × 29 |
| `merge-pdf` | carries a 3-page cascade | three offset page shapes | folded corner on the front page | 20 × 27 |
| `compress-pdf` | a page squeezed between arrows | two inward-pointing arrows | both arrows | 13 × 42 |
| `split-pdf` | scissors on a dashed cut | a scissors "X" with two rings | dashed cut line + the whole scissors | 17 × 35 |
| `protect-pdf` | holds a closed padlock | arch shackle on a rounded body | keyhole (circle + slot) | 15 × 22 |
| `unlock-pdf` | holds a key by its bow | ring + shaft + two teeth | the dot in the key's bow | 20 × 9 |
| `pdf-to-images` | one page becomes pictures | page → arrow → two small cards | arrow + two sun dots | 21 × 43 |
| `organize-pdf` | re-orders two pages | two cards over a double-headed arrow | the double arrow | 23 × 35 |
| `extract-text-pdf` | reads a page with a magnifier | lens ring + handle beside a lined page | the highlighted line of text | 25 × 34 |
| `desktop` | presents the desktop app | monitor + neck + base, page on screen | page corner on the screen | 23 × 22 |

Two deliberate v1 departures from the brief's pose suggestions, both for 64 px legibility and both
kept: `organize-pdf` is "two pages + re-order arrow" rather than "juggling pages" (a juggle reads as
noise, an arrow reads as an instruction), and `desktop` is "presenting a monitor" rather than
"sitting at one" (the whole set shares one rig: character left, prop right, one reaching paw).

---

## 5. The theme contract and how to embed it

Every mascot file contains exactly three allowed paint values and nothing else:

```
stroke="currentColor"                     line work   (groups A / C)
fill="currentColor"                       solid ink   (feet, toes, eye, crest, paw, spots, nostril)
fill|stroke="var(--ts-primary,#0040ff)"   the accent  (slit pupil, tail tip, one prop element)
```

No hex anywhere else, no `style` attribute, no CSS class, no gradient, no filter. A theme change is a
token change: the files inherit `color` and `--ts-primary` from whatever element contains them.

`brand/mark.svg` follows the same contract with one deliberate difference: **it is solid fills only**
(`fill="currentColor"` head/crest/tail, `fill="var(--ts-primary,#0040ff)"` eye disc, plus a
`currentColor` slit pupil drawn over it). At 16 px a 4-unit stroke is 1 px, so a stroked logo would
either vanish or turn into a thick smear; fills are the only legible option at that size.

### The `<img>` trap

CSS custom properties and `currentColor` **cannot cross into the document an `<img>` creates**. With

```html
<img class="ts-hero__mascot" src="/assets/img/mascot/image-to-pdf.svg" alt="">
```

* `var(--ts-primary, #0040ff)` falls back to `#0040ff` → the accents stay brand blue. Fine.
* `currentColor` resolves inside the SVG to that document's own initial `color`, which is **black**
  — it does **not** inherit `color: var(--ts-text)` from `.ts-hero__mascot`. Light mode looks
  correct; **dark mode renders black line work on a dark surface.**

Options, best first:

1. **Inline the SVG** (recommended — zero JS, both themes, keeps the accent): inject the markup so
   the `<svg>` lives in the page's DOM; `color` then comes from the container and `--ts-primary` is
   the live token. The files already carry `aria-hidden="true"`, so inlining needs no extra
   attributes — and they carry **no `id`**, so inlining 11 of them cannot create duplicate ids.
2. **CSS mask** (no JS, monochrome): `mask: url(/assets/img/mascot/<slug>.svg) center/contain
   no-repeat`. Follows both themes, loses the blue accent — and note §3.3 item 1: the gecko loses
   more than the rabbit would under a mask, because its main feature is a filled eye.
3. **Keep `<img>` and accept light-mode-only** — only acceptable if the dark theme is dropped.

The header/favicon wiring for `brand/mark.svg` (favicon, `apple-touch-icon`, OG card) belongs to the
owner of `tools/make-icons.mjs`; this package only ships the glyph, with its gate in §9.

---

## 6. Accessibility

* **Decorative only.** Every file's root carries `aria-hidden="true"` and `focusable="false"`.
* **Always paired with text.** Each usage sits next to the tool's `<h1>`; the mascot never carries
  information by itself. With `<img>` usage also keep `alt=""`.
* **The brand mark needs a name from the page**, not from the file: give the header link visible or
  visually-hidden text, or `aria-label` on the link. Never put a `<title>` inside `mark.svg`.
* **No text inside the SVGs** — on purpose (§3.2): the assets cannot leak a name, stay
  untranslated, are RTL-proof (nothing to mirror) and carry no font/licensing question.
* **Animation:** none, on purpose. Any hover motion belongs in
  `@media (prefers-reduced-motion: no-preference)` and in the CSS owner's file.

---

## 7. Size / legibility checklist

Verified geometrically and by rasterising the files in real Chrome (see §9); the last item still
needs human eyes.

| Check | Result |
|---|---|
| Square `viewBox="0 0 120 120"`, no `width`/`height` distortion | ✔ all 11 |
| Ink bounding box inside the canvas | ✔ worst case `x 4.5…113`, `y 11.5…106.4` → ≥ 4.5 units clear |
| Stroke weight above the anti-aliasing floor | ✔ 3 units = 1.15 px @46 px, 1.6 px @64 px |
| Oversized head | ✔ 42.7 × 30.6 units = 16.4 × 11.7 px @46 px |
| Exactly one oversized eye | ✔ 17.2 units across = 6.6 px @46 px, 4.3 px in the 16 px mark |
| Recognition package in the top band | ✔ identity ink ends at `y 46.6` (bar: ≤ 55) |
| Thick curved tail | ✔ 9.8-unit base, 15.9 × 18.5 box, ~180° of turn |
| Smallest accent feature ≥ 2.5 units | ✔ smallest is 2.80 (`split-pdf` cut line) |
| Identity readable without the prop | ✔ skull + eye + crest + tail all independent of group C |
| One silhouette event per prop | ✔ see §4 |
| No line crosses another line | ✔ 0 mid-line crossings; 23 joints, worst 0.158 px offset @96 px |
| 16 px favicon safety | ✔ `brand/mark.svg`: nothing under 5.7 units (1.42 px), eye 4.3 px, fills 86% × 82% |
| **Human eyeball pass, both themes, 16 / 38 / 46 / 96 / 300 px** | ✖ **still open — owner to look** |

One integration note inherited from v1: at `46 px` with 5 px chip padding the drawing box is ~36 px.
The character still reads, but the prop degrades to a shape; if the hub chip has to stay that tight,
prefer `base.svg` there.

---

## 8. Swap procedure (replacing the animal)

**The rule: groups A and B change, group C never does.** Props, hands, anchors, the paw and the prop
zone are animal-independent by construction, so a new animal cannot break a tool illustration.

1. Copy `base.svg` aside as your working file.
2. Replace **group A** (skull, crest, neck lines, tail, body, far foreleg, mouth) and **group B**
   (feet, toes, eye, paw, teeth, nostril, spots + the accent group). Keep every rig anchor: the body
   path verbatim, the arm origins `(19.2,70.3)` / `(56.8,70.3)`, the paw radius `4.2`, the stroke
   width `3`, `fill="none"` on group A.
3. Keep exactly one **identity band**: whatever carries recognition must fit the top ~55 units and be
   measured — `--profile` in `_validate.mjs` is where a new animal's bar goes.
4. Respect the one drawing rule (§2): stroked elements meet only at endpoints; anything that overlaps
   is solid.
5. Keep pose group C verbatim. In the 10 tool files, only the text from `<!-- A: skeleton` to
   `<!-- C: pose` changes.
6. Re-run both gates (§9) on the new directory **and** on `alternates/rabbit`, which must stay green.

The current skeleton to redraw against is literally groups A + B of `base.svg`:

```svg
<!-- A: skeleton (identical in every file) -->
<g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<path d="M53.5,29.5 C53.5,23 48,17.2 38.6,16.2 C28.6,15.2 16.2,17.4 11.8,25.6 C9.2,31.6 11.8,39.6 18.6,43.8 C25.2,47.4 35,47.6 42.4,44.2 C48.8,41.8 53.5,35.8 53.5,29.5 Z"/>
<path d="M25.4,59 C24.2,55.2 20.6,47.8 18.6,43.8"/>
<path d="M50.6,59 C48.4,55 45.6,49 42.4,44.2"/>
<path d="M17.05,84.48 … 20.4,93.72"/>   <!-- tail: 9.83-unit base on the body outline -->
<path d="M25.4,59 C20,65 17,75 17,83 C17,93 23,100 38,100 C53,100 59,93 59,83 C59,75 56,65 50.6,59"/>
<path d="M19.2,70.3 C20.6,76.4 23.6,85.6 27.6,92.4"/>
<path d="M47.62,41.16 C45,41.6 40,42.4 35.4,42.4"/>
</g>
<!-- B: ink (identical in every file) -->
<g fill="currentColor">
<ellipse cx="30.5" cy="103" rx="6.4" ry="3.4"/>
<ellipse cx="49.5" cy="103" rx="6.4" ry="3.4"/>
… six toe pads r=1.5 …
<circle cx="35.4" cy="27.6" r="8.6"/>      <!-- the one big eye -->
<circle cx="28.7" cy="93.3" r="4.2"/>      <!-- far paw -->
… three crest teeth …
<circle cx="50.2" cy="24.6" r="1.4"/>      <!-- nostril -->
… three tail spots r=1.7 …
</g>
<g fill="var(--ts-primary,#0040ff)">
<rect x="33.4" y="21.3" width="4" height="12.6" rx="2" transform="rotate(-8 35.4 27.6)"/>
<circle cx="7.37" cy="80.1" r="2.6"/>
</g>
```

`alternates/rabbit/` is the worked example of a completed swap in the other direction: same 11
filenames, same group C, ear band instead of crest, no tail, a second eye, feet at `(28,103)` /
`(48,103)`. Its byte sizes match the v1 ship exactly.

---

## 9. Verification: what was and was not proved

Two gates, both re-runnable, both run on **both** directories.

**(1) A real XML parser** — well-formed, correct namespace, exact `viewBox`, no
`<image>`/`<filter>`/`<linearGradient>`/`<text>`/`<script>`/`<use>`:

```powershell
Get-ChildItem C:\toolseer\apps\web\assets\img\mascot\*.svg, C:\toolseer\apps\web\assets\img\mascot\alternates\rabbit\*.svg, C:\toolseer\apps\web\assets\img\brand\*.svg |
  ForEach-Object {
    $x = New-Object System.Xml.XmlDocument; $x.Load($_.FullName)
    $r = $x.DocumentElement
    "{0}  ns={1}  viewBox={2}  elements={3}" -f $_.FullName.Replace('C:\toolseer\',''), $r.NamespaceURI, $r.GetAttribute('viewBox'), $x.SelectNodes('//*').Count
  }
```

Result: 23/23 files parsed, `ns=http://www.w3.org/2000/svg`, `viewBox=0 0 120 120` for the 22 mascot
files and `viewBox=0 0 64 64` for the mark. This gate earned its keep in v1 (it caught
`var(--ts-primary)` inside an XML comment, which is an illegal `--` sequence) and it is the reason
the accent token is written into comments as `ts-primary` only.

**(2) The geometry / contract / silhouette gate**

```powershell
node apps/web/assets/img/mascot/_validate.mjs                                     # gecko (default set)
node apps/web/assets/img/mascot/_validate.mjs apps/web/assets/img/mascot/alternates/rabbit
```

The profile is auto-detected from the path (`--profile rabbit|gecko` overrides it), so the rabbit
keeps its own bar and the gecko adds:

* **accent floor** — every accent feature ≥ 2.5 units (line weight for a stroke, bbox for a solid);
* **left-arm anchoring** — the far foreleg starts at `(19.2,70.3)` and ends within 2.5 units of a
  solid `r=4.2` paw;
* **pose-arm anchoring** — every pose arm's start must lie *on* a drawn skeleton outline (≤ 0.05),
  which is what proves the hand leaves the body rather than floating near it;
* **skull** — exactly one closed path in group A, ≥ 34 × 26 units, ink above `y 55`;
* **eye** — exactly one solid circle `r ≥ 7` inside the skull;
* **identity band** — skull + every solid feature seated on it must stay inside `y ≤ 55`;
* **tail** — exactly one open skeleton line whose two free ends lie on the body outline, ≥ 6-unit
  base, ≥ 12 × 15 silhouette box, ≥ 60° of total turn;
* **crest** — ≥ 3 solid teeth, seated within 2.5 units of the skull outline, each breaking it;
* **neck** — the skull must be joined to the body by two anchored lines (back + throat);
* **brand mark** — solid-fill 64-box glyph: theme contract, inside the viewBox, ≥ 55% box fill,
  exactly one accent feature, every feature ≥ 4 units = 1 px at 16 px, accent eye ≥ 12 units.

All of v1's checks are still in the file, unchanged: theme contract, path grammar (absolute only,
correct arity), finite in-canvas coordinates, A+B byte-identity, arm-origin and paw contact, prop
clear of `x < 60`, and the stroke-crossing analysis with its known-answer self-tests.

**Result (gecko, shipped):** `ALL CONTRACT + GEOMETRY CHECKS PASSED` — 0 mid-line crossings, 23
joints (worst 0.197 units = 0.158 px at 96 px), 5 declared `split-pdf` contacts, all files
2.46–3.08 KB (limit 8 KB), skull 42.7 × 30.6, eye 17.2 across, identity ink `y 46.6`, tail base
9.8 units, accent floor 2.80 units.
**Result (rabbit alternate):** `ALL CONTRACT + GEOMETRY CHECKS PASSED` — 0 crossings, 45 joints, all
files 1.59–2.21 KB, restored byte-exact against the v1 ship.

**(3) Group-C regression check (run once, ad hoc).** Group C of every gecko file is byte-identical to
the same file in `alternates/rabbit/`, and the body path plus both rig anchors are present and
unchanged in all 22 files. That is the property which makes the swap safe; fold it into
`_validate.mjs` if a third animal is ever drawn.

**Additionally (and outside the mandated gate):** the files were rasterised in real Chrome —
`chrome.exe --headless=new --screenshot` over an inline-SVG harness, in light **and** dark panels, at
16 / 38 / 46 / 96 / 128 / 160 / 300 / 400 px. That caught two things the numbers alone would not: a
4-unit knocked-out mouth that turned the 128 px mark into a duck bill (removed), and a generator bug
where `segsPath` consumed 4-element segments as triples, so the file held a head shape shifted by one
control point (fixed — the gate had already been measuring the emitted file, which is why the skull
figure moved from 42.7 × 31.5 to 42.7 × 30.6).

**Not proved:** that the drawing *looks right to a human*. The raster check above is an agent
comparing images, not a design review. **The owner should open the 11 files and `brand/mark.svg` at
46 / 96 / 300 px and 16 / 38 px in both themes before this is called done** — in particular to judge
§3.3 item 1 (is the one big eye enough without ears?).

---

## 10. Changelog

* **v2** — gecko is the default: new skull/crest/neck/tail/far-leg skeleton (`gecko v2` marker in
  every header comment), group C preserved byte-identically from v1, `brand/mark.svg` added, the gate
  extended with the anchoring + silhouette + 16 px brand checks, rabbit preserved byte-exact under
  `alternates/rabbit/`, Arabic naming rule documented in §3.2. Defects found and fixed: two the gate
  caught (throat and mouth lines crossing the jaw outline), one the raster check caught (the
  duck-bill mark), one a size assertion caught (an early generator run had overwritten the rabbit
  copies — they were rebuilt from the frozen skeleton and verified against the shipped byte counts).
* **v1** — first system: rabbit skeleton frozen, 10 tool poses, theme contract
  (`currentColor` + `var(--ts-primary,#0040ff)`), geometric verification gate, swap procedure.
  Animal decision left to the owner; v1 recommended the rabbit.
