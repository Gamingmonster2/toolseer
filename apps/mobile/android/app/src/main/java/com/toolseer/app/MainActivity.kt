package com.toolseer.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import java.io.File
import java.io.IOException

/**
 * The whole native side of ToolSeer.
 *
 * Two jobs only:
 *  1. Serve the bundled web app from a secure origin, so ES modules, fetch and the
 *     service worker all behave exactly as they do on toolseer.com. A file:// origin
 *     is an opaque origin and modules fail there, which is why this interceptor
 *     exists rather than a plain loadUrl.
 *  2. Save a finished file straight to the device's Documents collection. That is
 *     the entire reason the app exists: the browser's download path is what refused,
 *     hid and duplicated files on a phone.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = AssetClient()
            addJavascriptInterface(Bridge(), "ToolSeerNative")
        }
        setContentView(webView)

        if (savedInstanceState == null) {
            webView.loadUrl("https://appassets.androidplatform.net/index.html")
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    /** Serves the APK's own assets on a secure https origin, including directory routes. */
    private inner class AssetClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url ?: return null
            if (url.host != "appassets.androidplatform.net") return null

            val raw = url.path.orEmpty().removePrefix("/")
            val candidate = if (raw.isEmpty()) "www/index.html" else "www/" + raw
            open(candidate)?.let { return it }

            // /merge-pdf must serve merge-pdf/index.html, exactly like the website does.
            if (!candidate.contains('.')) open(candidate.trimEnd('/') + "/index.html")?.let { return it }
            return null
        }

        private fun open(assetPath: String): WebResourceResponse? = try {
            WebResourceResponse(mimeOf(assetPath), null, assets.open(assetPath))
        } catch (e: IOException) {
            null
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
        "txt", "xml" -> "text/plain"
        else -> "application/octet-stream"
    }

    /** The bridge the page calls instead of a download. */
    private inner class Bridge {
        /**
         * @return a human-readable result the page can log; throws nothing so a
         *         failure falls back to the browser path rather than losing the file.
         */
        @JavascriptInterface
        fun saveBase64(name: String, base64: String, mime: String): String {
            return try {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val uri = writeToDocuments(name, bytes, mime)
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Saved: $name", Toast.LENGTH_LONG).show()
                    openFile(uri, mime)
                }
                uri?.toString() ?: name
            } catch (e: Exception) {
                "error: " + (e.message ?: "save failed")
            }
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
        // Android 7–9: the app's own external documents folder, which needs no permission.
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
            // No viewer for this type: the file is saved regardless, and the toast says so.
        }
    }
}
