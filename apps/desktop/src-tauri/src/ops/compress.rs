//! ⚠ UNVERIFIED SCAFFOLD — never compiled. See apps/desktop/README.md.
//!
//! Compression, with the honest boundary made explicit.
//!
//! What this implements: qpdf's structural pass - linearise, pack objects into object streams,
//! recompress streams, drop unreferenced resources. It is genuinely lossless, and on the large
//! vector-heavy documents this app exists for it is often worth tens of percent.
//!
//! What it does NOT implement: image downsampling, which is what actually shrinks a 700-page scanned
//! document. The web UI's compression control offers 'lossless' | 'balanced' | 'strong'. The two lossy
//! levels are accepted here and then rejected with a clear message, because quietly running a
//! structural pass and calling it "strong compression" would be a lie about the result. Wire the UI to
//! disable those levels, or implement downsampling via PDFium and re-rendering - see docs/DESKTOP.md.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::engine::qpdf::{self, CompressionLevel};
use crate::engine::{Engine, EngineError, JobOutcome};
use crate::ops::{emit_progress, file_outcome, job_id, require_inputs, require_output_dir};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressRequest {
    #[serde(default)]
    pub job_id: Option<String>,
    pub input: PathBuf,
    pub output: PathBuf,
    /// "lossless" | "balanced" | "strong" - the same three values the browser engine takes, so one
    /// settings control can drive both. Only "lossless" is implemented here.
    #[serde(default = "default_level")]
    pub level: String,
    #[serde(default)]
    pub dpi: Option<u32>,
    #[serde(default)]
    pub quality: Option<u8>,
}

fn default_level() -> String {
    "lossless".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressOutcome {
    pub output: PathBuf,
    pub before: u64,
    pub after: u64,
    /// Percentage saved. Negative means the file grew, which the UI must show honestly.
    pub ratio: f64,
    pub warnings: Vec<String>,
}

pub async fn run_compress(app: &AppHandle, engine: &Engine, request: CompressRequest) -> Result<CompressOutcome, EngineError> {
    let id = job_id(engine, &request.job_id);
    require_inputs(std::slice::from_ref(&request.input), 1)?;
    require_output_dir(&request.output)?;

    if request.level != "lossless" {
        return Err(EngineError::Job(format!(
            "the {:?} compression level needs image downsampling, which this build does not implement; \
             only 'lossless' is available. See docs/DESKTOP.md.",
            request.level
        )));
    }

    emit_progress(app, &id, "start", 0, 1);
    let before = std::fs::metadata(&request.input)?.len();

    let qpdf = qpdf::Qpdf::new(engine.paths().qpdf.clone());
    let _level = CompressionLevel::LosslessStructural;
    let args = qpdf::compress_args(&request.input, &request.output);
    let result = qpdf.run(args).await;
    engine.finish_job(&id);
    result?;

    let outcome = file_outcome(&request.output, Vec::new())?;
    let after = outcome.bytes;
    let ratio = if before == 0 {
        0.0
    } else {
        (before as f64 - after as f64) / before as f64 * 100.0
    };

    let mut warnings = outcome.warnings;
    if after >= before {
        // Same rule as the browser engine: report a compression that grew the file instead of
        // pretending it worked, and point the user at the honest alternative.
        warnings.push(format!(
            "the structural pass did not shrink this file ({} -> {} bytes); it is already compact, or it \
             is a scan whose size is dominated by images, which needs the lossy level that is not implemented yet",
            before, after
        ));
    }

    emit_progress(app, &id, "done", 1, 1);

    Ok(CompressOutcome {
        output: request.output,
        before,
        after,
        ratio,
        warnings,
    })
}
