//! macOS menu bar: an application menu (About, Preferences, Hide, Quit) and then the app's own menus. The shell builds
//! the application menu and an Edit menu itself at start; once the page is up it sends its menus (File, Edit, View, Track,
//! Clip, Event, Transport, Extensions, Settings, read from the one list the in-window menus are made from) through
//! `set_menu`, and they replace the Edit menu. Items the page must answer are plain menu items whose id is sent to the
//! page as the Tauri event `fw-menu`; the page (frontend/src/ui/desktop.ts) turns it into a DOM CustomEvent. Built on
//! every platform so it is compile-checked everywhere, but only macOS installs it (main.rs): elsewhere the page keeps its
//! own in-window menus.

use serde::Deserialize;
use tauri::menu::{AboutMetadata, CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

pub const EVENT: &str = "fw-menu";

/// One entry of a menu the page describes: an item (id, label, an accelerator, whether it is enabled, checked or not), a
/// separator, or a submenu with its own entries. The page may describe menus and nothing more: it is handed no menu API.
#[derive(Deserialize)]
pub struct Entry {
    pub kind: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub accel: Option<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub checked: Option<bool>,
    #[serde(default)]
    pub items: Vec<Entry>,
}

fn yes() -> bool {
    true
}

fn entry<R: Runtime>(app: &AppHandle<R>, spec: &Entry, depth: usize) -> tauri::Result<Option<Box<dyn IsMenuItem<R>>>> {
    Ok(match spec.kind.as_str() {
        "sep" => Some(Box::new(PredefinedMenuItem::separator(app)?)),
        "sub" if depth < 4 => {
            let inner = entries(app, &spec.items, depth + 1)?;
            let refs: Vec<&dyn IsMenuItem<R>> = inner.iter().map(|b| b.as_ref()).collect();
            Some(Box::new(Submenu::with_items(app, spec.label.as_str(), true, &refs)?))
        }
        "item" if !spec.id.is_empty() => {
            // a shortcut the system cannot parse leaves the item without one rather than losing the menu
            let make = |accel: Option<&str>| -> tauri::Result<Box<dyn IsMenuItem<R>>> {
                Ok(match spec.checked {
                    Some(on) => Box::new(CheckMenuItem::with_id(app, spec.id.as_str(), spec.label.as_str(), spec.enabled, on, accel)?),
                    None => Box::new(MenuItem::with_id(app, spec.id.as_str(), spec.label.as_str(), spec.enabled, accel)?),
                })
            };
            Some(match make(spec.accel.as_deref()) {
                Ok(item) => item,
                Err(_) => make(None)?,
            })
        }
        _ => None,
    })
}

fn entries<R: Runtime>(app: &AppHandle<R>, list: &[Entry], depth: usize) -> tauri::Result<Vec<Box<dyn IsMenuItem<R>>>> {
    let mut made = Vec::new();
    for spec in list {
        if let Some(item) = entry(app, spec, depth)? {
            made.push(item);
        }
    }
    Ok(made)
}

/// The application menu, then the page's menus (the menu bar's items after the application's own).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn with_menus<R: Runtime>(app: &AppHandle<R>, menus: &[Entry]) -> tauri::Result<Menu<R>> {
    let application = application_menu(app)?;
    let made = entries(app, menus, 0)?;
    let mut all: Vec<&dyn IsMenuItem<R>> = vec![&application];
    all.extend(made.iter().map(|b| b.as_ref()));
    Menu::with_items(app, &all)
}

/// The page's menus, set as the application's menu bar (macOS); a no-op elsewhere, where the page keeps its own.
#[tauri::command]
pub fn set_menu<R: Runtime>(app: AppHandle<R>, menus: Vec<Entry>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        app.run_on_main_thread(move || {
            if let Ok(menu) = with_menus(&handle, &menus) {
                let _ = menu.set_as_app_menu();
            }
        })
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (&app, &menus);
    Ok(())
}

fn application_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let about = AboutMetadata {
        name: Some("FormWav".into()),
        copyright: Some("Copyright 2026 NodeAgentc, Inc. Apache-2.0".into()),
        license: Some("Apache-2.0".into()),
        ..Default::default()
    };
    let preferences = MenuItem::with_id(app, "preferences", "Preferences...", true, Some("CmdOrCtrl+,"))?;
    Submenu::with_items(
        app,
        "FormWav",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About FormWav"), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &preferences,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Hide FormWav"))?,
            &PredefinedMenuItem::quit(app, Some("Quit FormWav"))?,
        ],
    )
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let application = application_menu(app)?;
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
