// The window shows the page the engine serves on 127.0.0.1, which Tauri treats as a remote origin: an app command reaches
// it only through a capability, and needs a generated "allow-<name>" permission. These four are the page's whole list.
const APP_COMMANDS: &[&str] = &["app_ready", "set_window_title", "text_edit", "set_menu"];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to run the Tauri build step");
}
