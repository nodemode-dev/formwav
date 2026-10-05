#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct Backend(Mutex<Option<CommandChild>>);

struct Session {
    base: Mutex<Option<Url>>,
    pending: Mutex<Option<String>>,
}

const FALLBACK_LOGICAL: (f64, f64) = (1323.0, 860.0);
const MIN_LOGICAL: (f64, f64) = (980.0, 640.0);
const SCREEN_FRACTION: f64 = 0.9;

fn kill_backend(handle: &tauri::AppHandle) {
    // Dropping the child closes its stdin, on which the engine ends (FORMWAV_EXIT_WITH_STDIN), letting the onefile's
    // bootloader remove its unpack folder; SIGKILL left that folder (about 90 MB) behind in the temp folder each quit.
    if let Some(child) = handle.state::<Backend>().0.lock().unwrap().take() {
        drop(child);
    }
}

fn with_open(base: &Url, path: Option<&str>) -> Url {
    let mut url = base.clone();
    if let Some(path) = path {
        url.query_pairs_mut().append_pair("open", path);
    }
    url
}

#[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
fn open_session(handle: &tauri::AppHandle, path: String) {
    let base = handle.state::<Session>().base.lock().unwrap().clone();
    match (base, handle.get_webview_window("main")) {
        (Some(base), Some(window)) => {
            let _ = window.navigate(with_open(&base, Some(&path)));
            let _ = window.set_focus();
        }
        _ => {
            handle.state::<Session>().pending.lock().unwrap().replace(path);
        }
    }
}

fn main() {
    let launched_with = std::env::args().nth(1).filter(|arg| arg.ends_with(".fmw"));
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Backend(Mutex::new(None)))
        .manage(Session {
            base: Mutex::new(None),
            pending: Mutex::new(launched_with),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let (mut rx, child) = app
                .shell()
                .sidecar("formwav-engine")
                .expect("the engine sidecar is bundled")
                .env("FORMWAV_PORT", "0")
                // Bundled binaries sit beside the app's executable (Contents/MacOS on macOS): the plugin host is there.
                .env("FORMWAV_HOST_BIN", std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(if cfg!(windows) { "fwhost.exe" } else { "fwhost" }))).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default())
                // AU-28: Nyquist's runner sits there too (its runtime and plug-ins travel inside the engine)
                .env("FORMWAV_FWNYQ", std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(if cfg!(windows) { "fwnyq.exe" } else { "fwnyq" }))).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default())
                .env("FORMWAV_EXIT_WITH_STDIN", "1")
                .spawn()
                .expect("the formwav engine failed to spawn");
            app.state::<Backend>().0.lock().unwrap().replace(child);

            tauri::async_runtime::spawn(async move {
                let pattern = regex::Regex::new(r"http://127\.0\.0\.1:(\d+)").unwrap();
                let mut port: Option<u16> = None;
                while let Some(event) = rx.recv().await {
                    let line = match event {
                        CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                            String::from_utf8_lossy(&bytes).into_owned()
                        }
                        CommandEvent::Terminated(_) => break,
                        _ => continue,
                    };
                    if let Some(captures) = pattern.captures(&line) {
                        port = captures[1].parse().ok();
                        if port.is_some() {
                            break;
                        }
                    }
                }
                match port {
                    Some(found) => {
                        let base: Url = format!("http://127.0.0.1:{found}/")
                            .parse()
                            .expect("loopback url");
                        handle.state::<Session>().base.lock().unwrap().replace(base.clone());
                        let pending = handle.state::<Session>().pending.lock().unwrap().take();
                        let (width, height) = handle
                            .primary_monitor()
                            .ok()
                            .flatten()
                            .map(|monitor| {
                                let size = monitor.size();
                                let scale = monitor.scale_factor();
                                (
                                    (size.width as f64 / scale) * SCREEN_FRACTION,
                                    (size.height as f64 / scale) * SCREEN_FRACTION,
                                )
                            })
                            .unwrap_or(FALLBACK_LOGICAL);
                        let _ = WebviewWindowBuilder::new(
                            &handle,
                            "main",
                            WebviewUrl::External(with_open(&base, pending.as_deref())),
                        )
                        .title("formwav")
                        .inner_size(width, height)
                        .min_inner_size(MIN_LOGICAL.0, MIN_LOGICAL.1)
                        .center()
                        .build();
                    }
                    None => {
                        handle
                            .dialog()
                            .message("The formwav engine failed to start. Please relaunch formwav.")
                            .blocking_show();
                        kill_backend(&handle);
                        std::process::exit(1);
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the formwav app should build");

    app.run(|handle, event| match event {
        RunEvent::Exit => kill_backend(handle),
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        RunEvent::Opened { urls } => {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    open_session(handle, path.to_string_lossy().into_owned());
                }
            }
        }
        _ => {}
    });
}
