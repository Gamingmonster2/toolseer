# ToolSeer Mascot &amp; Illustration System (v1)

**Status: shipped.** 11 standalone SVGs + this document. The character is a **rabbit**; it is drawn
from one frozen skeleton so the animal can be swapped later without touching a single prop.

Owner-facing summary: [§3 argues the animal choice](#3-why-a-rabbit-the-recommendation-argued) —
including the Arabic-first cultural reading and the trademark map — and
[§8 is the swap procedure](#8-swap-procedure-replacing-the-animal).

> ⚠️ **Two things the owner must know before this is wired up**
> 1. **The current `<img src="…svg">` usage is light-mode-only.** `currentColor` and
>    `var(--ts-primary)` cannot cross into the separate document an `<img>` creates. See
>    [§5](#5-theme-contract-and-how-to-embed-it). Inlining the SVG fixes it with zero JS.
> 2. **No browser render was possible in the build environment** (no headless Chrome). Geometry was
>    verified numerically instead — see [§9](#9-verification-what-was-and-was-not-proved). Somebody
>    with a browser should eyeball the 11 files at 46 / 96 / 400 px in both themes.

---

## 1. What is in this folder

| File | Purpose | Bytes |
|---|---|---|
| `base.svg` | The canonical character, neutral pose, no prop. The reference every other file is diffed against. | 1589 |
| `image-to-pdf.svg` | holding a page whose corner folds open into a photo (sun + mountains) | 1947 |
| `merge-pdf.svg` | carrying a three-page cascade | 1945 |
| `compress-pdf.svg` | a page squeezed by two arrows | 1959 |
| `split-pdf.svg` | scissors biting down a dashed cut line | 2196 |
| `protect-pdf.svg` | holding a closed padlock | 1832 |
| `unlock-pdf.svg` | holding a key by its bow | 1840 |
| `pdf-to-images.svg` | one page, an arrow, two picture cards | 2207 |
| `organize-pdf.svg` | two pages over a re-order arrow | 2023 |
| `extract-text-pdf.svg` | a text page under a magnifier, one line highlighted | 1946 |
| `desktop.svg` | presenting the desktop app on a monitor | 1905 |
| `_validate.mjs` | **verification helper, not a site asset.** Re-runs the geometry gate in §9. Nothing references it; delete it if an asset-clean tree is preferred. | 17656 |

Every SVG is self-contained: no `<image>`, no raster, no `<text>`, no external reference, no
`<script>`, no filter, no gradient, no `style` attribute, no `href`, no `url()`, and no CSS class.

---

## 2. The construction contract

`viewBox="0 0 120 120"`. Everything is authored on integer/half-unit grid points with absolute path
commands only (`M L C Q A Z`). Stroke is a single weight — **3 units** (1.6 px at 64 px, 1.0 px at
40 px) — with round caps and round joins.

The file is deliberately cut into three groups, each opening with a marker comment:

| Group | Marker | Content | Mutable? |
|---|---|---|---|
| **A — skeleton** | `<!-- A: skeleton (identical in every file) -->` | head ellipse, both ears, body, left arm, mouth | animal-specific |
| **B — ink** | `<!-- B: ink (identical in every file) -->` | feet, eyes, inner ears (accent), nose (accent) | animal-specific |
| **C — pose** | `<!-- C: pose … -->` | right arm + paw + this tool's prop | **never touched by an animal swap** |

Groups A and B are **byte-identical across all 11 files** — that property is asserted by the
validator, so the set cannot silently drift apart.

### The 120 × 120 stage

```
   x=10.8                                              x=113
 y=9.4  ┌───────────────────────────────────────────────────┐
        │        ╭╮   ╭╮        ← EAR BAND  x 22…54, y 9…29 │
        │       ╭╯╰───╯╰╮                                    │
        │       │ ●   ● │       ← HEAD  ellipse cx38 cy45    │
        │       │   ▼   │          eyes (30,43) (46,43) r3.4 │
        │       ╰╮ ___ ╭╯          nose (accent) mouth y53…56│
        │        │ body │  ╲ arm origin (56.8,70.3)          │
        │        │      │   ╲                               │
        │        ╰──────╯    ●paw       ┌─ PROP ZONE ──────┐ │
        │        ▬▬  ▬▬  feet          │ x 66…114         │ │
 y=106.6│                               │ y 25…106         │ │
        └───────────────────────────────────────────────────┘
```

Named anchors a redraw must preserve:

| Anchor | Value | Note |
|---|---|---|
| Head | `ellipse cx=38 cy=45 rx=20 ry=18` | the identity box; may become a squashed head **inside the same 40 × 36 box**, but the ellipse stays for the rabbit |
| Ear attach L | `(28,29.4)` θ=120°, `(34.5,27.3)` θ=100° on the head ellipse | the ear's two open ends land exactly on the head outline |
| Ear attach R | mirror about `x=38`, i.e. `x' = 76 − x` | |
| Eyes | solid `r=3.4` at `(30,43)` and `(46,43)` | never occluded by a prop |
| Mouth | `M33.6,53.2 C35,56.4 41,56.4 42.4,53.2` | |
| Body | open path `(25.4,59) → base → (50.6,59)` | open **on purpose**: the head's lower arc closes the silhouette, so no line ever runs behind the chin |
| Feet | solid ellipses `rx=7.5 ry=3.6` at `(28,103)`, `(48,103)` | |
| **Arm origin R** | `(56.8, 70.3)` — midpoint (t=0.5) of the body's right shoulder curve | every pose arm starts exactly here; the validator asserts it |
| Arm origin L | `(19.2, 70.3)` | mirror; always the neutral hanging arm |
| Paw | solid `r=4.2` circle at the arm's end | the validator asserts the arm ends at a paw |
| Prop zone | `x 66…114, y 25…106` | group C must stay in `x ≥ 60`, i.e. clear of the character |
| Accent | `var(--ts-primary,#0040ff)` | exactly two jobs: the character's inner ears + nose, and the one meaning-bearing element of each prop |

### The one drawing rule that matters

> **Two stroked elements may only ever meet at a shared endpoint.** Anything that must overlap must
> be a **solid** shape (`fill="currentColor"` or the accent), because solids are free to cross lines.

This is what keeps hand-authored artwork from looking like a wireframe. It is enforced numerically:
the validator walks every stroked outline as a polyline and reports any *proper* mid-line crossing.
Current state: **0 crossings**, and the only line-on-line contacts are 45 drawn joints that sit
within 0.197 units (0.16 px at 96 px) of a line ending — ears-meet-head, arms-meet-body,
magnifier-handle-meets-lens. Two contacts in `split-pdf` are intentional and whitelisted: the two
scissor blades crossing at the pivot screw, and the blades biting 6 units into the page's top edge.

---

## 3. Why a rabbit (the recommendation, argued)

**Recommendation: ship the rabbit.** Five arguments, ordered by how much they should move the
decision — then the honest case against it.

### 3.1 Only the ears survive 46 px

The mascot is used at `96 px` (`.ts-hero__mascot`) and at `46 px` with 5 px of padding
(`.ts-tool__mascot`), i.e. a ~36 px drawing box. At that scale a character is *one* silhouette
feature plus two eye dots. Two long upright ears read instantly and unambiguously; they also survive
a monochrome rendering, a 1 px stroke and a heavy downscale.

The alternatives fail that test:
* A **gecko's** identity lives in surface detail — toe pads, dorsal pattern, the curl of the tail —
  all of which disappear below ~64 px and leave a generic lizard blob. Drawing the detail back means
  breaking the UI's restraint (the reference UI uses thin 1.5 px outline icons and one accent).
* A **rooster's** identity is three small features — comb, wattle, tail sickle. At 36 px they merge
  into "generic bird", and a generic bird at 36 px is the single most crowded silhouette in
  software (Twitter, Firefox, DuckDuckGo, Mailchimp, every weather app).

### 3.2 It fits the brand line we actually make

ToolSeer's promise is *local, instant, nothing uploaded*. A rabbit carries "fast" for free — Arabic
even has the idiom أسرع من الأرنب. "Seer" wants a watcher, and two big ears + a magnifier is a
friendlier version of that than an eye motif. The reference UI's own logo is a document with a small
sparkle in the corner; a rabbit peeking over a page is the same visual family. The ears also give us
a free graphic device: two ear shapes can be re-read as a pair of pages, which is exactly what
`merge-pdf`, `organize-pdf` and `split-pdf` need to communicate.

### 3.3 Arabic-first reading — this is where the other two get risky

| Candidate | Arabic | Cultural reading for an Arabic-first audience |
|---|---|---|
| **Rabbit** | أرنب | Warm, unambiguous, everywhere in children's stories, songs and proverbs. No religious, political or sectarian charge. No unfortunate homonym. Safe to put next to a family's documents. |
| **Gecko / lizard** | سحلية · وزغة · **برص** | The everyday Gulf/Levantine word for a house gecko, **برص**, is a near-homograph of **بَرَص** (vitiligo / leprosy) — a genuine stigma word. The gecko (الوزغ) also carries a negative household-folk association in parts of the region. Naming a brand character that is a real, avoidable risk in the exact market we are launching in. |
| **Rooster** | **ديك** | Functionally unusable as a friendly character name in most Arabic dialects: it is a widespread crude double-entendre, and the same word is used as an insult for a posturing man. It also reads "farm / morning alarm", not "documents". |

For completeness: the rooster is the *best* story of the three in English (a rooster sees the dawn
first — the seer). That is exactly why the recommendation is argued on risk and legibility instead:
the pun is not worth an insult in the primary market.

### 3.4 Trademark and category crowding

| Character | Owner |
|---|---|
| panda | **iLovePDF** |
| sheep | **PDF24** |
| abstract marks | Smallpdf, Adobe Acrobat, Stirling-PDF |
| fox / dinosaur / duck / chimp | Firefox / Chrome / DuckDuckGo / Mailchimp |

**No mainstream PDF or productivity brand has claimed a rabbit.** That is the single cleanest slot of
the three. Geckos are already used in Gulf insurance and finance advertising (and geckos skew
"household pest" in naming), while roosters are heavily owned by breakfast, farm and egg brands —
both more crowded, and both weaker at telling a *document* story.

### 3.5 A wrong guess is cheap by construction

The five arguments above are a judgment call, so the system is built so the owner can overrule them
for the cost of one redraw: a swappable animal touches **groups A and B only** in 11 files (~40 lines)
and never touches a prop, a hand, an anchor or the prop zone. Instructions in §8.

### 3.6 The honest case against the rabbit

* A rabbit is a *common* cartoon animal (Easter, cereals, children's books, many startups). It is
  distinctive **in the PDF-tool category**, not in absolute terms. If the owner's goal is "no other
  brand on earth looks like us", the rooster is the more unusual silhouette — at the cost of §3.3.
* "Seer" maps to a rabbit only indirectly (ears ≈ listening; the magnifier does the seeing).
* Rabbits are strongly associated with **Easter and spring** in Western markets. ToolSeer is
  Arabic-first and that association is weak-to-neutral in the target market, but it exists in the
  English-language secondary market. Mitigation: keep the character a plain blue-accented rabbit, no
  eggs, no baskets, no pastel palette — the current files already avoid every seasonal cue.

### 3.7 If the owner overrides

* **Rooster chosen:** keep everything from §2, replace the ear band with a 3-lobe comb
  (`y 9…22`, three overlapping arcs spanning `x 30…46`) plus a wattle teardrop under the nose, and
  draw the tail as **solid currentColor** feathers — a stroked fan would cross the body outline and
  break §2's one rule.
* **Gecko chosen:** flatten the head to `rx 22, ry 13` at `cy 47`, replace the ear band with a
  dorsal crest, and replace the two feet with one tapering tail curving into the empty lower-right
  space (`x 44…62, y 96…108`) — it must stop at `x ≤ 62` to protect the prop zone.
* **Compromise worth considering:** mint the rabbit as the brand face and let a gecko appear as a
  *supporting* detail inside a prop (a gecko on the monitor bezel in `desktop.svg`, a gecko sticker
  on the box in `compress-pdf.svg`). The animal then costs nothing, because props are
  animal-independent.

---

## 4. Pose library

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

Two deliberate departures from the brief's pose suggestions, both for 64 px legibility:
`organize-pdf` is "two pages + re-order arrow" rather than "juggling pages" (a juggle at 64 px reads
as noise, an arrow reads as an instruction), and `desktop` is "presenting a monitor" rather than
"sitting at one" (the whole set shares one rig: character left, prop right, one reaching paw).

---

## 5. Theme contract and how to embed it

Every file contains exactly three allowed paint values and nothing else:

```
stroke="currentColor"                     line work   (root group A / C)
fill="currentColor"                       solid ink   (eyes, feet, paws)
fill|stroke="var(--ts-primary,#0040ff)"   the accent
```

No hex anywhere else, no `style` attribute, no CSS class, no gradient, no filter. So a theme change
is a token change: the files inherit `color` and `--ts-primary` from whatever element contains them.

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

1. **Inline the SVG** (recommended — zero JS, both themes, keeps the accent):
   `toolkit.js`/the page fetches the file once and injects the markup, so the `<svg>` lives in the
   page's DOM. `color` then comes from `.ts-hero` and `--ts-primary` is the live token. The files
   already carry `aria-hidden="true"` so inlining needs no extra attributes.
2. **CSS mask** (no JS, monochrome): swap the `<img>` for a non-replaced element and use
   `background: var(--ts-text); mask: url(/assets/img/mascot/<slug>.svg) center/contain no-repeat;`
   This follows both themes, but the whole drawing becomes one colour — the blue accent is lost.
3. **Keep `<img>` and accept light-mode-only** — only acceptable if the dark theme is dropped.

---

## 6. Accessibility

* **Decorative only.** Every file's root carries `aria-hidden="true"` (and `focusable="false"`).
* **Always paired with text.** Each usage sits next to the tool's `<h1>`; the mascot never carries
  information by itself. With `<img>` usage also keep `alt=""` (as the current markup does).
* **If a usage ever must convey meaning**, give it `role="img"` + a `<title>` **in the page markup**
  where it is used — never inside these files, so the file stays a single-purpose asset.
* **No text inside the SVGs.** That keeps them untranslated, un-localised, RTL-proof (nothing to
  mirror) and free of font-embedding/licensing questions. `html[dir="rtl"]` needs no SVG changes:
  the illustration is not a UI control and does not encode reading order.
* **Animation:** none, on purpose. If a hover animation is ever added, it must be inside
  `@media (prefers-reduced-motion: no-preference)` and added by the CSS owner, not baked in here.

---

## 7. Size / legibility checklist

Verified geometrically (see §9); the last item needs human eyes.

| Check | Result |
|---|---|
| Square `viewBox="0 0 120 120"`, no `width`/`height` distortion | ✔ all 11 |
| Ink bounding box inside the canvas with margin | ✔ worst case `x 10.8…113`, `y 9.4…106.6` → ≥ 6 units clear of every edge |
| Stroke weight above the anti-aliasing floor | ✔ 3 units = 1.6 px @64 px, 1.0 px @40 px |
| Smallest meaningful feature ≥ ~2.5 px @64 px | ✔ smallest accent dot is `r=2.6` (2.8 px @64 px); smallest arrow is 12 units (6.4 px) |
| Identity readable without the prop | ✔ ears + eyes + accent nose all inside `y 9…56` |
| One silhouette event per prop | ✔ see §4 |
| No line crosses another line | ✔ 0 mid-line crossings; 45 joints, worst 0.16 px offset @96 px |
| No clipping / overflow when scaled 40 → 400 px | ✔ pure vector, no filters, no non-scaling strokes, no clip paths |
| **Rendered check in a real browser, both themes, 46 / 96 / 400 px** | ✖ **not possible here — owner to eyeball** |

One integration warning: at `46 px` with the existing 5 px chip padding the drawing box is ~36 px and
a detailed prop degrades to a shape. If the mascot is used in that chip, prefer `base.svg`, or give
the chip 0 padding with a 46 px box.

---

## 8. Swap procedure (replacing the animal)

**The rule: groups A and B change, group C never does.** Props, hands, anchors, the paw and the prop
zone are animal-independent by construction, so a new animal cannot break a single tool illustration.

1. Copy `base.svg` aside as your working file.
2. Replace **group A** (head, ear band, body, left arm, mouth) and **group B** (feet, eyes, inner-ear
   accents, nose) with the new animal. Keep every anchor from the §2 table: the eye positions, the
   mouth's y-range, the body's two attach points `(25.4,59)` / `(50.6,59)`, the arm origins
   `(19.2,70.3)` / `(56.8,70.3)`, the paw radius `4.2`, the stroke width `3`, `fill="none"`.
3. Give the new animal **exactly one** ear-band feature (ears, crest, horns, antennae, comb) built
   from at most two open paths whose free ends lie **on** the head outline — never crossing it.
4. Respect the one drawing rule (§2): stroked elements may only meet at endpoints; anything that has
   to overlap is solid.
5. Keep pose group C verbatim. In the 10 tool files, only the group-A/B text changes — the file from
   the `<!-- A: skeleton` marker to the `<!-- C: pose` marker.
6. Re-run the gate in §9. It asserts that groups A+B are byte-identical across all 11 files, that each
   pose arm starts at `(56.8,70.3)` and ends at a paw, that no prop enters `x < 60`, that every paint
   value is one of the three allowed tokens, and that no line crosses a line.

The skeleton to redraw against (this is literally groups A + B of `base.svg`):

```svg
<!-- A: skeleton (identical in every file) -->
<g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<ellipse cx="38" cy="45" rx="20" ry="18"/>
<path d="M28,29.4 C22.8,22.5 22.4,13.5 26.6,10.2 C28.8,8.6 31.5,9.4 32.9,13.3 C34.1,17.2 34.5,23 34.5,27.3"/>
<path d="M48,29.4 C53.2,22.5 53.6,13.5 49.4,10.2 C47.2,8.6 44.5,9.4 43.1,13.3 C41.9,17.2 41.5,23 41.5,27.3"/>
<path d="M25.4,59 C20,65 17,75 17,83 C17,93 23,100 38,100 C53,100 59,93 59,83 C59,75 56,65 50.6,59"/>
<path d="M19.2,70.3 C16.4,71.5 15,75 15,78.5"/>
<path d="M33.6,53.2 C35,56.4 41,56.4 42.4,53.2"/>
</g>
<!-- B: ink (identical in every file) -->
<g fill="currentColor">
<ellipse cx="28" cy="103" rx="7.5" ry="3.6"/>
<ellipse cx="48" cy="103" rx="7.5" ry="3.6"/>
<circle cx="30" cy="43" r="3.4"/>
<circle cx="46" cy="43" r="3.4"/>
<circle cx="15" cy="79.5" r="4.2"/>
</g>
<g fill="var(--ts-primary,#0040ff)">
<rect x="27" y="15" width="4" height="11" rx="2" transform="rotate(-6 29 20.5)"/>
<rect x="45" y="15" width="4" height="11" rx="2" transform="rotate(6 47 20.5)"/>
<path d="M38,47 L42,51 L34,51 Z"/>
</g>
<!-- C: pose | … per file … -->
```

Ready-made redraws for the two alternates are in §3.7.

---

## 9. Verification: what was and was not proved

Two gates. Both were run on the shipped files; both are re-runnable.

**(1) A real XML parser** — 11/11 well-formed, correct SVG namespace, `viewBox` exact, no
`<image>`/`<filter>`/`<linearGradient>`/`<text>`/`<script>`/`<use>`:

```powershell
Get-ChildItem C:\toolseer\apps\web\assets\img\mascot\*.svg | ForEach-Object {
  $x = New-Object System.Xml.XmlDocument; $x.Load($_.FullName)
  $r = $x.DocumentElement
  "{0}  ns={1}  viewBox={2}  elements={3}" -f $_.Name, $r.NamespaceURI, $r.GetAttribute('viewBox'), $x.SelectNodes('//*').Count
}
```

This gate earned its keep immediately: it caught a real defect that a hand-written check would have
missed — `var(--ts-primary)` inside an XML comment is **illegal** (`--` may not appear in a comment)
and would have made every file invalid.

**(2) The geometry / contract gate** — parses each file into a tree with inherited paint, walks every
element into a polyline (24 samples per curve segment, 64 per full circle, SVG arc endpoint→centre
conversion), and then asserts:

```
node apps/web/assets/img/mascot/_validate.mjs
```

* every `fill`/`stroke` is one of `none`, `currentColor`, `var(--ts-primary,#0040ff)`;
* no hex outside the accent token, no `style=`, no `url(`, no `href`;
* all path data is absolute with correct argument counts for its commands;
* every coordinate is finite and inside the canvas;
* group A + B are **byte-identical** in all 11 files;
* every pose arm starts exactly at `(56.8,70.3)` and ends within 2.5 units of a paw;
* every prop stays out of `x < 60` (the character zone);
* **no stroked outline properly crosses another** — with the checker itself covered by known-answer
  self-tests (plain crossing, parallel, disjoint, T-junction, shallow angle), because a checker that
  cannot fail is worse than no checker. That self-test is not decoration: the first version of the
  intersection routine had `t`/`u` swapped and reported *zero* crossings on artwork that has forty.
* declared exceptions, printed rather than hidden: 5 contacts in `split-pdf` (scissor blades at the
  pivot, two blade-into-page bites, two handle-ring joints).

**Result:** `ALL CONTRACT + GEOMETRY CHECKS PASSED` — 0 mid-line crossings, 45 joints with a worst
offset of 0.197 units (0.16 px at 96 px), all files 1.6–2.2 KB (limit 8 KB).

**Not proved:** that the drawings *look* right. There is no browser, no rasteriser and no SVG
renderer in this environment, so nothing here is a screenshot. Silhouette legibility at 64 px was
reasoned from geometry (one shape event per prop, ≥ 2.5 px minimum feature, identity confined to the
top 55 units) rather than observed. **The owner (or any teammate with a browser) should open the 11
files at 46 / 96 / 400 px in both themes before this is considered done.**

---

## 10. Changelog

* **v1** — first system: rabbit skeleton frozen, 10 tool poses, theme contract
  (`currentColor` + `var(--ts-primary,#0040ff)`), geometric verification gate, swap procedure.
  Animal decision still the owner's; §3 recommends the rabbit.
