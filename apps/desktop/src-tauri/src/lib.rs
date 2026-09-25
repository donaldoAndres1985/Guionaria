use std::sync::Mutex;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Proceso del núcleo Python (guionaria-core) lanzado como sidecar.
struct CoreProcess(Mutex<Option<CommandChild>>);

/// En desarrollo el núcleo corre aparte con recarga en caliente (`npm run dev`),
/// salvo que se fuerce con GUIONARIA_SPAWN_CORE=1. En release siempre se lanza el sidecar.
fn should_spawn_core() -> bool {
    !cfg!(debug_assertions) || std::env::var("GUIONARIA_SPAWN_CORE").as_deref() == Ok("1")
}

fn spawn_core(app: &tauri::AppHandle) -> Result<CommandChild, Box<dyn std::error::Error>> {
    let (mut rx, child) = app.shell().sidecar("guionaria-core")?.arg("serve").spawn()?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    eprintln!("[core] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[core] terminó: {status:?}");
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(CoreProcess(Mutex::new(None)))
        .setup(|app| {
            if should_spawn_core() {
                match spawn_core(app.handle()) {
                    Ok(child) => *app.state::<CoreProcess>().0.lock().unwrap() = Some(child),
                    // La UI muestra "núcleo no disponible" y sigue funcionando.
                    Err(err) => eprintln!("[core] no se pudo lanzar el sidecar: {err}"),
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error al iniciar Guionaria");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(child) = handle.state::<CoreProcess>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
