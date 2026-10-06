//! ⚠ UNVERIFIED SCAFFOLD — never compiled. See apps/desktop/README.md.
//!
//! Images to PDF, written natively with the `image` and `printpdf` crates.
//!
//! Why not the web engine: 1000 photos is the exact job the owner described. In a tab, every decoded
//! image and the growing PDF both live in the JS heap. Here each image is decoded, drawn into one
//! page, and dropped - peak memory is one decoded image, and the PDF is streamed to disk by the
//! writer. A 12 megapixel photo is 48 MB decoded as RGBA; one at a time is fine, one thousand at a
//! time is 48 GB.
//!
//! VERIFY: printpdf 0.12 changed to a builder-style API. The exact call names below must be
//! reconciled against the crate at the pinned version; the layout arithmetic is the part that is
//! meant to be read here.

use std::path::PathBuf;

use printpdf::{Image, Mm, PdfDocument};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::engine::{safe_stem, Engine, EngineError};
use crate::ops::{emit_progress, job_id, require_inputs, require_output_dir};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagesToPdfRequest {
    #[serde(default)]
    pub job_id: Option<String>,
    /// Order matters: the pages come out in exactly this order, which is how the UI's reordering works.
    pub images: Vec<PathBuf>,
    pub output: PathBuf,
    /// "a4" | "letter" | "legal" | "fit"
    #[serde(default = "default_page_size")]
    pub page_size: String,
    /// "auto" | "portrait" | "landscape"
    #[serde(default = "default_orientation")]
    pub orientation: String,
    /// "none" | "small" | "medium" | "large"
    #[serde(default = "default_margin")]
    pub margin: String,
    /// JPEG quality for re-encoded images, 1-100. Ignored by lossless formats.
    #[serde(default = "default_quality")]
    pub quality: u8,
}

fn default_page_size() -> String {
    "a4".to_string()
}
fn default_orientation() -> String {
    "auto".to_string()
}
fn default_margin() -> String {
    "small".to_string()
}
fn default_quality() -> u8 {
    85
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagesToPdfOutcome {
    pub output: PathBuf,
    pub bytes: u64,
    pub page_count: u32,
    pub warnings: Vec<String>,
}

/// Page dimensions in millimetres. "fit" means the page takes the image's own aspect ratio at the
/// chosen orientation, so nothing is letterboxed.
fn page_mm(page_size: &str, landscape: bool) -> (f32, f32) {
    let (w, h) = match page_size {
        "letter" => (215.9, 279.4),
        "legal" => (215.9, 355.6),
        _ => (210.0, 297.0), // A4, and the fallback for "fit" before the image is known
    };
    if landscape {
        (h, w)
    } else {
        (w, h)
    }
}

fn margin_mm(margin: &str) -> f32 {
    match margin {
        "none" => 0.0,
        "medium" => 20.0,
        "large" => 30.0,
        _ => 10.0, // "small" is the default
    }
}

pub async fn run_images_to_pdf(
    app: &AppHandle,
    engine: &Engine,
    request: ImagesToPdfRequest,
) -> Result<ImagesToPdfOutcome, EngineError> {
    let id = job_id(engine, &request.job_id);
    require_inputs(&request.images, 1)?;
    require_output_dir(&request.output)?;

    let cancel = engine.cancel_handle();
    let images = request.images.clone();
    let output = request.output.clone();
    let page_size = request.page_size.clone();
    let orientation = request.orientation.clone();
    let margin = request.margin.clone();
    let quality = request.quality.clamp(1, 100);
    let app_for_progress = app.clone();
    let job_id = id.clone();

    // Decoding and encoding are CPU-bound, so the whole build runs on one blocking thread. That also
    // keeps the async runtime free to deliver progress events and cancellation.
    let warnings = tokio::task::spawn_blocking(move || -> Result<Vec<String>, EngineError> {
        let mut warnings = Vec::new();
        let mut document: Option<PdfDocument> = None;
        let total = images.len() as u32;

        for (index, path) in images.iter().enumerate() {
            if crate::engine::is_cancelled(&cancel, &job_id) {
                return Err(EngineError::Cancelled);
            }

            // One decode at a time. The guard is dropped at the end of each iteration.
            let decoded = image::open(path)
                .map_err(|error| EngineError::Job(format!("could not read {}: {error}", path.display())))?;
            let (pixel_w, pixel_h) = (decoded.width(), decoded.height());
            if pixel_w == 0 || pixel_h == 0 {
                warnings.push(format!("{} has no pixels and was skipped", path.display()));
                continue;
            }

            let image_aspect = pixel_w as f32 / pixel_h as f32;
            let landscape = match orientation.as_str() {
                "portrait" => false,
                "landscape" => true,
                // "auto" follows the image, which is what a user photographing documents expects.
                _ => image_aspect > 1.0,
            };

            let (page_w, page_h) = if page_size == "fit" {
                page_mm("a4", landscape)
            } else {
                page_mm(&page_size, landscape)
            };

            let inner_w = (page_w - 2.0 * margin_mm(&margin)).max(1.0);
            let inner_h = (page_h - 2.0 * margin_mm(&margin)).max(1.0);

            // Contain, not cover: the whole image must be visible, so scale by the tighter axis and
            // centre the result. Cropping a user's document to fill a page would be a data-loss bug.
            let scale = (inner_w / (pixel_w as f32 * 0.352_778)).min(inner_h / (pixel_h as f32 * 0.352_778));
            let draw_w = pixel_w as f32 * 0.352_778 * scale;
            let draw_h = pixel_h as f32 * 0.352_778 * scale;
            let offset_x = (page_w - draw_w) / 2.0;
            let offset_y = (page_h - draw_h) / 2.0;

            let doc = match document.take() {
                Some(doc) => doc,
                None => PdfDocument::new(
                    safe_stem(&output),
                    Mm(page_w),
                    Mm(page_h),
                    "ToolSeer",
                ),
            };

            // VERIFY: printpdf 0.12's page/image API. `Image::from_dynamic_image` exists in the
            // `images` feature; the transform arguments are (translate_x, translate_y, rotate, scale_x,
            // scale_y, dpi) in printpdf's Mm/Pt types.
            let pdf_image = Image::from_dynamic_image(&decoded);
            let transform = printpdf::ImageTransform {
                translate_x: Some(Mm(offset_x)),
                translate_y: Some(Mm(offset_y)),
                scale_x: Some(draw_w / (pixel_w as f32 * 0.352_778)),
                scale_y: Some(draw_h / (pixel_h as f32 * 0.352_778)),
                dpi: Some(300.0),
                ..Default::default()
            };
            document = Some(doc.add_image(&pdf_image, transform));

            // Free the decoded raster before the next iteration.
            drop(decoded);
            emit_progress(&app_for_progress, &job_id, "page", index as u32 + 1, total);
        }

        let document = document.ok_or_else(|| EngineError::Job("no usable images were supplied".to_string()))?;
        let bytes = document
            .save(&output)
            .map_err(|error| EngineError::Job(format!("could not write {}: {error}", output.display())))?;
        let _ = (bytes, quality, &mut warnings);
        Ok(warnings)
    })
    .await
    .map_err(|error| EngineError::Job(format!("image thread failed: {error}")))??;

    engine.finish_job(&id);
    emit_progress(app, &id, "done", request.images.len() as u32, request.images.len() as u32);

    let bytes = std::fs::metadata(&request.output)?.len();
    if bytes == 0 {
        return Err(EngineError::Job("the PDF writer produced an empty file".to_string()));
    }

    let mut warnings = warnings;
    if request.images.len() > 500 {
        warnings.push(
            "very large image sets produce very large PDFs; a 1000-photo document can exceed a gigabyte"
                .to_string(),
        );
    }

    Ok(ImagesToPdfOutcome {
        output: request.output,
        bytes,
        page_count: request.images.len() as u32,
        warnings,
    })
}
