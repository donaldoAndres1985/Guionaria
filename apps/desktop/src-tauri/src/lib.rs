use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// En desarrollo el núcleo corre aparte con recarga en caliente (`npm run dev`),
/// salvo que se fuerce con GUIONARIA_SPAWN_CORE=1. En release siempre se lanza el sidecar.
fn should_spawn_core() -> bool {
    !cfg!(debug_assertions) || std::env::var("GUIONARIA_SPAWN_CORE").as_deref() == Ok("1")
}

/// Lanza guionaria-core pasándole nuestro PID: el núcleo se cierra solo cuando la app termina
/// (también si se cae). No se mata desde aquí porque con PyInstaller --onefile solo se mataría
/// el lanzador: el núcleo quedaría huérfano y la carpeta temporal _MEI sin borrar.
fn spawn_core(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let (mut rx, _child) = app
        .shell()
        .sidecar("guionaria-core")?
        .args(["serve", "--parent-pid", &std::process::id().to_string()])
        .spawn()?;

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

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if should_spawn_core() {
                // Si falla, la UI muestra "núcleo no disponible" y sigue funcionando.
                if let Err(err) = spawn_core(app.handle()) {
                    eprintln!("[core] no se pudo lanzar el sidecar: {err}");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar Guionaria");
}
