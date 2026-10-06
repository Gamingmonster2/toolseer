//! ⚠ UNVERIFIED SCAFFOLD — never compiled. See apps/desktop/README.md.
//!
//! A minimal streaming ZIP writer using the STORE method (no compression).
//!
//! Why hand-rolled instead of a crate: this is ~60 lines of a public format, it keeps an unverified
//! licence off the dependency list, and for the case it exists for - bundling hundreds of already
//! compressed page images - deflate would not shrink the result anyway. PNG output could benefit, and
//! that is the one reason to replace this with a real zip implementation later.
//!
//! LIMIT, stated plainly: no ZIP64. Every offset and size in this format is 32-bit, so the archive is
//! capped just under 4 GiB, and the writer refuses past ~3.9 GiB rather than writing a file that other
//! tools will silently misread. A 700-page export at 300 dpi can reach that, which is why the refusal
//! is a feature: the caller keeps the individual images on disk and tells the user.

use std::fs::File;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

use crate::engine::EngineError;

const MAX_ARCHIVE_BYTES: u64 = 3_900_000_000;
const METHOD_STORE: u16 = 0;
const LOCAL_HEADER_SIG: u32 = 0x0403_4b50;
const CENTRAL_HEADER_SIG: u32 = 0x0201_4b50;
const EOCD_SIG: u32 = 0x0605_4b50;

const CRC_TABLE: [u32; 256] = build_crc_table();

const fn build_crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut index = 0usize;
    while index < 256 {
        let mut value = index as u32;
        let mut bit = 0;
        while bit < 8 {
            value = if value & 1 == 1 { 0xEDB8_8320 ^ (value >> 1) } else { value >> 1 };
            bit += 1;
        }
        table[index] = value;
        index += 1;
    }
    table
}

fn crc32_update(mut crc: u32, data: &[u8]) -> u32 {
    for byte in data {
        crc = CRC_TABLE[((crc ^ *byte as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc
}

struct Entry {
    name: String,
    crc: u32,
    size: u32,
    offset: u32,
}

/// Writes files into a ZIP archive one at a time. Each source file is read in chunks and released
/// immediately, so the writer's own memory use is one buffer regardless of how many pages are added.
pub struct ZipStore {
    writer: BufWriter<File>,
    entries: Vec<Entry>,
    offset: u64,
}

impl ZipStore {
    pub fn create(path: &Path) -> Result<Self, EngineError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Ok(Self {
            writer: BufWriter::new(File::create(path)?),
            entries: Vec::new(),
            offset: 0,
        })
    }

    pub fn add_file(&mut self, source: &Path, name_in_archive: &str) -> Result<(), EngineError> {
        let mut file = File::open(source)?;
        let size = file.metadata()?.len();

        if size > u32::MAX as u64 || self.offset + size > MAX_ARCHIVE_BYTES {
            return Err(EngineError::Job(format!(
                "archive would exceed the 4 GiB ZIP limit; the images are still on disk in {}",
                source.parent().map(Path::display).map(|p| p.to_string()).unwrap_or_default()
            )));
        }

        let mut crc = 0u32;
        let mut buffer = vec![0u8; 1 << 20];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            crc = crc32_update(crc, &buffer[..read]);
        }

        let header = self.offset;
        let name_bytes = name_in_archive.as_bytes();
        let mut local = Vec::with_capacity(30 + name_bytes.len());
        local.extend_from_slice(&LOCAL_HEADER_SIG.to_le_bytes());
        local.extend_from_slice(&20u16.to_le_bytes()); // version needed
        local.extend_from_slice(&0u16.to_le_bytes()); // flags
        local.extend_from_slice(&METHOD_STORE.to_le_bytes());
        local.extend_from_slice(&0u16.to_le_bytes()); // mod time
        local.extend_from_slice(&0u16.to_le_bytes()); // mod date
        local.extend_from_slice(&crc.to_le_bytes());
        local.extend_from_slice(&(size as u32).to_le_bytes());
        local.extend_from_slice(&(size as u32).to_le_bytes());
        local.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        local.extend_from_slice(&0u16.to_le_bytes()); // extra length
        local.extend_from_slice(name_bytes);
        self.writer.write_all(&local)?;

        file.seek(SeekFrom::Start(0))?;
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            self.writer.write_all(&buffer[..read])?;
        }

        self.offset += local.len() as u64 + size;
        self.entries.push(Entry {
            name: name_in_archive.to_string(),
            crc,
            size: size as u32,
            offset: header as u32,
        });
        Ok(())
    }

    pub fn finish(mut self) -> Result<u64, EngineError> {
        let central_offset = self.offset;
        let mut central_size = 0u64;

        for entry in &self.entries {
            let name_bytes = entry.name.as_bytes();
            let mut header = Vec::with_capacity(46 + name_bytes.len());
            header.extend_from_slice(&CENTRAL_HEADER_SIG.to_le_bytes());
            header.extend_from_slice(&20u16.to_le_bytes()); // version made by
            header.extend_from_slice(&20u16.to_le_bytes()); // version needed
            header.extend_from_slice(&0u16.to_le_bytes()); // flags
            header.extend_from_slice(&METHOD_STORE.to_le_bytes());
            header.extend_from_slice(&0u16.to_le_bytes()); // time
            header.extend_from_slice(&0u16.to_le_bytes()); // date
            header.extend_from_slice(&entry.crc.to_le_bytes());
            header.extend_from_slice(&entry.size.to_le_bytes());
            header.extend_from_slice(&entry.size.to_le_bytes());
            header.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
            header.extend_from_slice(&0u16.to_le_bytes()); // extra
            header.extend_from_slice(&0u16.to_le_bytes()); // comment
            header.extend_from_slice(&0u16.to_le_bytes()); // disk number
            header.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
            header.extend_from_slice(&0u32.to_le_bytes()); // external attrs
            header.extend_from_slice(&entry.offset.to_le_bytes());
            header.extend_from_slice(name_bytes);
            self.writer.write_all(&header)?;
            central_size += header.len() as u64;
        }

        let mut eocd = Vec::with_capacity(22);
        eocd.extend_from_slice(&EOCD_SIG.to_le_bytes());
        eocd.extend_from_slice(&0u16.to_le_bytes());
        eocd.extend_from_slice(&0u16.to_le_bytes());
        eocd.extend_from_slice(&(self.entries.len() as u16).to_le_bytes());
        eocd.extend_from_slice(&(self.entries.len() as u16).to_le_bytes());
        eocd.extend_from_slice(&(central_size as u32).to_le_bytes());
        eocd.extend_from_slice(&(central_offset as u32).to_le_bytes());
        eocd.extend_from_slice(&0u16.to_le_bytes()); // comment length
        self.writer.write_all(&eocd)?;
        self.writer.flush()?;

        Ok(central_offset + central_size + eocd.len() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// NOT RUN when this file was written. The value is the standard CRC-32 of "123456789".
    #[test]
    fn crc32_matches_the_reference_vector() {
        assert_eq!(crc32_update(0, b"123456789"), 0xCBF4_3926);
    }
}
