package com.toolseer.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException

/**
 * The entire native side of ToolSeer.
 *
 * Four jobs, and nothing else:
 *  1. Serve the bundled web app from a secure origin, so ES modules and fetch behave
 *     exactly as they do on toolseer.com.
 *  2. Handle the file chooser. A bare WebView silently ignores the file input element,
 *     so without onShowFileChooser nothing can be opened at all.
 *  3. Copy whatever was picked into this app's own cache and hand the page a URI served
 *     by our own FileProvider. Chromium resolves that itself; a foreign provider's URI
 *     is what produced "I choose the file and nothing happens".
 *  4. Own a folder — Android/media/<package>/files — and expose it as a small file API.
 *     No permission is needed for it on any supported version, the user can see it in
 *     any file manager, and because the app can LIST it, a result made by one tool can
 *     be fed straight into the next one. That is the round trip a picker cannot offer.
 *
 * The bridge methods are declared directly on the Activity. A @JavascriptInterface that
 * ends up nested inside another function compiles perfectly and is simply absent from
 * the page — which is exactly what happened when this file was patched in place.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private val prefs: SharedPreferences by lazy { getSharedPreferences("toolseer", MODE_PRIVATE) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cleanupCache()

        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.mediaPlaybackRequiresUserGesture = false
            // Without these two the WebView lays the site out at desktop width, so the
            // page is wider than the screen and the responsive breakpoint never matches.
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.setSupportZoom(false)
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.textZoom = 100
            webViewClient = AssetClient()
            webChromeClient = Chooser()
            addJavascriptInterface(Bridge(), "ToolSeerNative")
        }
        setContentView(webView)

        if (savedInstanceState == null) {
            webView.loadUrl(if (prefs.getBoolean("onboarded", false)) HOME else WELCOME)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    /* ------------------------------------------------------------ assets --- */

    private inner class AssetClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url ?: return null
            if (url.host != HOST) return null

            val raw = url.path.orEmpty().removePrefix("/")
            val candidate = if (raw.isEmpty()) "www/index.html" else "www/" + raw

            open(candidate)?.let { return it }
            if (!candidate.contains('.')) open(candidate.trimEnd('/') + "/index.html")?.let { return it }
            open(raw)?.let { return it }
            return null
        }

        private fun open(assetPath: String): WebResourceResponse? = try {
            WebResourceResponse(mimeOf(assetPath), null, assets.open(assetPath))
        } catch (e: IOException) {
            null
        }
    }

    /* ------------------------------------------------------------ chooser --- */

    private inner class Chooser : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView?,
            callback: ValueCallback<Array<Uri>>?,
            params: FileChooserParams?,
        ): Boolean {
            pendingFileCallback?.onReceiveValue(null)
            pendingFileCallback = callback

            val accepted = params?.acceptTypes?.toList().orEmpty().joinToString(" ").lowercase()
            val multiple = params?.mode == FileChooserParams.MODE_OPEN_MULTIPLE

            val imageOnly = accepted.contains("image")
                && !accepted.contains("pdf") && !accepted.contains("word")
                && !accepted.contains("sheet") && !accepted.contains("presentation")
                && !accepted.contains("text") && !accepted.contains("*/*")
            val alsoDocuments = accepted.contains("pdf") || accepted.contains("word")
                || accepted.contains("sheet") || accepted.contains("presentation")
                || accepted.contains("text") || accepted.contains("*/*")
            val needsBoth = accepted.contains("image") && alsoDocuments

            Log.i(TAG, "chooser: accept=" + accepted + " imageOnly=" + imageOnly + " both=" + needsBoth)

            return try {
                when {
                    imageOnly -> startActivityForResult(galleryIntent(multiple), REQUEST_FILES)
                    // Documents go straight through: no createChooser wrapper, which is a
                    // known way to lose the result on a number of devices.
                    !needsBoth -> startActivityForResult(documentsIntent(multiple), REQUEST_FILES)
                    else -> {
                        val chooser = Intent.createChooser(galleryIntent(multiple), "اختر من الصور أو الملفات")
                        chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(documentsIntent(multiple)))
                        startActivityForResult(chooser, REQUEST_FILES)
                    }
                }
                true
            } catch (e: Exception) {
                Log.e(TAG, "could not open a picker", e)
                pendingFileCallback = null
                false
            }
        }
    }

    private fun galleryIntent(multiple: Boolean): Intent =
        if (Build.VERSION.SDK_INT >= 33) {
            Intent(MediaStore.ACTION_PICK_IMAGES).apply {
                type = "image/*"
                if (multiple) putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 100)
            }
        } else {
            Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
            }
        }

    private fun documentsIntent(multiple: Boolean): Intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
        }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_FILES) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        Log.i(TAG, "result: code=" + resultCode + " data=" + (data != null)
            + " clip=" + (data?.clipData?.itemCount ?: -1) + " uri=" + data?.data)

        val callback = pendingFileCallback
        pendingFileCallback = null
        if (callback == null) {
            Log.w(TAG, "result with no pending callback")
            return
        }
        if (resultCode != RESULT_OK || data == null) {
            callback.onReceiveValue(null)
            return
        }

        val picked = mutableListOf<Uri>()
        data.clipData?.let { clip -> for (i in 0 until clip.itemCount) picked.add(clip.getItemAt(i).uri) }
        data.data?.let { picked.add(it) }
        if (picked.isEmpty()) {
            callback.onReceiveValue(null)
            return
        }

        val readable = toReadableUris(picked)
        Log.i(TAG, "handing " + readable.size + " file(s) to the page")
        callback.onReceiveValue(readable)
    }

    /* ------------------------------------------------------- picked files --- */

    private fun toReadableUris(uris: List<Uri>): Array<Uri> {
        val out = mutableListOf<Uri>()
        for (uri in uris) {
            val ours = try { copyToCache(uri) } catch (e: Exception) {
                Log.w(TAG, "copy failed: " + e.message); null
            }
            out.add(ours ?: uri)
        }
        return out.toTypedArray()
    }

    private fun copyToCache(uri: Uri): Uri? {
        val rawName = displayName(uri) ?: ("picked-" + System.currentTimeMillis())
        val safe = rawName.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val dir = File(cacheDir, "picked").apply { mkdirs() }
        val target = File(dir, safe)
        contentResolver.openInputStream(uri)?.use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
        } ?: return null
        Log.i(TAG, "copied " + rawName + " (" + target.length() + " bytes)")
        return FileProvider.getUriForFile(this, packageName + ".fileprovider", target)
    }

    private fun displayName(uri: Uri): String? = try {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getString(0) else null
        }
    } catch (e: Exception) {
        null
    }

    private fun cleanupCache() {
        try {
            val dir = File(cacheDir, "picked")
            val cutoff = System.currentTimeMillis() - 24L * 60 * 60 * 1000
            dir.listFiles()?.forEach { if (it.lastModified() < cutoff) it.delete() }
        } catch (e: Exception) {
            // never worth failing a launch over
        }
    }

    /* ------------------------------------------------------- owned folder --- */

    /**
     * Android/media/<package>/files — the folder this app owns.
     *
     * getExternalMediaDirs() needs no permission on any supported version, the folder is
     * visible to the user in a file manager, and the app can list it. That last part is
     * what a picker can never do.
     */
    private fun mediaDir(): File {
        val dirs = getExternalMediaDirs()
        val base = if (dirs.isNotEmpty() && dirs[0] != null) dirs[0]!! else File(filesDir, "media")
        val dir = File(base, "files")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun writeToOwnFolder(name: String, bytes: ByteArray): Uri? {
        val target = File(mediaDir(), name)
        target.writeBytes(bytes)
        Log.i(TAG, "saved " + name + " (" + target.length() + " bytes) to " + target.absolutePath)
        return FileProvider.getUriForFile(this, packageName + ".fileprovider", target)
    }

    private fun jsonEscape(value: String): String =
        value.replace("\\", "\\\\").replace("\"", "\\\"")

    private fun openFile(uri: Uri?, mime: String) {
        if (uri == null) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            })
        } catch (e: Exception) {
            // No viewer installed: the file is saved regardless and the toast said so.
        }
    }

    private fun mimeOf(p: String): String = when (p.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json", "webmanifest" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        "wasm" -> "application/wasm"
        "pdf" -> "application/pdf"
        "zip" -> "application/zip"
        "txt", "xml" -> "text/plain"
        else -> "application/octet-stream"
    }

    /* --------------------------------------------------------- the bridge --- */

    /**
     * Every method here is declared on the Activity, not nested inside another function:
     * a @JavascriptInterface that ends up nested is invisible to the page.
     */
    private inner class Bridge {

        @JavascriptInterface
        fun appVersion(): String = "1.3"

        @JavascriptInterface
        fun finishOnboarding() {
            prefs.edit().putBoolean("onboarded", true).apply()
            runOnUiThread { webView.loadUrl(HOME) }
        }

        @JavascriptInterface
        fun restartOnboarding() {
            prefs.edit().putBoolean("onboarded", false).apply()
            runOnUiThread { webView.loadUrl(WELCOME) }
        }

        @JavascriptInterface
        fun requestAccess(): String = askForAccess()

        @JavascriptInterface
        fun requestAccessAgain(): String = askForAccess()

        @JavascriptInterface
        fun accessState(): String {
            val permission = mediaPermission()
            return if (ContextCompat.checkSelfPermission(this@MainActivity, permission)
                == PackageManager.PERMISSION_GRANTED) "granted" else "not-granted"
        }

        /** Open the document browser directly, whatever the tool asked for. */
        @JavascriptInterface
        fun openDocuments(): Boolean = try {
            runOnUiThread { startActivityForResult(documentsIntent(true), REQUEST_FILES) }
            true
        } catch (e: Exception) {
            Log.e(TAG, "fallback document browser failed", e)
            false
        }

        /** Write the finished file into the app's own folder and open it. */
        @JavascriptInterface
        fun saveBase64(name: String, base64: String, mime: String): String = try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val uri = writeToOwnFolder(name, bytes)
            runOnUiThread {
                Toast.makeText(this@MainActivity, "Saved: " + name, Toast.LENGTH_LONG).show()
                openFile(uri, mime)
            }
            uri?.toString() ?: name
        } catch (e: Exception) {
            "error: " + (e.message ?: "save failed")
        }

        /** The app's own files, newest first, as JSON. */
        @JavascriptInterface
        fun listMyFiles(): String = try {
            val files = mediaDir().listFiles() ?: emptyArray()
            val items = files.filter { it.isFile }
                .sortedByDescending { it.lastModified() }
                .joinToString(",") { f ->
                    // Kotlin ends an expression at a newline, so the operator stays at the
                    // end of the line: a leading '+' is read as a unary plus instead.
                    "{\"name\":\"" + jsonEscape(f.name) + "\",\"size\":" + f.length() +
                        ",\"time\":" + f.lastModified() + "}"
                }
            "[" + items + "]"
        } catch (e: Exception) {
            "error: " + (e.message ?: "list failed")
        }

        /** Base64 of one of our own files, so the page can rebuild it as a File. */
        @JavascriptInterface
        fun readMyFile(name: String): String = try {
            val file = File(mediaDir(), File(name).name)
            if (!file.isFile) "error: not found"
            else Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
        } catch (e: Exception) {
            "error: " + (e.message ?: "read failed")
        }

        @JavascriptInterface
        fun openMyFile(name: String): Boolean = try {
            val file = File(mediaDir(), File(name).name)
            val uri = FileProvider.getUriForFile(this@MainActivity, packageName + ".fileprovider", file)
            val mime = mimeOf(file.name)
            runOnUiThread { openFile(uri, mime) }
            true
        } catch (e: Exception) {
            false
        }

        @JavascriptInterface
        fun deleteMyFile(name: String): Boolean = try {
            File(mediaDir(), File(name).name).delete()
        } catch (e: Exception) {
            false
        }

        @JavascriptInterface
        fun myFilesPath(): String = try {
            mediaDir().absolutePath
        } catch (e: Exception) {
            "error: " + (e.message ?: "no folder")
        }
    }

    private fun mediaPermission(): String =
        if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES
        else Manifest.permission.READ_EXTERNAL_STORAGE

    private fun askForAccess(): String {
        val permission = mediaPermission()
        if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) {
            return "granted"
        }
        runOnUiThread { requestPermissions(arrayOf(permission), REQUEST_PERMISSION) }
        return "asked"
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_PERMISSION) return
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        webView.post {
            webView.evaluateJavascript(
                "window.onToolSeerAccess && window.onToolSeerAccess(" + (if (granted) "'granted'" else "'denied'") + ");",
                null,
            )
        }
    }

    companion object {
        private const val TAG = "ToolSeerPick"
        private const val HOST = "appassets.androidplatform.net"
        private const val HOME = "https://$HOST/index.html"
        private const val WELCOME = "https://$HOST/welcome.html"
        private const val REQUEST_FILES = 1001
        private const val REQUEST_PERMISSION = 1002
    }
}
