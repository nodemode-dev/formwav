#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine_start;
mod menu;
mod reveal;
mod text_edit;
mod traffic_lights;
#[cfg(windows)]
mod win_job;

use std::sync::Mutex;

use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};
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
        #[cfg(windows)]
        let pid = child.pid();
        drop(child);
        #[cfg(windows)]
        {
            win_job::wait_gone(pid, win_job::LEAVE_WAIT);
            win_job::end();
        }
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

fn close_splash(handle: &tauri::AppHandle) {
    if let Some(splash) = handle.get_webview_window("splash") {
        let _ = splash.close();
    }
}

type EngineStep = Result<CommandEvent, Option<engine_start::Wait>>;

fn start_limit(late: &tauri::async_runtime::Sender<EngineStep>, limit: std::time::Duration, wait: Option<engine_start::Wait>) {
    let late = late.clone();
    std::thread::spawn(move || {
        std::thread::sleep(limit);
        let _ = late.blocking_send(Err(wait));
    });
}

fn engine_failed(handle: &tauri::AppHandle, failure: engine_start::Failure, tail: &engine_start::Tail) {
    let text = engine_start::message(&failure, &tail.lines(), engine_start::engine_log().as_deref());
    eprintln!("formwav: {text}");
    let _ = handle
        .dialog()
        .message(text)
        .title(engine_start::APP)
        .kind(tauri_plugin_dialog::MessageDialogKind::Error)
        .blocking_show();
    close_splash(handle);
    kill_backend(handle);
    handle.exit(1);
}

fn main() {
    reveal::mark_launch();
    let launched_with = std::env::args().nth(1).filter(|arg| arg.ends_with(".fmw"));
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(|handle| menu::build(handle)).on_menu_event(menu::on_event);
    let app = builder
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(
                    event,
                    WindowEvent::Resized(_) | WindowEvent::Focused(_) | WindowEvent::ThemeChanged(_) | WindowEvent::ScaleFactorChanged { .. }
                )
            {
                traffic_lights::place(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            traffic_lights::set_window_title,
            reveal::app_ready,
            text_edit::text_edit,
            menu::set_menu
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Backend(Mutex::new(None)))
        .manage(Session {
            base: Mutex::new(None),
            pending: Mutex::new(launched_with),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            reveal::round_splash(&handle);
            let started = app.shell().sidecar("formwav-engine").map_err(|_| engine_start::Failure::Missing).and_then(|engine| {
                engine
                .env("FORMWAV_PORT", "0")
                // Bundled binaries sit beside the app's executable (Contents/MacOS on macOS): the plugin host is there.
                .env("FORMWAV_HOST_BIN", std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(if cfg!(windows) { "fwhost.exe" } else { "fwhost" }))).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default())
                // AU-28: Nyquist's runner sits there too (its runtime and plug-ins travel inside the engine)
                .env("FORMWAV_FWNYQ", std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(if cfg!(windows) { "fwnyq.exe" } else { "fwnyq" }))).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default())
                // AU-40: the Vamp host sits there too
                .env("FORMWAV_FWVAMP", std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(if cfg!(windows) { "fwvamp.exe" } else { "fwvamp" }))).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default())
                // AU-27: the LV2 host sits there too
                .env("FORMWAV_FWLV2", std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(if cfg!(windows) { "fwlv2.exe" } else { "fwlv2" }))).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default())
                .env("FORMWAV_EXIT_WITH_STDIN", "1")
                .env("FORMWAV_WINDOW_KEY_STDOUT", "1")
                .env(engine_start::SHELL_ENV, std::process::id().to_string())
                .spawn()
                .map_err(|err| engine_start::Failure::NotStarted(err.to_string()))
            });
            let (mut rx, child) = match started {
                Ok(pair) => pair,
                Err(failure) => {
                    std::thread::spawn(move || engine_failed(&handle, failure, &engine_start::Tail::default()));
                    return Ok(());
                }
            };
            #[cfg(windows)]
            win_job::hold_pid(child.pid());
            app.state::<Backend>().0.lock().unwrap().replace(child);

            tauri::async_runtime::spawn(async move {
                let pattern = regex::Regex::new(r"http://127\.0\.0\.1:(\d+)").unwrap();
                let key_pattern = regex::Regex::new(r"formwav-window-key: ([A-Za-z0-9_-]{32,})").unwrap();
                let (tx, mut events) = tauri::async_runtime::channel::<EngineStep>(64);
                let late = tx.clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        if tx.send(Ok(event)).await.is_err() {
                            break;
                        }
                    }
                    let _ = tx.send(Err(None)).await;
                });
                start_limit(&late, engine_start::Wait::Address.limit(), Some(engine_start::Wait::Address));
                let mut port: Option<u16> = None;
                let mut key: Option<String> = None;
                let mut waiting = false;
                let mut stopped = false;
                let mut tail = engine_start::Tail::default();
                let mut failure = engine_start::Failure::Stopped(None);
                while let Some(step) = events.recv().await {
                    let text = match step {
                        Ok(CommandEvent::Stdout(bytes)) => {
                            let text = String::from_utf8_lossy(&bytes).into_owned();
                            if key.is_none() {
                                key = key_pattern.captures(&text).map(|found| found[1].to_string());
                            }
                            text
                        }
                        Ok(CommandEvent::Stderr(bytes)) => String::from_utf8_lossy(&bytes).into_owned(),
                        Ok(CommandEvent::Terminated(ended)) => {
                            failure = engine_start::Failure::Stopped(ended.code);
                            stopped = true;
                            start_limit(&late, engine_start::EXIT_WAIT, None);
                            continue;
                        }
                        Ok(_) => continue,
                        Err(None) => break,
                        Err(Some(_)) if stopped => break,
                        Err(Some(engine_start::Wait::Address)) if port.is_some() => continue,
                        Err(Some(wait)) => {
                            failure = engine_start::Failure::TimedOut(wait);
                            break;
                        }
                    };
                    for line in text.lines() {
                        tail.push(line);
                    }
                    if port.is_none() {
                        port = pattern.captures(&text).and_then(|c| c[1].parse::<u16>().ok());
                    }
                    if port.is_some() && key.is_some() {
                        break;
                    }
                    if port.is_some() && !waiting {
                        waiting = true;
                        start_limit(&late, engine_start::Wait::Key.limit(), Some(engine_start::Wait::Key));
                    }
                }
                drop(late);
                match port.filter(|_| key.is_some()) {
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
                        let builder = WebviewWindowBuilder::new(
                            &handle,
                            "main",
                            WebviewUrl::External(with_open(&base, pending.as_deref())),
                        )
                        .title("FormWav")
                        .visible(reveal::BUILD_VISIBLE)
                        .background_color(reveal::BACKGROUND)
                        .inner_size(width, height)
                        .min_inner_size(MIN_LOGICAL.0, MIN_LOGICAL.1)
                        .center()
                        // Files dropped on the window reach the page as ordinary DOM drop events.
                        .disable_drag_drop_handler();
                        let origin = format!("http://127.0.0.1:{found}");
                        let builder = match &key {
                            Some(value) => builder.initialization_script(format!(
                                "if (window.location.origin === {origin:?}) {{ window.__FORMWAV_WINDOW_KEY = {value:?}; }}"
                            )),
                            None => builder,
                        };
                        // macOS: the page's 38 px title row is the title bar (traffic lights over it, native title hidden).
                        #[cfg(target_os = "macos")]
                        let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
                        // Windows and Linux: the page draws its own caption buttons (frontend/src/ui/desktop.ts).
                        #[cfg(not(target_os = "macos"))]
                        let builder = builder.decorations(false);
                        let builder = builder.on_page_load(|window, payload| {
                            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                                traffic_lights::place(&window.as_ref().window());
                            }
                        });
                        match builder.build() {
                            Ok(window) => {
                                reveal::conceal(&window);
                                traffic_lights::place(&window.as_ref().window());
                            }
                            Err(_) => engine_failed(&handle, engine_start::Failure::Window, &engine_start::Tail::default()),
                        }
                    }
                    None => engine_failed(&handle, failure, &tail),
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
