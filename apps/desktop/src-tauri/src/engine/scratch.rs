//! ⚠ UNVERIFIED SCAFFOLD — never compiled. See apps/desktop/README.md.
//!
//! Per-job scratch space on the user's disk.
//!
//! This module is small but it is the load-bearing part of the memory story. A 700-page PDF to images
//! export writes 700 files; if those files lived in memory the job would die at page ~40 on a normal
//! laptop. Here they go to a job-specific directory, one page at a time, and peak memory stays at one
//! page raster no matter how many pages the document has.

use std::path::{Path, PathBuf};

use crate::engine::EngineError;

/// A throwaway directory owned by one job.
///
/// Cleanup happens in `Drop`, so a job that returns early - cancelled, engine error, panic - still
/// leaves the disk as it found it. The startup sweep in `Engine::sweep_scratch` is the backstop for
/// the cases `Drop` cannot cover: a crash, a power cut, or a kill from Task Manager.
pub struct Scratch {
    dir: PathBuf,
}

impl Scratch {
    pub fn create(root: &Path, job_id: &str) -> Result<Self, EngineError> {
        // The job id is a UUID we generated, but it is still validated before it becomes a path
        // component: cheap, and it means a future caller cannot accidentally pass user input here.
        if job_id.is_empty() || !job_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err(EngineError::Job(format!("refusing to use {job_id:?} as a scratch directory name")));
        }

        let dir = root.join(job_id);
        std::fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn path(&self) -> &Path {
        &self.dir
    }

    pub fn join(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    /// Free space at the scratch root. The UI warns before a big export rather than failing at page
    /// 650, which is the difference between a bad experience and an infuriating one.
    pub fn available_bytes(&self) -> Option<u64> {
        // VERIFY: a real implementation should query the volume, e.g. via GetDiskFreeSpaceExW on
        // Windows. Left as None rather than faked: a wrong free-space number is worse than none.
        None
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_job_id_that_is_not_a_safe_path_component() {
        let root = std::env::temp_dir().join("toolseer-scratch-test");
        assert!(Scratch::create(&root, "../escape").is_err());
        assert!(Scratch::create(&root, "").is_err());
    }
}
