//! ⚠ UNVERIFIED SCAFFOLD — never compiled. See apps/desktop/README.md.
//!
//! PDF to images, one page at a time, and text extraction.
//!
//! This is the operation that used to define the problem, so it is the clearest place to state the
//! arithmetic. A4 at 150 dpi is 1240x1754 pixels; at 4 bytes per pixel that is 8.7 MB per page as an
//! RGBA raster, before JPEG or PNG encoding. Retaining 700 of them is 6.1 GB - more than any browser
//! tab can hold, which is why the browser path fails somewhere past a few dozen pages at export DPI.
//!
//! Here the loop is: render one page into a buffer, encode it to a file, drop the buffer. Peak memory
//! is one page. The document can be 7 pages or 7000; the only thing that grows is the output folder.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::engine::pdfium::{self, ImageFormat, PdfiumEngine};
use crate::engine::{Engine, EngineError, JobOutcome};
use crate::ops::{emit_progress, job_id, require_inputs, require_output_dir};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    #[serde(default)]
    pub job_id: Option<String>,
    pub input: PathBuf,
    /// Folder for the individual page images. The user picks a folder, never a file.
    pub output_dir: PathBuf,
    /// "png" | "jpeg"
    #[serde(default = "default_format")]
    pub format: String,
    #[serde(default = "default_dpi")]
    pub dpi: u32,
    #[serde(default)]
    pub quality: Option<u8>,
    /// 1-based page numbers. Empty means every page.
    #[serde(default)]
    pub pages: Vec<u32>,
    /// Archive the images afterwards. Written natively; see engine/zipstore.rs for the 4 GiB limit.
    #[serde(default)]
    pub zip: bool,
    #[serde(default)]
    pub password: Option<String>,
}

fn default_format() -> String {
    "png".to_string()
}

fn default_dpi() -> u32 {
    150
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderOutcome {
    pub files: Vec<PathBuf>,
    pub page_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive: Option<PathBuf>,
    pub warnings: Vec<String>,
}

pub async fn run_render(app: &AppHandle, engine: &Engine, request: RenderRequest) -> Result<RenderOutcome, EngineError> {
    let id = job_id(engine, &request.job_id);
    require_inputs(std::slice::from_ref(&request.input), 1)?;
    std::fs::create_dir_all(&request.output_dir)?;

    let format = match request.format.as_str() {
        "png" => ImageFormat::Png,
        "jpeg" => ImageFormat::Jpeg,
        other => return Err(EngineError::Job(format!("unknown image format {other:?}"))),
    };
    // Guard rails rather than silently producing a 40 GB folder.
    let dpi = request.dpi.clamp(36, 600);
    let quality = request.quality.unwrap_or(85).clamp(1, 100);

    let dll = engine.paths().pdfium.clone();
    let cancel = engine.cancel_handle();
    let input = request.input.clone();
    let pages_requested = request.pages.clone();
    let output_dir = request.output_dir.clone();
    let password = request.password.clone();
    let app_for_progress = app.clone();
    let job_id = id.clone();

    // PDFium is not Send-friendly across awaits, so the whole render loop runs on one blocking thread.
    // That is also what we want: it is CPU-bound work, and keeping it off the async runtime means
    // progress events and cancellation stay responsive while a 700-page export runs.
    let rendered = tokio::task::spawn_blocking(move || -> Result<(Vec<PathBuf>, u32, Vec<String>), EngineError> {
        let pdfium = PdfiumEngine::bind(&dll)?;
        let page_count = pdfium.page_count(&input, password.as_deref())?;

        let targets: Vec<u32> = if pages_requested.is_empty() {
            (1..=page_count).collect()
        } else {
            pages_requested
                .iter()
                .copied()
                .filter(|page| *page >= 1 && *page <= page_count)
                .collect()
        };

        let total = targets.len() as u32;
        let mut files = Vec::with_capacity(targets.len());
        let mut warnings = Vec::new();

        for (index, page_number) in targets.iter().enumerate() {
            // Cancellation is checked between pages, never inside one: a half-written image is never
            // reported as finished.
            if crate::engine::is_cancelled(&cancel, &job_id) {
                return Err(EngineError::Cancelled);
            }

            let output = pdfium::page_output_path(&output_dir, format, *page_number);
            pdfium.render_page_to_file(
                &input,
                page_number - 1,
                dpi as f32,
                format,
                quality,
                password.as_deref(),
                &output,
            )?;
            files.push(output);
            emit_progress(&app_for_progress, &job_id, "page", index as u32 + 1, total);
        }

        if targets.len() < page_count as usize {
            warnings.push(format!(
                "{} of {page_count} pages were exported; the rest were not requested",
                targets.len()
            ));
        }

        Ok((files, page_count, warnings))
    })
    .await
    .map_err(|error| EngineError::Job(format!("render thread failed: {error}")))??;

    let (files, page_count, mut warnings) = rendered;

    let archive = if request.zip && !files.is_empty() {
        let path = request.output_dir.join("pages.zip");
        let mut zip = crate::engine::zipstore::ZipStore::create(&path)?;
        for (index, file) in files.iter().enumerate() {
            let name = file
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| format!("page-{index}.{}", format.extension()));
            zip.add_file(file, &name)?;
            emit_progress(app, &id, "zip", index as u32 + 1, files.len() as u32);
        }
        zip.finish()?;
        Some(path)
    } else {
        None
    };

    engine.finish_job(&id);
    emit_progress(app, &id, "done", files.len() as u32, files.len() as u32);

    if dpi > 300 && files.len() > 100 {
        warnings.push(
            "high DPI over many pages produces a very large output folder; check free disk space"
                .to_string(),
        );
    }

    Ok(RenderOutcome {
        files,
        page_count,
        archive,
        warnings,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractTextRequest {
    #[serde(default)]
    pub job_id: Option<String>,
    pub input: PathBuf,
    /// Where the text is written. One .txt next to the source by default.
    pub output: PathBuf,
    #[serde(default)]
    pub pages: Vec<u32>,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractTextOutcome {
    pub output: PathBuf,
    pub characters: usize,
    pub pages: Vec<PageText>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageText {
    pub page: u32,
    pub text: String,
    /// True when the page yielded no text layer at all: the signal to offer OCR rather than an empty
    /// result. This is the behaviour that stops the app claiming it "extracted text" from a scan.
    pub empty: bool,
}

pub async fn run_extract_text(
    app: &AppHandle,
    engine: &Engine,
    request: ExtractTextRequest,
) -> Result<ExtractTextOutcome, EngineError> {
    let id = job_id(engine, &request.job_id);
    require_inputs(std::slice::from_ref(&request.input), 1)?;
    require_output_dir(&request.output)?;
    emit_progress(app, &id, "start", 0, 1);

    let dll = engine.paths().pdfium.clone();
    let input = request.input.clone();
    let requested = request.pages.clone();
    let password = request.password.clone();
    let app_for_progress = app.clone();
    let job_id = id.clone();

    let extracted = tokio::task::spawn_blocking(move || -> Result<(Vec<PageText>, u32), EngineError> {
        let pdfium = PdfiumEngine::bind(&dll)?;
        let page_count = pdfium.page_count(&input, password.as_deref())?;
        let targets: Vec<u32> = if requested.is_empty() {
            (1..=page_count).collect()
        } else {
            requested.into_iter().filter(|page| *page >= 1 && *page <= page_count).collect()
        };

        let total = targets.len() as u32;
        let mut pages = Vec::with_capacity(targets.len());
        for (index, page_number) in targets.iter().enumerate() {
            let text = pdfium.page_text(&input, page_number - 1, password.as_deref())?;
            pages.push(PageText {
                page: *page_number,
                empty: text.trim().is_empty(),
                text,
            });
            emit_progress(&app_for_progress, &job_id, "page", index as u32 + 1, total);
        }
        Ok((pages, page_count))
    })
    .await
    .map_err(|error| EngineError::Job(format!("text thread failed: {error}")))??;

    let (pages, page_count) = extracted;

    // The text is written to disk as the source of truth and also returned, because a text result is
    // small even for a 700-page book. The cap keeps a pathological document from blowing up the IPC
    // payload; the file always has everything.
    let mut document = String::new();
    for page in &pages {
        document.push_str(&format!("\n----- page {} -----\n", page.page));
        document.push_str(&page.text);
        document.push('\n');
    }
    std::fs::write(&request.output, document.as_bytes())?;

    engine.finish_job(&id);
    emit_progress(app, &id, "done", pages.len() as u32, pages.len() as u32);

    let empty_pages = pages.iter().filter(|page| page.empty).count();
    let mut warnings = Vec::new();
    if empty_pages == pages.len() {
        warnings.push(
            "no page had a text layer: this looks like a scanned document, so OCR is needed - and OCR \
             runs in the webview, not here"
                .to_string(),
        );
    } else if empty_pages > 0 {
        warnings.push(format!(
            "{empty_pages} of {} pages had no text layer and will need OCR",
            pages.len()
        ));
    } else if (pages.len() as u32) < page_count {
        warnings.push(format!(
            "{} of {page_count} pages were read; the rest were not requested",
            pages.len()
        ));
    }

    let characters = document.chars().count();
    let payload: Vec<PageText> = pages
        .into_iter()
        .map(|mut page| {
            // 64 KiB per page is far more than any real text page; a page that exceeds it is keeping
            // its full text in the file on disk.
            const CAP: usize = 64 * 1024;
            if page.text.len() > CAP {
                page.text.truncate(CAP);
                page.text.push_str("\n[truncated in the app view; the full text is in the saved file]");
            }
            page
        })
        .collect();

    Ok(ExtractTextOutcome {
        output: request.output,
        characters,
        pages: payload,
        warnings,
    })
}
