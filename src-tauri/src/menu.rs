//! macOS menu bar: an application menu (About, Preferences, Hide, Quit) and an Edit menu. Items the page must answer are
//! plain menu items whose id is sent to the page as the Tauri event `fw-menu`; the page (frontend/src/ui/desktop.ts) turns
//! it into a DOM CustomEvent. Built on every platform so it is compile-checked everywhere, but only macOS installs it
//! (main.rs): elsewhere the page keeps its own in-window menus.

use tauri::menu::{AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

pub const EVENT: &str = "fw-menu";

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = AboutMetadata {
        name: Some("formwav".into()),
        copyright: Some("Copyright 2026 NodeAgentc, Inc. Apache-2.0".into()),
        license: Some("Apache-2.0".into()),
        ..Default::default()
    };
    let preferences = MenuItem::with_id(app, "preferences", "Preferences...", true, Some("CmdOrCtrl+,"))?;
    let application = Submenu::with_items(
        app,
        "formwav",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About formwav"), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &preferences,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?,
            &MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "cut", "Cut", true, Some("CmdOrCtrl+X"))?,
            &MenuItem::with_id(app, "copy", "Copy", true, Some("CmdOrCtrl+C"))?,
            &MenuItem::with_id(app, "paste", "Paste", true, Some("CmdOrCtrl+V"))?,
            &MenuItem::with_id(app, "select-all", "Select All", true, Some("CmdOrCtrl+A"))?,
        ],
    )?;
    Menu::with_items(app, &[&application, &edit])
}

/// Every custom item reaches the page by its id.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let _ = app.emit(EVENT, event.id().0.clone());
}
