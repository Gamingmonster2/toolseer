package com.toolseer.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.core.content.ContextCompat
import java.io.File
import java.io.IOException

/**
 * The whole native side of ToolSeer.
 *
 * Three jobs:
 *  1. Serve the bundled web app from a secure origin, so ES modules and fetch behave
 *     exactly as they do on toolseer.com.
 *  2. Handle the file chooser. A bare WebView silently ignores <input type="file">,
 *     so without onShowFileChooser below NOTHING can be opened — which is precisely
 *     the failure the owner reported as "I cannot open the images".
 *  3. Save a finished file to the device's Documents collection, because the
 *     browser's own download path is what refused and hid files on a phone.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private val prefs: SharedPreferences by lazy { getSharedPreferences("toolseer", MODE_PRIVATE) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.mediaPlaybackRequiresUserGesture = false
            // Honour the page's viewport meta, and fit the page to the window. Without
            // these two the WebView lays the site out at desktop width: the page is
            // wider than the screen, drifts sideways, and the responsive breakpoint
            // never matches — so the settings drawer stays off-screen while the scrim
            // still dims the page. One cause, three symptoms.
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

    /** Serves the APK's own assets on a secure origin, including directory routes. */
    private inner class AssetClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url ?: return null
            if (url.host != HOST) return null

            val raw = url.path.orEmpty().removePrefix("/")
            val candidate = if (raw.isEmpty()) "www/index.html" else "www/" + raw

            open(candidate)?.let { return it }
            if (!candidate.contains('.')) open(candidate.trimEnd('/') + "/index.html")?.let { return it }
            // Files that belong to the shell rather than the website (the welcome flow).
            open(raw)?.let { return it }
            return null
        }

        private fun open(assetPath: String): WebResourceResponse? = try {
            WebResourceResponse(mimeOf(assetPath), null, assets.open(assetPath))
        } catch (e: IOException) {
            null
        }
    }

    /**
     * The file chooser. This is the piece whose absence made the app useless: the
     * page asks for files, the WebView asks us, and without an answer the request is
     * dropped and every tool looks broken.
     */
    private inner class Chooser : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView?,
            callback: ValueCallback<Array<Uri>>?,
            params: FileChooserParams?,
        ): Boolean {
            pendingFileCallback?.onReceiveValue(null)
            pendingFileCallback = callback

            val accepted = params?.acceptTypes?.toList().orEmpty().joinToString(" ").lowercase()
            val wantsImages = accepted.isEmpty() || accepted.contains("image")
            val wantsDocuments = accepted.isEmpty()
                || accepted.contains("pdf")
                || accepted.contains("word")
                || accepted.contains("sheet")
                || accepted.contains("presentation")
                || accepted.contains("text")
                || accepted.contains("*/*")
            val multiple = params?.mode == FileChooserParams.MODE_OPEN_MULTIPLE

            /* Photos live in the gallery and PDFs live in the file browser. One intent
               cannot serve both well, and trying to forced the owner's phone into an
               unfiltered document browser that showed him nothing usable. So the right
               source is chosen per tool, and when a tool accepts either, BOTH are
               offered in one system dialog. */
            val images = galleryIntent(multiple)
            val documents = documentsIntent(multiple)

            val primary = when {
                wantsImages && !wantsDocuments -> images
                wantsDocuments && !wantsImages -> documents
                else -> images
            }
            val extras = when {
                wantsImages && wantsDocuments -> arrayOf(documents)
                else -> emptyArray()
            }

            return try {
                val chooser = Intent.createChooser(primary, "اختر من الصور أو الملفات")
                if (extras.isNotEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extras)
                startActivityForResult(chooser, REQUEST_FILES)
                true
            } catch (e: Exception) {
                pendingFileCallback = null
                false
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_FILES) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        val callback = pendingFileCallback ?: return
        pendingFileCallback = null

        if (resultCode != RESULT_OK || data == null) {
            callback.onReceiveValue(null)
            return
        }
        val uris = mutableListOf<Uri>()
        data.clipData?.let { clip -> for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri) }
        data.data?.let { uris.add(it) }
        callback.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    /**
     * The gallery. Android 13's photo picker needs no permission and shows exactly the
     * photos the user chooses; older versions ask the media store for images, which is
     * why the read permission is still requested on those.
     */
    private fun galleryIntent(multiple: Boolean): Intent {
        val picker = if (Build.VERSION.SDK_INT >= 33) {
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
        return picker
    }

    /**
     * The file browser, for PDFs and anything else that is not a photo. Deliberately
     * unfiltered: a provider that does not advertise a narrow type cannot answer a
     * filtered query at all, which is what made PDFs invisible. The page validates what
     * it receives and says so if the choice was wrong.
     */
    private fun documentsIntent(multiple: Boolean): Intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
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
        "txt", "xml" -> "text/plain"
        else -> "application/octet-stream"
    }

    private inner class Bridge {
        /** Called by the welcome flow's last screen. */
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
        fun appVersion(): String = "1.3"

        /** Offered from the settings drawer when access was declined earlier. */
        @JavascriptInterface
        fun requestAccessAgain(): String = requestAccess()

        /**
         * Ask for what is genuinely needed — and nothing more.
         *
         * On Android 13 and later the system picker hands the app one file at a time
         * with the user's explicit choice, so NO permission is required at all, and
         * asking for one is both unnecessary and a common reason for a store review
         * to be rejected. Older versions are asked for read access, which is what
         * their pickers expect.
         */
        @JavascriptInterface
        fun requestAccess(): String {
            val permission = if (Build.VERSION.SDK_INT >= 33) {
                Manifest.permission.READ_MEDIA_IMAGES
            } else {
                Manifest.permission.READ_EXTERNAL_STORAGE
            }
            val granted = ContextCompat.checkSelfPermission(
                this@MainActivity, permission,
            ) == PackageManager.PERMISSION_GRANTED
            if (granted) return "granted"
            runOnUiThread { requestPermissions(arrayOf(permission), REQUEST_PERMISSION) }
            return "asked"
        }

        /** Whether the gallery permission has been granted, for the welcome screen. */
        @JavascriptInterface
        fun accessState(): String {
            val permission = if (Build.VERSION.SDK_INT >= 33) {
                Manifest.permission.READ_MEDIA_IMAGES
            } else {
                Manifest.permission.READ_EXTERNAL_STORAGE
            }
            return if (ContextCompat.checkSelfPermission(this@MainActivity, permission)
                == PackageManager.PERMISSION_GRANTED) "granted" else "not-granted"
        }

        @JavascriptInterface
        fun saveBase64(name: String, base64: String, mime: String): String {
            return try {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val uri = writeToDocuments(name, bytes, mime)
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Saved: " + name, Toast.LENGTH_LONG).show()
                    openFile(uri, mime)
                }
                uri?.toString() ?: name
            } catch (e: Exception) {
                "error: " + (e.message ?: "save failed")
            }
        }
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

    private fun writeToDocuments(name: String, bytes: ByteArray, mime: String): Uri? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOCUMENTS)
            }
            val uri = contentResolver.insert(MediaStore.Files.getContentUri("external"), values) ?: return null
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
            return uri
        }
        val dir = getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS) ?: filesDir
        val out = File(dir, name)
        out.writeBytes(bytes)
        return Uri.fromFile(out)
    }

    private fun openFile(uri: Uri?, mime: String) {
        if (uri == null) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            })
        } catch (e: Exception) {
            // No viewer installed: the file is saved anyway and the toast said so.
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    companion object {
        private const val HOST = "appassets.androidplatform.net"
        private const val HOME = "https://$HOST/index.html"
        private const val WELCOME = "https://$HOST/welcome.html"
        private const val REQUEST_FILES = 1001
        private const val REQUEST_PERMISSION = 1002
    }
}
