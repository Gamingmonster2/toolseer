//! ⚠ UNVERIFIED SCAFFOLD — never compiled (`cargo` is not installed where this was written).
//!
//! The pins, embedded at compile time.
//!
//! `include_str!` is deliberate: engine versions, URLs, sizes and sha256 values are baked into the
//! binary, so a shipped installer can never disagree with the manifest it was built from and there is
//! no runtime file to lose or tamper with. The same JSON is what the website copies for its /desktop
//! page (see engine-manifest.json -> handoff.webCopy).
//!
//! Only the fields the shell needs are declared; serde ignores the rest by default. The manifest also
//! carries the licence policy and the excluded-engine record, which must stay in the file (and in
//! reach of a reviewer) but has no business being parsed into the binary.

use std::sync::OnceLock;

use serde::Deserialize;

/// JSON text of apps/desktop/engine-manifest.json, embedded at compile time.
pub const MANIFEST_JSON: &str = include_str!("../../../engine-manifest.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineManifest {
    #[serde(rename = "_status", default)]
    pub status: String,
    pub schema_version: u32,
    pub app: AppSection,
    pub release: ReleaseSection,
    pub engines: EnginesSection,
    pub policy: PolicySection,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSection {
    pub product_name: String,
    pub identifier: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseSection {
    pub repo: String,
    pub stable_download_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnginesSection {
    pub qpdf: QpdfSection,
    pub pdfium: PdfiumSection,
    pub ocr: OcrSection,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QpdfSection {
    pub version: String,
    pub licence: String,
    pub artifacts: Vec<Artifact>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfiumSection {
    pub version: String,
    pub revision: String,
    pub licence: String,
    pub artifacts: Vec<Artifact>,
    #[serde(default)]
    pub crate_pairing: Option<CratePairing>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CratePairing {
    /// "crate" is a Rust keyword, so the field is renamed while the JSON key stays as written.
    #[serde(rename = "crate")]
    pub crate_name: String,
    pub version: String,
    #[serde(default)]
    pub why_this_revision: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrSection {
    /// Must stay "webview". A native OCR engine was evaluated and rejected; see the manifest.
    /// Renamed explicitly because `where` is a Rust keyword and serde's camelCase conversion of
    /// `where_` is not worth relying on.
    #[serde(rename = "where")]
    pub ocr_where: String,
    pub engine: String,
    #[serde(default)]
    pub rejected_option: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub file: String,
    pub url: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicySection {
    pub attribution: AttributionSection,
    #[serde(default)]
    pub excluded: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttributionSection {
    pub file: String,
}

static CACHED: OnceLock<EngineManifest> = OnceLock::new();

/// Parse the embedded manifest once. A malformed pin is a build defect, not a user error, so the
/// message names the file to fix rather than offering a retry.
pub fn load() -> Result<&'static EngineManifest, String> {
    if let Some(cached) = CACHED.get() {
        return Ok(cached);
    }
    let parsed: EngineManifest = serde_json::from_str(MANIFEST_JSON)
        .map_err(|error| format!("engine-manifest.json is not valid for this build: {error}"))?;
    let _ = CACHED.set(parsed);
    Ok(CACHED.get().expect("just set"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// These run with `cargo test` on a machine that has Rust. They are the cheapest guard against
    /// the manifest and the code drifting apart, and they were NOT run when this file was written.
    #[test]
    fn manifest_parses_and_records_the_licence_policy() {
        let manifest = load().expect("embedded manifest parses");
        assert_eq!(manifest.schema_version, 1);
        assert!(
            manifest.policy.excluded.iter().any(|entry| entry
                .get("name")
                .and_then(|name| name.as_str())
                .is_some_and(|name| name == "Stirling-PDF")),
            "the Stirling-PDF exclusion and its reason must stay in the manifest"
        );
        assert_eq!(
            manifest.engines.ocr.ocr_where, "webview",
            "OCR stays in the webview; bundling it would add ~50 MB and a second code path"
        );
    }

    #[test]
    fn pinned_engines_are_immutable_and_hashed() {
        let manifest = load().expect("embedded manifest parses");
        for artifact in [
            &manifest.engines.qpdf.artifacts[0],
            &manifest.engines.pdfium.artifacts[0],
        ] {
            assert!(artifact.url.starts_with("https://"), "{artifact:?}");
            assert!(!artifact.url.contains("/releases/latest/"), "mutable pin: {}", artifact.url);
            assert_eq!(artifact.sha256.len(), 64, "{} is not a sha256", artifact.file);
            assert!(artifact.size_bytes > 0, "{} has no size", artifact.file);
        }
    }

    #[test]
    fn pdfium_binary_matches_the_binding_crate() {
        let manifest = load().expect("embedded manifest parses");
        let pairing = manifest
            .engines
            .pdfium
            .crate_pairing
            .as_ref()
            .expect("pdfium must record which crate revision it pairs with");
        // The DLL and the generated bindings move together: revision 7881 is what
        // pdfium-render 0.9.4's pdfium_latest feature names.
        assert!(
            pairing.why_this_revision.is_some(),
            "the pairing reason is what stops someone pinning the newest DLL by habit"
        );
    }
}
