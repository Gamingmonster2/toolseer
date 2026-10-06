//! ⚠ UNVERIFIED SCAFFOLD — never compiled, and the network path was never exercised.
//!
//! Download and verify an engine artifact at runtime.
//!
//! The normal path is that the payload is already inside the installer, verified by hash at startup.
//! This module exists for the abnormal path: a payload that is missing or corrupt. Re-downloading it
//! from the pinned tag URL, with the sha256 from the compile-time manifest, is better than telling a
//! user to reinstall - and it is the same code the build script would use if it were written in Rust.
//!
//! What it never does: follow a "latest" URL, accept an artifact whose size or hash differs from the
//! pin, or write a partially downloaded file into place. The `.part` suffix means an interrupted
//! download cannot masquerade as a verified engine.

use std::path::Path;

use futures_util::StreamExt;
use sha2::{Digest, Sha256};

use crate::engine::manifest::Artifact;
use crate::engine::EngineError;

/// Hash a file on disk, streaming, so a large file never has to be read into memory.
pub async fn sha256_file(path: &Path) -> Result<(String, u64), EngineError> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    let mut total: u64 = 0;

    loop {
        let read = tokio::io::AsyncReadExt::read(&mut file, &mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        total += read as u64;
    }

    Ok((hex::encode(hasher.finalize()), total))
}

/// Verify an artifact already on disk against its pin.
pub async fn verify(path: &Path, artifact: &Artifact, label: &str) -> Result<(), EngineError> {
    let (actual_hash, actual_size) = sha256_file(path).await?;

    if actual_size != artifact.size_bytes {
        return Err(EngineError::Integrity {
            name: format!("{label} size"),
            expected: artifact.size_bytes.to_string(),
            actual: actual_size.to_string(),
        });
    }
    if actual_hash != artifact.sha256 {
        return Err(EngineError::Integrity {
            name: label.to_string(),
            expected: artifact.sha256.clone(),
            actual: actual_hash,
        });
    }
    Ok(())
}

/// Download an artifact to `destination`, verifying while streaming, then move it into place.
///
/// The verification happens on the byte stream rather than on the finished file, so a corrupt
/// download is abandoned at the end of the transfer instead of being hashed twice as long.
pub async fn download_verified(
    client: &reqwest::Client,
    artifact: &Artifact,
    destination: &Path,
) -> Result<(), EngineError> {
    if !artifact.url.starts_with("https://") || artifact.url.contains("/releases/latest/") {
        return Err(EngineError::Job(format!(
            "refusing to fetch a mutable or insecure artifact url: {}",
            artifact.url
        )));
    }

    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let response = client
        .get(&artifact.url)
        .send()
        .await
        .map_err(|error| EngineError::Job(format!("download failed: {error}")))?;

    if !response.status().is_success() {
        return Err(EngineError::Job(format!(
            "download failed: HTTP {} from {}",
            response.status(),
            artifact.url
        )));
    }

    let part = destination.with_extension("part");
    let mut file = tokio::fs::File::create(&part).await?;
    let mut hasher = Sha256::new();
    let mut total: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| EngineError::Job(format!("download interrupted: {error}")))?;
        hasher.update(&chunk);
        total += chunk.len() as u64;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
    }
    tokio::io::AsyncWriteExt::flush(&mut file).await?;
    drop(file);

    if total != artifact.size_bytes {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(EngineError::Integrity {
            name: format!("{} size", artifact.file),
            expected: artifact.size_bytes.to_string(),
            actual: total.to_string(),
        });
    }

    let actual_hash = hex::encode(hasher.finalize());
    if actual_hash != artifact.sha256 {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(EngineError::Integrity {
            name: artifact.file.clone(),
            expected: artifact.sha256.clone(),
            actual: actual_hash,
        });
    }

    tokio::fs::rename(&part, destination).await?;
    Ok(())
}
