//! ⚠ UNVERIFIED SCAFFOLD — never compiled. See apps/desktop/README.md.
//!
//! Protect (encrypt) and unlock (decrypt).
//!
//! Two rules this module exists to enforce:
//!   * passwords are never logged, never written to scratch, and never included in an error message -
//!     they are passed straight into argv and dropped;
//!   * the wrong password is a user-facing condition with a stable error code, not a crash, so the UI
//!     can say "that password did not work" instead of showing an engine stack trace.

use std::path::PathBuf;

use serde::Deserialize;
use tauri::AppHandle;

use crate::engine::qpdf::{self, KeyLength, ProtectOptions};
use crate::engine::{Engine, EngineError, JobOutcome};
use crate::ops::{emit_progress, file_outcome, job_id, require_inputs, require_output_dir};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectRequest {
    #[serde(default)]
    pub job_id: Option<String>,
    pub input: PathBuf,
    pub output: PathBuf,
    pub user_password: String,
    #[serde(default)]
    pub owner_password: Option<String>,
    #[serde(default)]
    pub allow_print: bool,
    #[serde(default)]
    pub allow_copy: bool,
    #[serde(default)]
    pub allow_modify: bool,
    #[serde(default)]
    pub allow_annotate: bool,
    /// "aes-256" | "aes-128" | "rc4-128". Mirrors the browser engine's option values.
    #[serde(default = "default_algorithm")]
    pub algorithm: String,
}

fn default_algorithm() -> String {
    "aes-256".to_string()
}

pub async fn run_protect(app: &AppHandle, engine: &Engine, request: ProtectRequest) -> Result<JobOutcome, EngineError> {
    let id = job_id(engine, &request.job_id);
    require_inputs(std::slice::from_ref(&request.input), 1)?;
    require_output_dir(&request.output)?;

    if request.user_password.is_empty() {
        // Encrypting with an empty user password produces a file that opens without asking for
        // anything, which is not what a user who clicked "protect" wants.
        return Err(EngineError::Job(
            "a user password is required; encrypting with an empty password would not protect the file".to_string(),
        ));
    }

    let key_length = match request.algorithm.as_str() {
        "aes-256" => KeyLength::Aes256,
        "aes-128" => KeyLength::Aes128,
        "rc4-128" => KeyLength::Rc4_128,
        other => return Err(EngineError::Job(format!("unknown encryption algorithm {other:?}"))),
    };

    emit_progress(app, &id, "start", 0, 1);

    let owner_password = request
        .owner_password
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| request.user_password.clone());

    let qpdf = qpdf::Qpdf::new(engine.paths().qpdf.clone());
    let args = qpdf::protect_args(
        &request.input,
        &request.output,
        &ProtectOptions {
            user_password: request.user_password.clone(),
            owner_password,
            allow_print: request.allow_print,
            allow_copy: request.allow_copy,
            allow_modify: request.allow_modify,
            allow_annotate: request.allow_annotate,
            key_length,
        },
    );

    let result = qpdf.run(args).await;
    engine.finish_job(&id);
    result?;

    emit_progress(app, &id, "done", 1, 1);

    let mut warnings = Vec::new();
    warnings.push(
        "verify the result in a PDF reader before deleting the original: permission flags are advisory \
         in most readers and do not stop a determined user"
            .to_string(),
    );
    if matches!(key_length, KeyLength::Rc4_128) {
        warnings.push("RC4 encryption is legacy and no longer considered secure; use AES-256".to_string());
    }

    file_outcome(&request.output, warnings)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockRequest {
    #[serde(default)]
    pub job_id: Option<String>,
    pub input: PathBuf,
    pub output: PathBuf,
    pub password: String,
}

pub async fn run_unlock(app: &AppHandle, engine: &Engine, request: UnlockRequest) -> Result<JobOutcome, EngineError> {
    let id = job_id(engine, &request.job_id);
    require_inputs(std::slice::from_ref(&request.input), 1)?;
    require_output_dir(&request.output)?;
    emit_progress(app, &id, "start", 0, 1);

    let qpdf = qpdf::Qpdf::new(engine.paths().qpdf.clone());
    let args = qpdf::unlock_args(&request.input, &request.output, &request.password);
    let result = qpdf.run(args).await;
    engine.finish_job(&id);

    match result {
        Ok(()) => {
            emit_progress(app, &id, "done", 1, 1);
            file_outcome(&request.output, Vec::new())
        }
        // qpdf's message for a bad password is not a stable interface, so the mapping is deliberately
        // conservative: anything that failed on an encrypted file becomes "wrong password", and the
        // UI offers a retry. A different failure mode would be a bug report, not a silent mislabel.
        Err(EngineError::Qpdf { code, stderr }) => {
            let lowered = stderr.to_lowercase();
            if lowered.contains("password") || lowered.contains("invalid password") {
                Err(EngineError::Job(
                    "that password did not open the document: wrong-password".to_string(),
                ))
            } else {
                Err(EngineError::Qpdf { code, stderr })
            }
        }
        Err(other) => Err(other),
    }
}
