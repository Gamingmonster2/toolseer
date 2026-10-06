// ⚠ UNVERIFIED SCAFFOLD — never compiled. Rust/cargo is not installed in the environment where this
// was written, so this file has not even been type-checked. See apps/desktop/README.md.
//
// tauri-build reads tauri.conf.json and fails the build on an invalid or unknown key, embeds the
// Windows icon and version resources, writes the ACL schemas that capabilities/default.json
// references, and generates the permission sets for the plugins listed in Cargo.toml.

fn main() {
    tauri_build::build()
}
