//! ⚠ UNVERIFIED SCAFFOLD — never compiled, and every pdfium-render call below is written from the
//! crate's documented shape rather than from a successful compile. Reconcile method names against
//! pdfium-render 0.9.4 when Rust is available.
//!
//! PDFium does the two jobs that are inherently memory-hungry, and it does them one page at a time:
//!
//!   * rendering a page to a bitmap (PDF to images, and thumbnails),
//!   * extracting the text layer (extract text; OCR stays in the webview).
//!
//! The crucial property is that a page bitmap is created, encoded and freed inside one call. Nothing
//! here accumulates: the caller hands in an output path and gets back a byte count. That is what
//! makes a 700-page export survivable - peak memory is one page, not seven hundred.
//!
//! PDFium is loaded from the DLL we ship, at runtime, with `bind_to_library`. We never link it at
//! build time, so the pinned revision in engine-manifest.json is the single thing to bump.

use std::path::{Path, PathBuf};

use pdfium_render::prelude::*;

use crate::engine::EngineError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    Png,
    Jpeg,
}

impl ImageFormat {
    pub fn extension(self) -> &'static str {
        match self {
            ImageFormat::Png => "png",
            ImageFormat::Jpeg => "jpeg",
        }
    }
}

/// A bound PDFium library. Holding one of these for the life of the app means the DLL is loaded once
/// instead of per operation, and a bad binding fails at startup rather than mid-job.
pub struct PdfiumEngine {
    inner: Pdfium,
}

impl PdfiumEngine {
    /// Load the DLL that ships next to our executable.
    pub fn bind(dll: &Path) -> Result<Self, EngineError> {
        let directory = dll.parent().ok_or_else(|| {
            EngineError::PayloadMissing {
                name: "pdfium".to_string(),
                path: dll.to_path_buf(),
                hint: "the DLL has no parent directory, which means the path is wrong".to_string(),
            }
        })?;

        let library = Pdfium::pdfium_platform_library_name_at_path(directory);
        let inner = Pdfium::bind_to_library(library)
            .map_err(|error| EngineError::Pdfium(format!("bind_to_library failed: {error:?}")))?;

        Ok(Self { inner })
    }

    fn open(&self, file: &Path, password: Option<&str>) -> Result<PdfDocument<'_>, EngineError> {
        let document = match password {
            // A password-protected document that the user did not unlock is a user-facing condition
            // ("need-password"), not a crash, so the error code matters more than the message.
            Some(password) => self.inner.load_pdf_from_file(file, Some(password)),
            None => self.inner.load_pdf_from_file(file, None),
        };
        document.map_err(|error| EngineError::Pdfium(format!("could not open {}: {error:?}", file.display())))
    }

    pub fn page_count(&self, file: &Path, password: Option<&str>) -> Result<u32, EngineError> {
        let document = self.open(file, password)?;
        // VERIFY: 0.9 returns a narrow page index type here.
        Ok(document.pages().len() as u32)
    }

    /// Render one page to a file and return the number of bytes written.
    ///
    /// `dpi` is converted to a pixel width here rather than passed through, because PDFium wants a
    /// target size and the UI speaks in DPI. A4 at 300 dpi is 2480x3508 px, i.e. 34.8 MB as RGBA -
    /// which is precisely why this function exists per page and not per document.
    pub fn render_page_to_file(
        &self,
        file: &Path,
        page_index: u32,
        dpi: f32,
        format: ImageFormat,
        quality: u8,
        password: Option<&str>,
        output: &Path,
    ) -> Result<u64, EngineError> {
        let document = self.open(file, password)?;
        let pages = document.pages();
        let page = pages
            .get(page_index as u16)
            .map_err(|error| EngineError::Pdfium(format!("no page {page_index}: {error:?}")))?;

        // PDF user-space units are 1/72 inch, so points -> pixels is dpi/72.
        let scale = dpi / 72.0;
        let target_width = (page.width().value * scale).round().max(1.0) as i32;

        let config = PdfRenderConfig::new()
            .set_target_width(target_width)
            .set_maximum_height((page.height().value * scale).round().max(1.0) as i32);

        let bitmap = page
            .render_with_config(&config)
            .map_err(|error| EngineError::Pdfium(format!("render failed on page {page_index}: {error:?}")))?;

        let width = bitmap.width() as u32;
        let height = bitmap.height() as u32;
        let rgba = bitmap.as_rgba_bytes();

        // The bitmap is dropped here, before encoding, so only one page raster is ever live.
        drop(bitmap);

        let buffer = image::RgbaImage::from_raw(width, height, rgba)
            .ok_or_else(|| EngineError::Pdfium(format!("page {page_index} produced an unreadable bitmap")))?;

        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)?;
        }

        match format {
            ImageFormat::Png => {
                // PNG ignores `quality`; it is lossless by construction.
                image::DynamicImage::ImageRgba8(buffer)
                    .to_rgb8()
                    .save_with_format(output, image::ImageFormat::Png)
                    .map_err(|error| EngineError::Pdfium(format!("PNG encode failed: {error}")))?;
            }
            ImageFormat::Jpeg => {
                let file_handle = std::fs::File::create(output)?;
                let mut writer = std::io::BufWriter::new(file_handle);
                let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                    &mut writer,
                    quality.clamp(1, 100),
                );
                encoder
                    .encode_image(&image::DynamicImage::ImageRgba8(buffer).to_rgb8())
                    .map_err(|error| EngineError::Pdfium(format!("JPEG encode failed: {error}")))?;
            }
        }

        Ok(std::fs::metadata(output)?.len())
    }

    /// Extract the text layer of one page. Returns an empty string for a page with no text layer,
    /// which is the signal the UI uses to offer OCR instead of silently returning nothing.
    pub fn page_text(&self, file: &Path, page_index: u32, password: Option<&str>) -> Result<String, EngineError> {
        let document = self.open(file, password)?;
        let pages = document.pages();
        let page = pages
            .get(page_index as u16)
            .map_err(|error| EngineError::Pdfium(format!("no page {page_index}: {error:?}")))?;
        let text = page
            .text()
            .map_err(|error| EngineError::Pdfium(format!("text extraction failed on page {page_index}: {error:?}")))?;
        // VERIFY: 0.9 exposes an all() accessor on the text page; layout-aware extraction is what the
        // UI's `layout: true` option maps onto.
        Ok(text.all())
    }
}

/// Where a page image for `job_id` should be written. Kept here so render and the ZIP step agree on
/// the naming without either one owning the layout.
pub fn page_output_path(scratch: &Path, format: ImageFormat, page_number: u32) -> PathBuf {
    scratch.join(format!("page-{:04}.{}", page_number, format.extension()))
}
