# Migration plan — from the Blogger page to the new site

## The plan, as the owner described it

| Piece | Where it lives |
|---|---|
| The new ToolSeer site | `toolseer.com` (main domain), deployed from this repository to Cloudflare Pages |
| The original single page | A **subdomain** (e.g. `old.toolseer.com`), served from a **separate repository** — same code, no longer hosted on Blogger |
| Discovery | A slim bar at the top of the new site: “Old version” → the subdomain |
| Review | Run it for a few months; if the subdomain earns no visits, delete it or keep it |

**Verdict: the plan is sound, and the bar is the right idea.** It respects the people who prefer the
original, it costs nothing to run, and it keeps the main domain as the single place new work happens.
Five things below change the plan slightly, and two of them will bite if they are skipped.

---

## 1. Settle the canonical host BEFORE switching (the one that bites)

An installed web app is bound to its **origin**. `https://toolseer.com` and
`https://www.toolseer.com` are different origins, with different manifests, different service
workers and different installed shortcuts.

So: pick one — I recommend **`www.toolseer.com`** as canonical, because the live old site already
serves `www` — and 301 the other to it. Do that in the same change as the cutover, not later.

Why it matters concretely: a shortcut installed from `www` will keep working after the cutover, and
will land on the new hub, because `start_url` is `"/"` **on that same origin**. A shortcut installed
from the apex will not see `www`'s manifest; it follows whatever the apex serves. If the apex is the
one that changes, those users are fine too — but only if both hosts end up serving the new site. If
you leave `www` on Blogger and move only the apex, half the audience stays on the old page. Choose,
redirect, then switch.

## 2. The legacy subdomain must be `noindex` (the other one that bites)

The old page and the new `/image-to-pdf` do the same job. On a subdomain, Google treats it as a
**separate site**, and it will happily rank an old, thinner page against your new one for the same
query. You would be competing with yourself, using the asset you kept for sentimental reasons.

So the preserved copy gets `<meta name="robots" content="noindex,follow">`. It stays reachable for
humans who click the bar or keep a bookmark, and it stops competing for search. Nothing else about
it changes — it can stay byte-identical otherwise.

## 3. Stage it before you switch

Deploy first, test, then move the domain. Cloudflare Pages gives you a `*.pages.dev` URL for free.

On the staging URL, test with real devices, in this order:

1. `/image-to-pdf` with **20–30 photos picked at once on a phone** — the exact flow the old audience
   used. Check that reordering works by touch (it does now: every thumbnail carries move-earlier and
   move-later buttons, because drag-and-drop does not fire on touch screens), and that the large-job
   advisory appears when the batch is heavy.
2. **Install it** from the browser (the install button appears in the header when the browser offers
   it) and open the installed icon.
3. Turn the phone to airplane mode and open the installed icon — you should get the offline page or
   the cached hub, not a browser error.
4. Open an **old Blogger URL** (any `/YYYY/MM/…` or `/p/…` address you know) on staging and confirm
   it lands on the new site.
5. Check the browser console is clean on every page you visit.

## 4. What the switch will and will not do to existing users

Set expectations honestly:

* **Will:** every bookmark, typed address and installed shortcut on the main domain opens the new
  site, which contains the same tool (image → PDF) plus nine more.
* **Will not:** an installed shortcut cannot be pointed at the subdomain, and it will not keep
  showing the old page. The shortcut belongs to the origin, and the origin is changing. The
  subdomain is a destination for people who *choose* it, not a way to preserve old installs.
* **Will not:** the old page's `start_url` was recorded as whatever URL the user installed from. All
  of those legacy shapes redirect to the new hub, so nobody lands on a 404.

## 5. Keep it permanently (do not plan to delete it)

A static page on Cloudflare Pages costs approximately nothing, and it has no server, no database and
no maintenance. Deleting it later only creates a way to break somebody's bookmark. Recommendation:
keep the site, keep it noindexed, and if after three months it is clearly unused, remove the **bar
link** — not the subdomain.

## 6. The switch, step by step

```text
1. Push this repository to GitHub.
2. Cloudflare Pages → connect the repo → build command: none, output directory: apps/web.
3. Open the pages.dev URL → run tools/check-live.mjs against it (see below) → fix anything red.
4. Create the subdomain repo for the preserved old page, deploy it the same way,
   and add noindex to its HTML.
5. Cloudflare → the legacy subdomain DNS record pointing at the old deployment.
   Verify the old page loads and is not indexed.
6. Set LEGACY_SITE.url in apps/web/assets/js/ui/shell.js to the subdomain, redeploy.
   The top bar appears on every page, in both languages.
7. Switch the main domain's custom domain from Blogger to the Pages project.
8. Redirect the host you did not pick (apex ↔ www) to the chosen one, 301.
9. Run tools/check-live.mjs against https://<canonical host> — every line must be green.
10. Open the old site's Blogger dashboard and leave it published but unadvertised, or unpublish it
    once the subdomain copy is confirmed live. Do not delete the blog: it is the only rollback.
```

**Rollback:** in Cloudflare, point the custom domain back to Blogger. The old blog is untouched, so
this is a DNS-level change that takes minutes. That is the main reason step 10 says unpublish rather
than delete.

## 7. What to measure afterwards

Cloudflare Pages gives you request counts per path. Watch three things for the first month:

| Signal | What it means |
|---|---|
| Requests to `/image-to-pdf` | the old audience found the new tool |
| Requests to `/` and to the legacy paths (they will show as the redirect status) | bookmarks and shortcuts still resolving |
| Requests to the legacy subdomain | whether the bar is used at all — this is the number that decides the review |

If the legacy subdomain gets essentially nothing after three months, that is a *success*: it means the
new image-to-PDF flow satisfied the people who used the old one. Remove the bar link, keep the page.

---

## The tool that makes this verifiable

`tools/check-live.mjs` runs the whole continuity contract against a live origin — canonical routes,
legacy redirects, manifest, service worker, robots, sitemap, offline page — and prints a table with a
non-zero exit code if anything is wrong. Run it against staging before the switch, and against the
real domain after it.

```powershell
node tools/check-live.mjs --base https://your-project.pages.dev
node tools/check-live.mjs --base https://www.toolseer.com
```
