use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState, GlobalShortcutExt};

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
        .setup(|app| {
            let shell = app.shell();
            let handle = app.handle().clone();
            
            // Register global shortcut: Ctrl + Alt + S
            let ctrl_alt_s = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyS);
            
            if let Err(e) = handle.global_shortcut().register(ctrl_alt_s) {
                eprintln!("[tauri] Failed to register global shortcut: {:?}", e);
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
