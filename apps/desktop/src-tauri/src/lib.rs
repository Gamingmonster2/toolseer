//! ⚠ UNVERIFIED SCAFFOLD — never compiled. Rust/cargo is not installed where this was written and
//! installing it was not approved, so nothing here has been built, run or tested. See
//! apps/desktop/README.md and docs/DESKTOP.md.
//!
//! The ToolSeer desktop shell.
//!
//! Shape of the thing:
//!   * the window is the existing ToolSeer web UI, served from the bundle (frontendDist = ../../web),
//!     so the desktop app and the site share one interface instead of forking it;
//!   * the heavy work happens in Rust, through two permissively licensed native engines, and the
//!     webview only ever sends and receives file paths and progress numbers;
//!   * there is no local HTTP server, no port and no JVM - the class of failure that comes with a
//!     bundled server (orphaned processes, firewall prompts, port conflicts) simply does not exist.
//!
//! The licence consequence, which is the reason this design replaced the original one: we bundle only
//! PDFium (BSD-3-Clause) and qpdf (Apache-2.0). Stirling-PDF is deliberately NOT bundled - see
//! engine-manifest.json -> policy.excluded for the licence text and the owner's options.

pub mod commands;
pub mod engine;
pub mod ops;

use tauri::{Emitter, Manager, RunEvent};

use engine::{Engine, EngineError};

/// Shared state handed to every command.
pub struct AppState {
    pub engine: Engine,
    /// One HTTP client for the optional payload-repair download path. Building it once avoids a new
    /// TLS stack per call.
    pub client: reqwest::Client,
}

/// Where the window shows its "starting" state before the self-check finishes.
pub const READY_EVENT: &str = "engine://ready";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manifest = match engine::manifest::load() {
        Ok(manifest) => manifest,
        Err(message) => {
            // A manifest that does not parse is a build defect. Failing loudly here is better than a
            // window that opens and then misbehaves.
            eprintln!("ToolSeer cannot start: {message}");
            std::process::exit(2);
        }
    };

    tauri::Builder::default()
        // Registered first, as the plugin requires: a second launch must focus the existing window
        // rather than start a rival copy that fights over the user's files.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let handle = app.handle().clone();
            let engine = Engine::new(&handle, manifest)?;

            app.manage(AppState {
                engine,
                client: reqwest::Client::builder()
                    .user_agent(concat!("ToolSeerDesktop/", env!("CARGO_PKG_VERSION")))
                    .build()
                    .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?,
            });

            // Self-check and window reveal happen off the main thread so the shell never looks hung.
            let handle_for_setup = handle.clone();
            tauri::async_runtime::spawn(async move {
                let state = handle_for_setup.state::<AppState>();
                // A previous run that was killed from Task Manager leaves scratch directories behind;
                // this is the backstop for the cleanup that Drop cannot do.
                state.engine.sweep_scratch().await;
                let checks = state.engine.preflight().await;
                let ok = checks.iter().all(|check| check.ok);
                let _ = handle_for_setup.emit(READY_EVENT, (ok, checks));
                if let Some(window) = handle_for_setup.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Jobs run on blocking threads and their scratch directories clean themselves up, but
                // a sweep on close means a user who quits after a cancelled export does not find a
                // multi-gigabyte folder next to their app data.
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    let engine = state.engine.paths().scratch.clone();
                    std::thread::spawn(move || {
                        let _ = std::fs::remove_dir_all(engine);
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::engine_preflight,
            commands::pick_input_files,
            commands::pick_output_file,
            commands::pick_output_dir,
            commands::reveal_in_folder,
            commands::job_cancel,
            commands::job_merge,
            commands::job_split,
            commands::job_organize,
            commands::job_compress,
            commands::job_protect,
            commands::job_unlock,
            commands::job_render,
            commands::job_extract_text,
            commands::job_images_to_pdf,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the ToolSeer shell")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // Nothing to shut down: there is no child process and no server. Scratch directories
                // are removed by the job's Drop guard or by the next start's sweep.
                let _ = app;
            }
        });
}

/// Human-readable summary of an engine failure, for the log file. The UI gets the structured code
/// through the command's error; this is what a support request should quote.
pub fn describe(error: &EngineError) -> String {
    format!("[{}] {error}", error.code())
}
