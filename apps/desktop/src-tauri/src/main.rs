// ⚠ UNVERIFIED SCAFFOLD — never compiled. Rust/cargo is not installed where this was written.
//
// Windows release builds must not open a console window behind the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    toolseer_desktop_lib::run()
}
