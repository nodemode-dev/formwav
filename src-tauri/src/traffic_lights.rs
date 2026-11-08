//! macOS: the window's traffic lights are centred in the page's 38 px title row (the title bar is an overlay, main.rs).
//! Tao's own traffic_light_position is not used (1.95.9): it sizes the title bar container to the button height plus y and
//! moves the buttons sideways only, so they kept the system's height whatever y said, and it reapplies that from its
//! view's drawRect. Here the container is the whole row and every button's origin is set on both axes, after each moment
//! AppKit lays the title bar out again (title, page load, resize, focus, theme, scale), and once more a moment later.

use tauri::{Runtime, Window};

#[cfg(target_os = "macos")]
const LEFT: f64 = 14.0;
#[cfg(target_os = "macos")]
const ROW: f64 = 38.0;

/// The page's title for the window: set, then the lights placed again, since AppKit lays the title bar out anew.
#[tauri::command]
pub fn set_window_title<R: Runtime>(window: Window<R>, title: String) {
    let _ = window.set_title(&title);
    place(&window);
}

#[cfg(target_os = "macos")]
pub fn place<R: Runtime>(window: &Window<R>) {
    let Ok(ns_window) = window.ns_window() else { return };
    let address = ns_window as usize;
    let _ = window.run_on_main_thread(move || unsafe { inset(address as *const objc2_app_kit::NSWindow) });
    let later = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(120));
        let _ = later.run_on_main_thread(move || unsafe { inset(address as *const objc2_app_kit::NSWindow) });
    });
}

#[cfg(not(target_os = "macos"))]
pub fn place<R: Runtime>(_window: &Window<R>) {}

#[cfg(target_os = "macos")]
unsafe fn inset(ns_window: *const objc2_app_kit::NSWindow) {
    use objc2_app_kit::NSWindowButton;

    let Some(window) = ns_window.as_ref() else { return };
    let (Some(close), Some(minimize), Some(zoom)) = (
        window.standardWindowButton(NSWindowButton::CloseButton),
        window.standardWindowButton(NSWindowButton::MiniaturizeButton),
        window.standardWindowButton(NSWindowButton::ZoomButton),
    ) else {
        return;
    };
    let Some(bar) = close.superview().and_then(|view| view.superview()) else { return };
    let close_frame = close.frame();
    let margin = ((ROW - close_frame.size.height) / 2.0).max(0.0);
    let mut bar_frame = bar.frame();
    bar_frame.size.height = ROW;
    bar_frame.origin.y = window.frame().size.height - ROW;
    bar.setFrame(bar_frame);
    let step = minimize.frame().origin.x - close_frame.origin.x;
    for (i, button) in [close, minimize, zoom].iter().enumerate() {
        let mut origin = button.frame().origin;
        origin.x = LEFT + i as f64 * step;
        origin.y = margin;
        button.setFrameOrigin(origin);
    }
}
