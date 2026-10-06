//! ⚠ UNVERIFIED SCAFFOLD — never compiled. See apps/desktop/README.md.
//!
//! Merge, split and organize. All three are the same qpdf code path - select pages from inputs and
//! write a new document - so they live together and differ only in the page list handed to qpdf.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::engine::qpdf::{self, MergeOptions, OrganizeOptions, SplitMode};
use crate::engine::{Engine, EngineError, JobOutcome};
use crate::ops::{emit_progress, file_outcome, job_id, require_inputs, require_output_dir};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequest {
    #[serde(default)]
    pub job_id: Option<String>,
    pub inputs: Vec<PathBuf>,
    pub output: PathBuf,
    #[serde(default)]
    pub add_bookmarks: bool,
    #[serde(default)]
    pub fail_on_encrypted: bool,
}

/// Merge N documents into one.
///
/// This is the operation the browser path is worst at: 1000 images or 50 PDFs in a tab means 50
/// `ArrayBuffer`s alive at once plus the output. Here qpdf reads from paths and writes to a path.
pub async fn run_merge(app: &AppHandle, engine: &Engine, request: MergeRequest) -> Result<JobOutcome, EngineError> {
    let id = job_id(engine, &request.job_id);
    require_inputs(&request.inputs, 2)?;
    require_output_dir(&request.output)?;
    emit_progress(app, &id, "start", 0, 1);

    let qpdf = qpdf::Qpdf::new(engine.paths().qpdf.clone());
    let args = qpdf::merge_args(
        &request.inputs,
        &request.output,
        &MergeOptions {
            add_bookmarks: request.add_bookmarks,
            fail_on_encrypted: request.fail_on_encrypted,
        },
    );

    let result = qpdf.run(args).await;
    engine.finish_job(&id);

    result?;
    emit_progress(app, &id, "done", 1, 1);

    let mut warnings = Vec::new();
    if request.fail_on_encrypted {
        warnings.push("encrypted inputs were rejected rather than merged".to_string());
    }
    file_outcome(&request.output, warnings)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitRequest {
    #[serde(default)]
    pub job_id: Option<String>,
    pub input: PathBuf,
    /// Where page files go when mode is "each". The UI picks a folder, not a file.
    pub output_dir: PathBuf,
    /// "each" | "ranges"
    pub mode: String,
    #[serde(default)]
    pub ranges: Option<String>,
    /// When set with mode "each", the pages are also collected into one archive. Doing that natively
    /// is the point: a 700-page split zipped in the webview would need every page in memory.
    #[serde(default)]
    pub merge_into_one: bool,
    #[serde(default)]
    pub single_output: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitOutcome {
    pub files: Vec<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive: Option<PathBuf>,
    pub warnings: Vec<String>,
}

pub async fn run_split(app: &AppHandle, engine: &Engine, request: SplitRequest) -> Result<SplitOutcome, EngineError> {
    let id = job_id(engine, &request.job_id);
    require_inputs(std::slice::from_ref(&request.input), 1)?;
    std::fs::create_dir_all(&request.output_dir)?;
    emit_progress(app, &id, "start", 0, 1);

    let qpdf = qpdf::Qpdf::new(engine.paths().qpdf.clone());
    let mut warnings = Vec::new();

    let files = match request.mode.as_str() {
        "ranges" => {
            let ranges = request
                .ranges
                .clone()
                .ok_or_else(|| EngineError::Job("mode 'ranges' needs a range string such as 1-3,7".to_string()))?;
            let output = request
                .single_output
                .clone()
                .unwrap_or_else(|| request.output_dir.join("split.pdf"));
            qpdf.run(qpdf::split_args(
                &request.input,
                &output,
                &SplitMode::Ranges { ranges },
            ))
            .await?;
            vec![output]
        }
        "each" => {
            let prefix = request.output_dir.join("page-%d.pdf");
            qpdf.run(qpdf::split_args(
                &request.input,
                &request.output_dir,
                &SplitMode::EachPage { prefix: prefix.clone() },
            ))
            .await?;
            // qpdf names the files itself; collect what actually appeared rather than guessing the
            // numbering scheme, which has changed upstream before.
            let mut produced: Vec<PathBuf> = std::fs::read_dir(&request.output_dir)?
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|ext| ext == "pdf"))
                .collect();
            produced.sort();
            produced
        }
        other => return Err(EngineError::Job(format!("unknown split mode {other:?}"))),
    };

    if files.is_empty() {
        return Err(EngineError::Job("splitting produced no pages".to_string()));
    }

    // One archive, written natively, page by page. See engine/zipstore.rs for the 4 GiB limit.
    let archive = if request.merge_into_one {
        let total = files.len() as u32;
        let path = request
            .single_output
            .clone()
            .unwrap_or_else(|| request.output_dir.join("split-pages.zip"));
        let mut zip = crate::engine::zipstore::ZipStore::create(&path)?;
        for (index, file) in files.iter().enumerate() {
            engine.ensure_live(&id)?;
            let name = file
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| format!("page-{index}.pdf"));
            zip.add_file(file, &name)?;
            emit_progress(app, &id, "zip", index as u32 + 1, total);
        }
        zip.finish()?;
        Some(path)
    } else {
        None
    };

    if files.len() > 500 {
        warnings.push(format!(
            "{} files were written to {}; keep them on disk rather than previewing them all",
            files.len(),
            request.output_dir.display()
        ));
    }

    engine.finish_job(&id);
    emit_progress(app, &id, "done", files.len() as u32, files.len() as u32);

    Ok(SplitOutcome {
        files,
        archive,
        warnings,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeRequest {
    #[serde(default)]
    pub job_id: Option<String>,
    pub input: PathBuf,
    pub output: PathBuf,
    /// 1-based page order; omitted pages are deleted.
    #[serde(default)]
    pub order: Vec<u32>,
    /// Page number -> degrees clockwise.
    #[serde(default)]
    pub rotate: Vec<(u32, i32)>,
}

pub async fn run_organize(app: &AppHandle, engine: &Engine, request: OrganizeRequest) -> Result<JobOutcome, EngineError> {
    let id = job_id(engine, &request.job_id);
    require_inputs(std::slice::from_ref(&request.input), 1)?;
    require_output_dir(&request.output)?;
    emit_progress(app, &id, "start", 0, 1);

    // A duplicate page number would silently duplicate a page and confuse the user later.
    let mut seen = std::collections::HashSet::new();
    for page in &request.order {
        if !seen.insert(*page) {
            return Err(EngineError::Job(format!("page {page} appears twice in the new order")));
        }
    }

    let qpdf = qpdf::Qpdf::new(engine.paths().qpdf.clone());
    let args = qpdf::organize_args(
        &request.input,
        &request.output,
        &OrganizeOptions {
            order: request.order.clone(),
            rotate: request.rotate.clone(),
        },
    );
    let result = qpdf.run(args).await;
    engine.finish_job(&id);
    result?;

    emit_progress(app, &id, "done", 1, 1);
    let mut warnings = Vec::new();
    if request.order.is_empty() {
        warnings.push("no page order was supplied, so every page was kept in its original order".to_string());
    }
    file_outcome(&request.output, warnings)
}
