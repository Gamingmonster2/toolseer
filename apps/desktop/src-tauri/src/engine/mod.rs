//! ⚠ UNVERIFIED SCAFFOLD — never compiled, and the Windows path and process details below were not
//! exercised. See apps/desktop/README.md.
//!
//! The engine registry: where the pinned native engines live, whether they are intact, and one place
//! to hold job state.
//!
//! What this deliberately is NOT: there is no local HTTP server, no port, no JVM and no sidecar
//! protocol. The webview calls Rust commands; Rust runs the engines in-process (PDFium) or as a
//! child process with argv and files (qpdf). That removes a whole class of failure - port conflicts,
//! firewalls, orphaned servers, cross-origin requests - and it is the part of the design that makes
//! big jobs possible, because bytes move between files and Rust buffers, never through the JS heap.

pub mod fetch;
pub mod manifest;
pub mod pdfium;
pub mod qpdf;
pub mod scratch;
pub mod zipstore;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize, Serializer};
use tauri::{AppHandle, Manager};

pub use manifest::EngineManifest;

/// Stable, i18n-friendly error codes plus a human-readable message. The code is what the UI
/// localises; the message is for the log. This mirrors the `ToolError { code, message, hint }`
/// contract the browser engine already uses (docs/ARCHITECTURE.md section 4), so one UI error path
/// can serve both.
#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("the bundled engine manifest is invalid: {0}")]
    Manifest(String),
    #[error("engine payload is missing: {name} was not found at {path}. Run `node apps/desktop/tools/fetch-engines.mjs --download` on the build machine, or reinstall. {hint}")]
    PayloadMissing { name: String, path: PathBuf, hint: String },
    #[error("engine payload failed its integrity check: {name} expected {expected}, found {actual}")]
    Integrity { name: String, expected: String, actual: String },
    #[error("file access failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("qpdf exited with {code:?}: {stderr}")]
    Qpdf { code: Option<i32>, stderr: String },
    #[error("the PDF library could not do that: {0}")]
    Pdfium(String),
    #[error("{0}")]
    Job(String),
    #[error("cancelled")]
    Cancelled,
}

impl EngineError {
    /// Stable identifier for the UI. Never a sentence - the UI owns the wording.
    pub fn code(&self) -> &'static str {
        match self {
            EngineError::Manifest(_) => "engine-manifest",
            EngineError::PayloadMissing { .. } => "engine-payload-missing",
            EngineError::Integrity { .. } => "engine-payload-corrupt",
            EngineError::Io(_) => "io",
            EngineError::Qpdf { .. } => "engine-qpdf",
            EngineError::Pdfium(_) => "engine-pdfium",
            EngineError::Job(_) => "job",
            EngineError::Cancelled => "cancelled",
        }
    }
}

/// Tauri commands must return a Serialize error. Sending "{code}: {message}" keeps the code
/// machine-readable on the JS side without inventing a second wire format.
impl Serialize for EngineError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format!("{}: {}", self.code(), self))
    }
}

/// Resolved paths of everything the engines need. Built once at startup.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paths {
    /// Directory holding the extracted payload, i.e. the qpdf and pdfium folders.
    pub root: PathBuf,
    pub qpdf: PathBuf,
    pub pdfium: PathBuf,
    /// Scratch root. Jobs get a child directory each; page-by-page rendering writes here, so this is
    /// the directory a user who processes a 700-page PDF actually needs space in.
    pub scratch: PathBuf,
}

/// One row of the startup self-check, surfaced in the UI. This is the honest alternative to a silent
/// failure in the middle of a big job.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightCheck {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

pub struct Engine {
    manifest: &'static EngineManifest,
    paths: Paths,
    /// Job ids that have been asked to stop. Checked between pages, never mid-write.
    ///
    /// Shared behind an `Arc` because the render and OCR loops run on blocking threads, where holding
    /// a borrow of the whole `Engine` would be awkward; the thread clones this handle instead.
    cancelled: Arc<Mutex<HashSet<String>>>,
}

impl Engine {
    /// Resolve the payload from the bundle's resource directory.
    ///
    /// `TOOLSEER_PAYLOAD_DIR` overrides it so a developer can point a debug build straight at
    /// apps/desktop/src-tauri/payload instead of copying files around.
    pub fn new(app: &AppHandle, manifest: &'static EngineManifest) -> Result<Self, EngineError> {
        let root = match std::env::var_os("TOOLSEER_PAYLOAD_DIR") {
            Some(dir) => PathBuf::from(dir),
            None => app
                .path()
                .resource_dir()
                .map_err(|error| EngineError::Manifest(format!("no resource directory: {error}")))?,
        };

        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| EngineError::Manifest(format!("no app data directory: {error}")))?;

        Ok(Self {
            manifest,
            paths: Paths {
                qpdf: root.join("qpdf").join(executable_name("qpdf")),
                pdfium: root.join("pdfium").join(shared_library_name()),
                scratch: data_dir.join("scratch"),
                root,
            },
            cancelled: Arc::new(Mutex::new(HashSet::new())),
        })
    }

    pub fn manifest(&self) -> &'static EngineManifest {
        self.manifest
    }

    pub fn paths(&self) -> &Paths {
        &self.paths
    }

    /// Cloneable cancellation handle for blocking worker threads. See `is_cancelled`.
    pub fn cancel_handle(&self) -> Arc<Mutex<HashSet<String>>> {
        Arc::clone(&self.cancelled)
    }

    /// Register a new job and get its id. The UI passes the id to every progress event, which is what
    /// makes cancellation and multiple-window support possible later.
    pub fn begin_job(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }

    /// Ask a job to stop. Returns false if the id is unknown (already finished).
    pub fn cancel(&self, job_id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|mut set| set.insert(job_id.to_string()))
            .unwrap_or(false)
    }

    /// Called between units of work. A job that has been cancelled stops at the next safe boundary,
    /// so a partially written output is never presented as a finished file.
    pub fn ensure_live(&self, job_id: &str) -> Result<(), EngineError> {
        let cancelled = self
            .cancelled
            .lock()
            .map(|set| set.contains(job_id))
            .unwrap_or(false);
        if cancelled {
            Err(EngineError::Cancelled)
        } else {
            Ok(())
        }
    }

    pub fn finish_job(&self, job_id: &str) {
        if let Ok(mut set) = self.cancelled.lock() {
            set.remove(job_id);
        }
    }

    /// Check that the payload is present and intact before the user starts a 700-page job, not after.
    ///
    /// Hashing costs a fraction of a second for these file sizes and buys a clear failure instead of a
    /// mysterious mid-job error. The expected digests are the *archive* digests from the manifest, so
    /// extracted files are only checked for existence; fetch-engines.mjs records their hashes for
    /// cross-build comparison.
    pub async fn preflight(&self) -> Vec<PreflightCheck> {
        let mut checks = Vec::new();

        for (name, path, hint) in [
            (
                "qpdf",
                self.paths.qpdf.clone(),
                "the qpdf executable is extracted from the pinned archive",
            ),
            (
                "pdfium",
                self.paths.pdfium.clone(),
                "pdfium.dll is extracted from the pinned archive",
            ),
        ] {
            let exists = tokio::fs::metadata(&path).await.is_ok();
            checks.push(PreflightCheck {
                name: name.to_string(),
                ok: exists,
                detail: if exists {
                    path.display().to_string()
                } else {
                    format!("missing at {} - {hint}", path.display())
                },
            });
        }

        // Binding the library is the only way to know the DLL actually loads: a wrong architecture or
        // a mismatched revision fails here rather than inside a render loop.
        let dll = self.paths.pdfium.clone();
        let bound = tokio::task::spawn_blocking(move || pdfium::PdfiumEngine::bind(&dll).is_ok())
            .await
            .unwrap_or(false);
        checks.push(PreflightCheck {
            name: "pdfium-bind".to_string(),
            ok: bound,
            detail: if bound {
                format!(
                    "PDFium {} (revision {}) loaded",
                    self.manifest.engines.pdfium.version, self.manifest.engines.pdfium.revision
                )
            } else {
                "pdfium.dll exists but could not be loaded: architecture or revision mismatch"
                    .to_string()
            },
        });

        let scratch = self.paths.scratch.clone();
        let writable = tokio::task::spawn_blocking(move || {
            std::fs::create_dir_all(&scratch).is_ok()
                && std::fs::write(scratch.join(".write-test"), b"ok").is_ok()
        })
        .await
        .unwrap_or(false);
        checks.push(PreflightCheck {
            name: "scratch-writable".to_string(),
            ok: writable,
            detail: format!(
                "{} - a 700-page job needs free space here, not in RAM",
                self.paths.scratch.display()
            ),
        });

        checks
    }

    /// Remove scratch directories left behind by a crash or a forced reboot. Called once at startup
    /// and once on exit; jobs clean up after themselves on the normal path.
    pub async fn sweep_scratch(&self) {
        let root = self.paths.scratch.clone();
        let _ = tokio::task::spawn_blocking(move || std::fs::remove_dir_all(root)).await;
    }
}

/// Has this job been asked to stop? Used from worker threads that hold only the cloned handle.
pub fn is_cancelled(cancelled: &Arc<Mutex<HashSet<String>>>, job_id: &str) -> bool {
    cancelled
        .lock()
        .map(|set| set.contains(job_id))
        .unwrap_or(false)
}

/// Windows ships executables with an extension; other platforms do not. This product targets Windows,
/// but keeping the lookup in one function means a port does not have to hunt for it.
fn executable_name(stem: &str) -> String {
    if cfg!(windows) {
        format!("{stem}.exe")
    } else {
        stem.to_string()
    }
}

fn shared_library_name() -> &'static str {
    if cfg!(windows) {
        "pdfium.dll"
    } else if cfg!(target_os = "macos") {
        "libpdfium.dylib"
    } else {
        "libpdfium.so"
    }
}

/// Small helper shared by the ops: the file name without its extension, sanitised for use inside a
/// scratch directory. Mirrors `safeBaseName` in the web engine so both paths agree on naming.
pub fn safe_stem(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .map(|stem| {
            stem.chars()
                .map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '_' } else { c })
                .collect::<String>()
        })
        .unwrap_or_else(|| "document".to_string())
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobOutcome {
    /// Absolute path of the result on the user's disk. The webview only ever sees paths and numbers,
    /// never file bytes - that is the whole point of this shell.
    pub output: PathBuf,
    pub bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pages: Option<u32>,
    /// Degradations the user should know about, e.g. "compression produced a larger file".
    /// Same idea as `warnings` in the browser engine contract.
    #[serde(default)]
    pub warnings: Vec<String>,
}
