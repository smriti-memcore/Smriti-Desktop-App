use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState, GlobalShortcutExt};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{Menu, MenuItem};

#[tauri::command]
fn open_main_window(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn hide_tray_window(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("tray-popup") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn update_tray_title(app_handle: tauri::AppHandle, title: String) {
    if let Some(tray) = app_handle.tray_by_id("main-tray") {
        let _ = tray.set_title(Some(title));
    }
}

#[tauri::command]
fn exit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app_handle, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(window) = app_handle.get_webview_window("quick-search") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build()
        )
        .invoke_handler(tauri::generate_handler![
            open_main_window,
            hide_tray_window,
            update_tray_title,
            exit_app
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            } else if let tauri::WindowEvent::Focused(false) = event {
                if window.label() == "tray-popup" {
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let shell = app.shell();
            let handle = app.handle().clone();
            
            // Register global shortcut: Ctrl + Alt + S
            let ctrl_alt_s = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyS);
            
            if let Err(e) = handle.global_shortcut().register(ctrl_alt_s) {
                eprintln!("[tauri] Failed to register global shortcut: {:?}", e);
            }

            // Setup macOS Menu Bar System Tray
            let open_main_i = MenuItem::with_id(app, "open_main", "Open Memory Palace", true, None::<&str>)?;
            let search_i = MenuItem::with_id(app, "search", "Quick Search (Ctrl+Alt+S)", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Smriti", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_main_i, &search_i, &quit_i])?;

            if let Some(icon) = app.default_window_icon() {
                let _ = TrayIconBuilder::with_id("main-tray")
                    .icon(icon.clone())
                    .title("$0.00")
                    .tooltip("SMRITI & AIMeter")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| {
                        match event.id.as_ref() {
                            "quit" => {
                                app.exit(0);
                            }
                            "open_main" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                            "search" => {
                                if let Some(window) = app.get_webview_window("quick-search") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, position, .. } = event {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("tray-popup") {
                                let is_visible = window.is_visible().unwrap_or(false);
                                if is_visible {
                                    let _ = window.hide();
                                } else {
                                    let window_width = 440.0;
                                    let x = (position.x - (window_width / 2.0)).max(10.0);
                                    let y = position.y + 8.0;
                                    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                                        x: x as i32,
                                        y: y as i32,
                                    }));
                                    let _ = window.set_always_on_top(true);
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    })
                    .build(app);
            }
            
            // Spawn the python daemon sidecar
            match shell.sidecar("smriti-daemon") {
                Ok(sidecar) => {
                    println!("[tauri] Spawning smriti-daemon sidecar...");
                    match sidecar.spawn() {
                        Ok((mut rx, _child)) => {
                            tauri::async_runtime::spawn(async move {
                                while let Some(event) = rx.recv().await {
                                    if let CommandEvent::Stdout(line) = event {
                                        let text = String::from_utf8_lossy(&line).to_string();
                                        print!("[smriti-sidecar] {}", text);
                                        let _ = handle.emit("smriti-log", text);
                                    } else if let CommandEvent::Stderr(line) = event {
                                        let text = String::from_utf8_lossy(&line).to_string();
                                        eprint!("[smriti-sidecar-err] {}", text);
                                        let _ = handle.emit("smriti-log", text);
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            eprintln!("[tauri] Error spawning sidecar: {}. Ensure you ran sidecar_build.py first.", e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[tauri] Failed to locate sidecar definition: {}", e);
                }
            }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
