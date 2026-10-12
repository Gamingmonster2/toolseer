# ToolSeer for Android — build plan, store package, and honest limits

Status: **the app project is written, the APK is not built.** No JDK, Android SDK or
Gradle exists on the development machine, and installing them is blocked in this
environment. Everything below the "build" heading is done; the build itself is one
command once the toolchain is present.

---

## 1. Why an app at all

Every save failure reported from a phone has one root: **the web platform saves by
handing a blob URL to a download manager.** That path is refused when a script starts
it, lands where the file picker cannot see it, and asks "download this again?" when a
name repeats. None of that is fixable inside a browser.

Inside the app, `assets/js/ui/native-save.js` writes the same bytes to the device's
**Documents** folder through native code and then opens them in the system PDF
viewer. No blob, no gesture rule, no collision — the file is simply on the device.

The site keeps working unchanged: `isNativeApp()` is false there, so the ordinary
download path runs and nothing about the web behaviour changes.

---

## 2. What is already done

| Piece | Where | Note |
|---|---|---|
| The whole engine and all 8 tools | `apps/web` | the app bundles **this exact folder** — one source of truth, nothing to drift |
| Native save + open | `apps/web/assets/js/ui/native-save.js` | writes to Documents, opens the viewer |
| Save routed through it | `toolkit.js` → `downloadBytes()` | falls back to the browser path if a plugin is missing |
| App id and name | `apps/mobile/capacitor.config.json` | `com.toolseer.app` · "ToolSeer" |
| Dependencies and scripts | `apps/mobile/package.json` | Capacitor 7 + Filesystem + FileOpener + Share |
| Verification | `tools/check.mjs` | 558 checks, and the app ships the verified tree |

**Deliberately not done:** no service worker inside the app (Capacitor serves the
files itself; a worker would add a second cache with no benefit). Skip `sw.js`
registration when `isNativeApp()` is true — see task 6 below.

---

## 3. Architecture, and what it does not solve

**Capacitor**: a native Android shell around the web UI.

- ✅ No browser, no address bar, no PWA install flow, no service worker
- ✅ Native file save and native file picking
- ✅ Installs from Play, works offline, has an app icon and a splash screen
- ✅ Later: Play Billing for the paid tier, and a login screen
- ⚠️ **It does not raise the memory ceiling.** The UI still runs in a WebView, so a
  700-page PDF remains heavy. That is what the **Windows app** is for, and what a
  **Kotlin/PDFBox core** would solve on mobile in a later version.

Saying this plainly matters: the app removes the *platform* failures, not the
*physics*. Anyone promising unlimited mobile file size in a WebView is guessing.

---

## 4. Versioning (as the owner asked — not 1.0)

The project was developed five times over before a public release, so the first
published version is **1.3**, not 1.0. Afterwards the minor number climbs, and after
1.10 the major becomes 2.

| Release | versionName | versionCode (Play requires a strictly increasing integer) |
|---|---|---|
| first public | `1.3` | 3 |
| next | `1.4` | 4 |
| … | `1.5` … `1.9` | 5 … 9 |
| … | `1.10` | 10 |
| new cycle | `2.0` | 14 |

Set both in `apps/mobile/android/app/build.gradle` after `cap add android`:

```gradle
defaultConfig {
    applicationId "com.toolseer.app"
    versionCode 3
    versionName "1.3"
    minSdkVersion 24          // Android 7.0 — covers essentially every device in use
    targetSdkVersion 35       // Play requires a recent target; raise each year
}
```

Never reuse or lower a `versionCode`: Play rejects the upload and it cannot be undone.

---

## 5. Building the app

### Once, on a machine with the toolchain

1. **JDK 17** — [Adoptium Temurin 17](https://adoptium.net/temurin/releases/?version=17)
2. **Android Studio** (bundles the SDK and Gradle) — <https://developer.android.com/studio>
   - In the SDK Manager install: *Android SDK Platform 35*, *Android SDK Build-Tools*,
     *Android SDK Command-line Tools*, *Platform-Tools*
3. **Node.js** (already present) and a terminal

### Then

```powershell
cd C:\toolseer\apps\mobile
npm install                 # Capacitor CLI, Android platform, plugins
npx cap add android         # generates the android/ project (first time only)
npm run sync                # copies ../web into the app and updates plugins
npm run open                # opens Android Studio

# or without Android Studio — produces the store upload file:
npm run build:release       # -> android/app/build/outputs/bundle/release/app-release.aab
```

`app-release.aab` is **the file you upload to Google Play**. A debug APK for testing
on your own phone: `npm run build:debug` → `android/app/build/outputs/apk/debug/app-debug.apk`.

### Signing (required for Play)

Generate a keystore **once** and never lose it — losing it means you can never update
the app:

```powershell
keytool -genkey -v -keystore toolseer-release.keystore -alias toolseer `
        -keyalg RSA -keysize 2048 -validity 10000
```

Keep the keystore and its passwords somewhere safe and **outside this repository**.

---

## 6. Tasks left in the code (small, listed so nothing is forgotten)

1. **Skip the service worker inside the app** — in `pwa.js`, do not register `sw.js`
   when `isNativeApp()` is true.
2. **Tell phone visitors about the app** — the owner's plan: a mobile-only strip that
   offers the Android download, and `/desktop` extended to cover both apps. Hidden on
   iOS for now, by decision.
3. **Build-time version stamp** — read `versionName` from one file so the site and the
   app cannot disagree.
4. **A real device test pass** — pick 20 photos, convert, confirm the PDF lands in
   Documents and opens. Nothing above replaces this.

---

## 7. Google Play package

### 7.1 Listing text, ready to paste

**App name (max 30 characters)**

```
ToolSeer: PDF Tools Offline
```

**Short description (max 80 characters)**

```
Merge, split, compress, rotate and number PDFs offline. No upload, no account.
```

**Full description (max 4000 characters)**

```
ToolSeer does the everyday PDF jobs on your own phone — no upload, no account, no
watermark, and no waiting for a server.

Your files never leave the device. That is the whole point: nothing is sent
anywhere, so there is nothing to leak, and the tools keep working with no internet
connection at all.

WHAT IT DOES
• Images to PDF — pick 20 or 300 photos, arrange them, get one tidy document
• Merge PDF — combine several files into one, in the order you choose
• Add page numbers — choose the corner, the wording, and the starting number
• Rotate PDF — straighten a sideways scan in one click
• Split PDF — one file per page, ranges, or a fixed number of pages
• Organize PDF — reorder, delete and rotate individual pages by thumbnail
• PDF to images — export pages as PNG or JPEG
• Compress PDF — make a file smaller for email (lossless by default)

WHY PEOPLE KEEP IT
• Nothing is uploaded — the processing happens on your phone
• Works offline, on a plane, in a basement, anywhere
• No sign-up, no daily limit, no watermark, no "upgrade to download"
• Results are saved to your Documents folder and open in your usual PDF viewer

BUILT ON PROVEN ENGINES
The same PDF engines used across the industry, wrapped in a careful, tested layer:
pdf-lib, qpdf, PDF.js and Tesseract. The app is a native shell around that verified
core, so saving a file is a normal file write rather than a browser download.

HONEST LIMITS
Very large documents (hundreds of pages, or files over roughly 50 MB) are heavy for
any mobile device. For those, ToolSeer's desktop app for Windows handles the same
jobs with no practical size limit. We would rather tell you than let a job fail
quietly.

FREE, AND STAYING FREE
Everything listed above is free and will stay free. ToolSeer Pro will add batch
processing and team features later, without removing anything you use today.

Questions or a file that will not open? Write to us from toolseer.com/contact — a
real person reads it.
```

**Arabic**

- الاسم: `تول سير: أدوات PDF بلا إنترنت`
- الوصف المختصر: `دمج وتقسيم وضغط وتدوير وترقيم ملفات PDF على جهازك. بلا رفع وبلا حساب.`

### 7.2 Graphic assets Play requires

| Asset | Size | How to make it |
|---|---|---|
| App icon | **512 × 512 PNG**, no transparency | from `assets/img/brand/mark.svg` — `node tools/render-icons.mjs` already renders this family |
| Feature graphic | **1024 × 500 PNG/JPG** | mascot + wordmark on the brand blue; needed or the listing cannot be published |
| Phone screenshots | **2–8**, min 320 px, max 3840 px, 16:9 or 9:16 | **must come from the running app** — take them on a phone after the first build |
| 7-inch and 10-inch tablet shots | optional but recommended | same app, larger window |

Screenshots cannot be faked honestly: they must show the real interface. Plan them as
a set that tells the story — the hub, images-to-PDF with 20 photos, the settings rail,
the result, page numbers, and the offline promise.

### 7.3 Console checklist

1. **Developer account** — one-off fee, identity verification takes a few days
2. **Create app** — name, default language, "App", "Free"
3. **App content** forms, all mandatory:
   - **Privacy policy** — `https://toolseer.com/privacy` (already live and honest:
     nothing is collected because nothing is uploaded)
   - **Data safety** — declare **no data collected, no data shared**. This is true and
     it is a selling point; do not tick boxes you cannot defend
   - **Content rating** questionnaire — expect "Everyone"
   - **Ads** — none
   - **Target audience** — 13+ (the tools are for adults; avoids the children's policy)
   - **Government apps / financial features** — no
4. **Store listing** — paste 7.1, upload 7.2
5. **Release** — create a release, upload the `.aab`, write release notes
6. **Closed testing first** — Play requires new personal accounts to run a test with
   real testers before production. Start this early; it is the longest wait
7. **Production** once the closed test passes

### 7.4 What will get an app rejected

- A privacy policy that contradicts the Data safety form
- Screenshots that do not show the real app
- A target SDK older than Play's current requirement
- Reusing a versionCode
- Requesting permissions the app does not use — **request none.** This app needs no
  storage or camera permission: the file picker is the system's, and files are written
  to Documents through the platform's own API.

---

## 8. Where the two apps sit relative to the website

| Visitor | What they get |
|---|---|
| Desktop browser | the full site, no limit worth worrying about, 8 tools |
| Desktop, heavy files | **Windows app** (Tauri, see `docs/DESKTOP.md`) — no browser memory ceiling |
| Android phone | **the app** — native saving, offline, no browser failures |
| iPhone | the website for now. Deliberate: one platform done properly beats two done badly |
