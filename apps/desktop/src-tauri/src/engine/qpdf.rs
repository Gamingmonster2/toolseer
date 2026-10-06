//! ⚠ UNVERIFIED SCAFFOLD — never compiled, and the flag spellings below were NOT checked against a
//! real qpdf binary. Read the VERIFY block before trusting any argv.
//!
//! qpdf is driven as a child process with argv and files: no shell, no string interpolation, no
//! stdout parsing. Everything qpdf needs and produces is a path, which is exactly why this design can
//! handle a 700-page document without the bytes ever entering the JavaScript heap.
//!
//! ---------------------------------------------------------------------------------------------
//! VERIFY BEFORE RELEASE
//! The capabilities below are documented in qpdf's own manual and release notes. The exact argv
//! spelling is NOT verified here and qpdf's CLI has changed across majors - `--encrypt` in
//! particular. Before the first release, run each builder against `qpdf --help` on the pinned 12.4.2
//! binary and fix any flag that has moved. Do not ship on the assumption that these are right.
//! ---------------------------------------------------------------------------------------------

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::engine::EngineError;

/// Thin wrapper around the qpdf executable. Cheap to clone: it holds one path.
#[derive(Debug, Clone)]
pub struct Qpdf {
    exe: PathBuf,
}

impl Qpdf {
    pub fn new(exe: impl Into<PathBuf>) -> Self {
        Self { exe: exe.into() }
    }

    pub fn path(&self) -> &Path {
        &self.exe
    }

    /// Run qpdf with the given argv and fail on a non-zero exit, surfacing stderr.
    ///
    /// Output is captured rather than inherited so a GUI build never flashes a console window, and
    /// stderr is kept because qpdf's messages are the only useful diagnostic when a PDF is malformed.
    pub async fn run(&self, args: Vec<OsString>) -> Result<(), EngineError> {
        let output = tokio::process::Command::new(&self.exe)
            .args(&args)
            .stdin(std::process::Stdio::null())
            .output()
            .await?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(EngineError::Qpdf {
            code: output.status.code(),
            stderr: if stderr.is_empty() {
                format!("qpdf failed with {} and said nothing", output.status)
            } else {
                // qpdf can be chatty; the tail is where the actual error lives.
                stderr.chars().rev().take(2000).collect::<String>().chars().rev().collect()
            },
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct MergeOptions {
    pub add_bookmarks: bool,
    /// Refuse rather than silently produce an unreadable result when an input is encrypted.
    pub fail_on_encrypted: bool,
}

/// Merge N inputs into one document.
///
/// The `--empty --pages <inputs> -- <output>` shape is qpdf's documented recipe for building a new
/// document out of pages taken from others, and it streams: qpdf does not need every input resident
/// at once.
pub fn merge_args(inputs: &[PathBuf], output: &Path, options: &MergeOptions) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec![OsString::from("--empty")];
    if options.add_bookmarks {
        args.push(OsString::from("--add-attachment")); // VERIFY: bookmark/outline handling on merge
    }
    if options.fail_on_encrypted {
        args.push(OsString::from("--encryption-file-password=__FAIL__")); // VERIFY
    }
    args.push(OsString::from("--pages"));
    args.extend(inputs.iter().map(|path| path.as_os_str().to_os_string()));
    args.push(OsString::from("--"));
    args.push(output.as_os_str().to_os_string());
    args
}

#[derive(Debug, Clone)]
pub enum SplitMode {
    /// One output file per page: out-01.pdf, out-02.pdf ...
    EachPage { prefix: PathBuf },
    /// A page subset selected with qpdf's range syntax, e.g. "1-3,7".
    Ranges { ranges: String },
}

pub fn split_args(input: &Path, output: &Path, mode: &SplitMode) -> Vec<OsString> {
    match mode {
        // VERIFY: qpdf writes numbered files next to the pattern given to --split-pages.
        SplitMode::EachPage { prefix } => {
            let mut args = vec![OsString::from("--split-pages")];
            args.push(input.as_os_str().to_os_string());
            args.push(prefix.as_os_str().to_os_string());
            args
        }
        // VERIFY: `--pages . <ranges> --` selects pages from the primary input ("." means "the input
        // document itself").
        SplitMode::Ranges { ranges } => vec![
            OsString::from("--pages"),
            OsString::from("."),
            OsString::from(ranges),
            OsString::from("--"),
            input.as_os_str().to_os_string(),
            output.as_os_str().to_os_string(),
        ],
    }
}

#[derive(Debug, Clone, Default)]
pub struct OrganizeOptions {
    /// 1-based page order. Pages omitted here are dropped, which is how delete works.
    pub order: Vec<u32>,
    /// page number -> degrees clockwise, qpdf's `--rotate` accepts +90/180/270 style values.
    pub rotate: Vec<(u32, i32)>,
}

/// Reorder, drop and rotate pages in one pass.
pub fn organize_args(input: &Path, output: &Path, options: &OrganizeOptions) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::new();
    for (page, degrees) in &options.rotate {
        // VERIFY: `--rotate=[+|-]angle[:page-range]`.
        args.push(OsString::from(format!("--rotate={degrees}:{page}")));
    }
    args.push(OsString::from("--pages"));
    args.push(OsString::from("."));
    if options.order.is_empty() {
        args.push(OsString::from("1-z"));
    } else {
        args.push(OsString::from(
            options.order.iter().map(u32::to_string).collect::<Vec<_>>().join(","),
        ));
    }
    args.push(OsString::from("--"));
    args.push(input.as_os_str().to_os_string());
    args.push(output.as_os_str().to_os_string());
    args
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyLength {
    Aes256,
    Aes128,
    Rc4_128,
}

impl KeyLength {
    /// qpdf takes the key length in bits.
    fn bits(self) -> &'static str {
        match self {
            KeyLength::Aes256 => "256",
            KeyLength::Aes128 => "128",
            KeyLength::Rc4_128 => "128",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProtectOptions {
    pub user_password: String,
    pub owner_password: String,
    pub allow_print: bool,
    pub allow_copy: bool,
    pub allow_modify: bool,
    pub allow_annotate: bool,
    pub key_length: KeyLength,
}

/// Encrypt a document.
///
/// VERIFY: the `--encrypt <user> <owner> <bits> [restrictions] --` form is what qpdf documents, and
/// the restriction flags are the part most likely to have moved between majors. Test with a real
/// reader before release: an encrypted file that opens in qpdf but not in Acrobat is still a bug.
pub fn protect_args(input: &Path, output: &Path, options: &ProtectOptions) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::new();
    args.push(OsString::from("--encrypt"));
    args.push(OsString::from(&options.user_password));
    args.push(OsString::from(&options.owner_password));
    args.push(OsString::from(options.key_length.bits()));
    args.extend(
        [
            (options.allow_print, "--print=full"),
            (options.allow_modify, "--modify=all"),
            (options.allow_copy, "--extract=y"),
            (options.allow_annotate, "--annotate=y"),
        ]
        .into_iter()
        .filter(|(allowed, _)| *allowed)
        .map(|(_, flag)| OsString::from(flag)),
    );
    args.push(OsString::from("--"));
    args.push(input.as_os_str().to_os_string());
    args.push(output.as_os_str().to_os_string());
    args
}

/// Remove a password when it is known. qpdf rewrites the document without encryption.
pub fn unlock_args(input: &Path, output: &Path, password: &str) -> Vec<OsString> {
    // --password=... is a single token rather than a flag plus a value, so it is built as one string.
    // VERIFY: the same shape is expected on the pinned binary.
    vec![
        OsString::from(format!("--password={password}")),
        OsString::from("--decrypt"),
        input.as_os_str().to_os_string(),
        output.as_os_str().to_os_string(),
    ]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompressionLevel {
    /// Rebuild the structure without touching image data: always safe, sometimes only a few percent.
    LosslessStructural,
}

/// Structural compression: linearise for fast first-page display, pack objects into object streams,
/// recompress streams with maximum flate, and drop duplicate objects.
///
/// This is genuinely lossless. What it is NOT is image downsampling: the UI's "balanced"/"strong"
/// levels are rejected in ops::compress until that is implemented, because advertising a compression
/// level that does not shrink scans would be a lie to the user.
pub fn compress_args(input: &Path, output: &Path) -> Vec<OsString> {
    // VERIFY: each of these flags individually; --recompress-flate and --object-streams have been
    // stable for years, but they are still guesses until run against the pinned binary.
    vec![
        OsString::from("--linearize"),
        OsString::from("--object-streams=generate"),
        OsString::from("--compress-streams=y"),
        OsString::from("--recompress-flate"),
        OsString::from("--compression-level=9"),
        OsString::from("--remove-unreferenced-resources=yes"),
        input.as_os_str().to_os_string(),
        output.as_os_str().to_os_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// These run with `cargo test` where Rust exists. They pin the argv *shape* so a careless edit is
    /// caught, and they were NOT run when this file was written. They do not prove qpdf accepts the
    /// flags - only the VERIFY step above does that.
    #[test]
    fn merge_uses_the_empty_pages_recipe() {
        let args = merge_args(
            &[PathBuf::from("a.pdf"), PathBuf::from("b.pdf")],
            Path::new("out.pdf"),
            &MergeOptions::default(),
        );
        let rendered: Vec<String> = args.iter().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(rendered[0], "--empty");
        assert!(rendered.contains(&"--pages".to_string()));
        assert_eq!(rendered.last().unwrap(), "out.pdf");
    }

    #[test]
    fn protect_places_the_separator_before_the_paths() {
        let args = protect_args(
            Path::new("in.pdf"),
            Path::new("out.pdf"),
            &ProtectOptions {
                user_password: "u".into(),
                owner_password: "o".into(),
                allow_print: true,
                allow_copy: false,
                allow_modify: false,
                allow_annotate: false,
                key_length: KeyLength::Aes256,
            },
        );
        let rendered: Vec<String> = args.iter().map(|a| a.to_string_lossy().to_string()).collect();
        let separator = rendered.iter().position(|arg| arg == "--").expect("-- separator");
        let input = rendered.iter().position(|arg| arg == "in.pdf").expect("input path");
        assert!(separator < input, "qpdf needs -- before the file paths");
        assert!(rendered.contains(&"256".to_string()));
    }
}
