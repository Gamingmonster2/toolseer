/**
 * native-save.js — saving inside the Android app, without a download.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every save failure reported from a phone has the same root: the web platform
 * saves by handing a blob URL to a download manager. That path is refused when it
 * is started from script, lands where the file picker cannot see it, and asks
 * "download this file again?" when a name repeats. None of that is fixable in a
 * browser — it is fixable by not using the browser's download manager at all.
 *
 * Inside the Android app the same bytes are written straight to the device's
 * Documents folder by native code, then handed to the system's PDF viewer. There is
 * no blob, no gesture requirement and no name collision: the file is simply on the
 * device, where the user expects it, every time.
 *
 * On the website this module does nothing at all: `isNativeApp()` is false and the
 * ordinary download path runs unchanged.
 */

/** True only inside the packaged app; false on the website and in tests. */
export function isNativeApp() {
  try {
    if (typeof window === 'undefined') return false;
    /* The bridge the Android app actually installs. Checked first because it is the
       one that exists in the shipped APK. */
    if (window.ToolSeerNative && typeof window.ToolSeerNative.saveBase64 === 'function') return true;
    /* Kept for a Capacitor build, should one ever replace the plain project. */
    return Boolean(
      window.Capacitor
      && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform(),
    );
  } catch { return false; }
}

function plugin(name) {
  try {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;
  } catch { return null; }
}

/** Uint8Array/ArrayBuffer -> base64, in chunks so a large file cannot blow the stack. */
function toBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Write the file to the device and open it.
 *
 * @returns {Promise<string>} the path it was written to
 * @throws when the app plugins are unavailable, so the caller can fall back to the
 *         browser download rather than losing the user's work.
 */
export async function nativeSave(bytes, name, type = 'application/pdf') {
  /* The Android app's own bridge. It writes through MediaStore to the public
     Documents collection and returns the location, or a string starting with
     "error:" — which is turned into a throw so the caller can fall back rather than
     leave the user with nothing. */
  if (typeof window !== 'undefined' && window.ToolSeerNative
    && typeof window.ToolSeerNative.saveBase64 === 'function') {
    const written = window.ToolSeerNative.saveBase64(name, toBase64(bytes), type);
    const result = String(written == null ? '' : written);
    if (!result || result.startsWith('error:')) {
      throw new Error(result || 'The app could not write the file.');
    }
    return result;
  }

  const filesystem = plugin('Filesystem');
  if (!filesystem || typeof filesystem.writeFile !== 'function') {
    throw new Error('The file system plugin is not available in this build.');
  }

  /* 'Documents' is the folder Android's own file picker shows the user. 'Cache'
     would be invisible to them, which is the exact failure this module removes. */
  const directory = (filesystem.Directory && filesystem.Directory.Documents) || 'DOCUMENTS';

  const written = await filesystem.writeFile({
    path: name,
    data: toBase64(bytes),
    directory,
    recursive: true,
  });

  const uri = written && written.uri;

  /* Opening it immediately is the difference between "saved somewhere" and "here is
     your document". Failure here is not fatal: the file is already on the device. */
  const opener = plugin('FileOpener');
  if (uri && opener && typeof opener.open === 'function') {
    try {
      await opener.open({ filePath: uri, contentType: type });
    } catch { /* no viewer installed, or the user dismissed it */ }
  }

  return uri || name;
}

export default { isNativeApp, nativeSave };
