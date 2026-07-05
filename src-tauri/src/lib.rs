use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let shell = app.shell();
            let handle = app.handle().clone();
            
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
