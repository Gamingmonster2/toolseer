//! ⚠ UNVERIFIED SCAFFOLD — never compiled, and the Tauri dialog/IPC details were not exercised.
//!
//! The entire surface the web UI can call. Everything is deliberately path-in / path-out: the
//! webview hands over file paths it obtained from a native picker or a drag-and-drop event, and gets
//! back paths, sizes and progress numbers. No file bytes cross the boundary, which is what keeps a
//! 700-page job out of the JS heap.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::engine::{EngineError, PreflightCheck};
use crate::ops;
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub app_version: String,
    pub product_name: String,
    pub manifest_status: String,
    pub qpdf_version: String,
    pub qpdf_licence: String,
    pub pdfium_version: String,
    pub pdfium_revision: String,
    pub pdfium_licence: String,
    /// The site reads the same manifest; this is what the app shows on its About panel so the two can
    /// never drift apart in front of a user.
    pub manifest_url: String,
    pub ocr_runs_in: String,
    /// Stated in the app, not just the docs: these are the operations this build actually implements.
    pub implemented_operations: Vec<String>,
    pub not_implemented: Vec<String>,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    let manifest = state.engine.manifest();
    AppInfo {
        app_version: manifest.app.version.clone(),
        product_name: manifest.app.product_name.clone(),
        manifest_status: manifest.status.clone(),
        qpdf_version: manifest.engines.qpdf.version.clone(),
        qpdf_licence: manifest.engines.qpdf.licence.clone(),
        pdfium_version: manifest.engines.pdfium.version.clone(),
        pdfium_revision: manifest.engines.pdfium.revision.clone(),
        pdfium_licence: manifest.engines.pdfium.licence.clone(),
        manifest_url: format!("https://github.com/{}/blob/main/apps/desktop/engine-manifest.json", manifest.release.repo),
        ocr_runs_in: manifest.engines.ocr.ocr_where.clone(),
        implemented_operations: vec![
            "merge".into(),
            "split".into(),
            "organize".into(),
            "compress-lossless".into(),
            "protect".into(),
            "unlock".into(),
            "render".into(),
            "extract-text".into(),
            "images-to-pdf".into(),
        ],
        not_implemented: vec![
            "compress-lossy-image-downsampling".into(),
            "ocr-native".into(),
            "office-conversion".into(),
        ],
    }
}

#[tauri::command]
pub async fn engine_preflight(state: State<'_, AppState>) -> Result<Vec<PreflightCheck>, EngineError> {
    Ok(state.engine.preflight().await)
}

/// Native pickers. `kind` selects the filter set: "pdf", "image" or "any".
#[tauri::command]
pub async fn pick_input_files(
    app: AppHandle,
    kind: Option<String>,
    multiple: Option<bool>,
) -> Result<Vec<String>, EngineError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file();

    builder = match kind.as_deref().unwrap_or("pdf") {
        "image" => builder
            .add_filter("Images", &["png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp", "gif"])
            .add_filter("All files", &["*"]),
        "any" => builder.add_filter("All files", &["*"]),
        _ => builder.add_filter("PDF", &["pdf"]).add_filter("All files", &["*"]),
    };

    let want_multiple = multiple.unwrap_or(true);
    let callback = move |paths: Option<Vec<tauri_plugin_dialog::FilePath>>| {
        let _ = sender.send(paths);
    };

    if want_multiple {
        builder.pick_files(callback);
    } else {
        // The single-file picker needs the same shape on the receiving end, so it is normalised here
        // rather than making every caller handle two result types.
        let (single_sender, single_receiver) = tokio::sync::oneshot::channel();
        builder.pick_file(move |path| {
            let _ = single_sender.send(path);
        });
        let picked = single_receiver
            .await
            .map_err(|_| EngineError::Job("the file picker closed unexpectedly".to_string()))?;
        return Ok(picked
            .and_then(|path| path.into_path().ok())
            .map(|path| vec![path.to_string_lossy().to_string()])
            .unwrap_or_default());
    }

    let picked = receiver
        .await
        .map_err(|_| EngineError::Job("the file picker closed unexpectedly".to_string()))?;

    Ok(picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().to_string())
        .collect())
}

#[tauri::command]
pub async fn pick_output_file(app: AppHandle, default_name: Option<String>) -> Result<Option<String>, EngineError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file();
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }
    builder.save_file(move |path| {
        let _ = sender.send(path);
    });

    let picked = receiver
        .await
        .map_err(|_| EngineError::Job("the save dialog closed unexpectedly".to_string()))?;
    Ok(picked
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn pick_output_dir(app: AppHandle) -> Result<Option<String>, EngineError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = sender.send(path);
    });

    let picked = receiver
        .await
        .map_err(|_| EngineError::Job("the folder dialog closed unexpectedly".to_string()))?;
    Ok(picked
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().to_string()))
}

/// Show a finished file in Explorer. The most common next action after a long job, and it keeps the
/// user out of a file manager hunt through a scratch directory.
#[tauri::command]
pub fn reveal_in_folder(app: AppHandle, path: String) -> Result<(), EngineError> {
    let target = PathBuf::from(&path);
    // Refuse anything that does not exist rather than opening Explorer at a stale path.
    if !target.exists() {
        return Err(EngineError::Job(format!("nothing to show at {path}")));
    }
    app.opener()
        .reveal_item_in_dir(&target)
        .map_err(|error| EngineError::Job(format!("could not open the folder: {error}")))
}

#[tauri::command]
pub fn job_cancel(state: State<'_, AppState>, job_id: String) -> bool {
    state.engine.cancel(&job_id)
}

#[tauri::command]
pub async fn job_merge(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ops::merge::MergeRequest,
) -> Result<crate::engine::JobOutcome, EngineError> {
    ops::merge::run_merge(&app, &state.engine, request).await
}

#[tauri::command]
pub async fn job_split(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ops::merge::SplitRequest,
) -> Result<ops::merge::SplitOutcome, EngineError> {
    ops::merge::run_split(&app, &state.engine, request).await
}

#[tauri::command]
pub async fn job_organize(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ops::merge::OrganizeRequest,
) -> Result<crate::engine::JobOutcome, EngineError> {
    ops::merge::run_organize(&app, &state.engine, request).await
}

#[tauri::command]
pub async fn job_compress(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ops::compress::CompressRequest,
) -> Result<ops::compress::CompressOutcome, EngineError> {
    ops::compress::run_compress(&app, &state.engine, request).await
}

#[tauri::command]
pub async fn job_protect(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ops::security::ProtectRequest,
) -> Result<crate::engine::JobOutcome, EngineError> {
    ops::security::run_protect(&app, &state.engine, request).await
}

#[tauri::command]
pub async fn job_unlock(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ops::security::UnlockRequest,
) -> Result<crate::engine::JobOutcome, EngineError> {
    ops::security::run_unlock(&app, &state.engine, request).await
}

#[tauri::command]
pub async fn job_render(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ops::render::RenderRequest,
) -> Result<ops::render::RenderOutcome, EngineError> {
    ops::render::run_render(&app, &state.engine, request).await
}

#[tauri::command]
pub async fn job_extract_text(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ops::render::ExtractTextRequest,
) -> Result<ops::render::ExtractTextOutcome, EngineError> {
    ops::render::run_extract_text(&app, &state.engine, request).await
}

#[tauri::command]
pub async fn job_images_to_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ops::images_to_pdf::ImagesToPdfRequest,
) -> Result<ops::images_to_pdf::ImagesToPdfOutcome, EngineError> {
    ops::images_to_pdf::run_images_to_pdf(&app, &state.engine, request).await
}
