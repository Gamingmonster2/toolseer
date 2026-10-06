//! ⚠ UNVERIFIED SCAFFOLD — never compiled. See apps/desktop/README.md.
//!
//! The five heavy operations the desktop app exists for. One module each, so a reviewer can see
//! exactly where a claim in the UI copy maps to code.
//!
//! Every operation follows the same shape:
//!   1. check the inputs exist and the job has not been cancelled,
//!   2. do the work with the native engine, streaming through files on disk,
//!   3. emit progress so a long job is visibly alive,
//!   4. return paths, sizes and warnings - never bytes.
//!
//! Step 4 is the design rule that makes the difference. A browser tab cannot hold a thousand decoded
//! images or 700 rendered pages, and it does not have to: the webview sends a file list and receives a
//! file list.

pub mod compress;
pub mod images_to_pdf;
pub mod merge;
pub mod render;
pub mod security;

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::engine::{Engine, EngineError, JobOutcome};

/// Progress events go out on one channel with a job id, so a future multi-job UI needs no new events.
pub const PROGRESS_EVENT: &str = "engine://progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub job_id: String,
    /// Coarse machine-readable stage: "start", "page", "write", "zip", "done".
    pub stage: String,
    pub done: u32,
    pub total: u32,
}

pub fn emit_progress(app: &AppHandle, job_id: &str, stage: &str, done: u32, total: u32) {
    // A failed emit means the window is gone; the job is about to be torn down anyway, so this is
    // deliberately not an error.
    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            job_id: job_id.to_string(),
            stage: stage.to_string(),
            done,
            total,
        },
    );
}

/// Shared input validation. Kept in one place so every operation rejects a missing file the same way
/// instead of failing deep inside an engine with an unhelpful message.
pub fn require_inputs(paths: &[std::path::PathBuf], minimum: usize) -> Result<(), EngineError> {
    if paths.len() < minimum {
        return Err(EngineError::Job(format!(
            "expected at least {minimum} input file(s), got {}",
            paths.len()
        )));
    }
    for path in paths {
        if !path.is_file() {
            return Err(EngineError::Job(format!("input file not found: {}", path.display())));
        }
    }
    Ok(())
}

pub fn require_output_dir(path: &Path) -> Result<(), EngineError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(EngineError::Job(format!(
                "output folder does not exist: {}",
                parent.display()
            )));
        }
    }
    Ok(())
}

/// Outcome for an operation that produces one file.
pub fn file_outcome(output: &Path, warnings: Vec<String>) -> Result<JobOutcome, EngineError> {
    if !output.is_file() {
        return Err(EngineError::Job(format!(
            "the engine reported success but produced no file at {}",
            output.display()
        )));
    }
    let bytes = std::fs::metadata(output)?.len();
    if bytes == 0 {
        // An empty PDF is never a valid result. Catching it here means the UI never offers the user a
        // download that will fail to open.
        return Err(EngineError::Job("the engine produced an empty file".to_string()));
    }
    Ok(JobOutcome {
        output: output.to_path_buf(),
        bytes,
        pages: None,
        warnings,
    })
}

/// A job id supplied by the caller, or a fresh one. Letting the UI choose lets it subscribe to
/// progress before the work starts, which avoids a race on very fast operations.
pub fn job_id(engine: &Engine, requested: &Option<String>) -> String {
    requested.clone().unwrap_or_else(|| engine.begin_job())
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSelection {
    /// "all" | "1-3,7" - the same grammar the browser engine's parsePageRanges accepts, so one UI
    /// control can drive both implementations.
    #[serde(default)]
    pub ranges: Option<String>,
}
