# Instalación en Windows

## 1. Herramientas

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install Rustlang.Rustup        # luego: rustup default stable-msvc
winget install astral-sh.uv           # gestiona Python 3.12 para core/
winget install Gyan.FFmpeg
winget install Docker.DockerDesktop   # opcional, para SearXNG (Fase 2)
```

Claude Code CLI: seguir las instrucciones vigentes en docs.claude.com.

Tauri además necesita **Microsoft C++ Build Tools** ("Desarrollo de escritorio con C++") y
**WebView2** (ya viene con Windows 11).

Después de instalar, abre una terminal nueva para que se actualice el PATH.

## 2. Proyecto

```powershell
npm install                     # dependencias del frontend
cd core; uv sync; cd ..         # crea core/.venv con Python 3.12 y dependencias
npm run core:test               # verifica el núcleo
npm run dev                     # abre la app
```

La primera ejecución de `npm run dev` compila Rust y tarda unos minutos; después tarda segundos.

## 3. Verificación

En la app, **Ajustes → Dependencias** muestra qué está instalado y el comando para instalar lo que falte.
También se puede consultar `http://127.0.0.1:8765/api/health` con el núcleo corriendo.

## Notas

- En desarrollo el núcleo corre en una ventana de consola propia (minimizada): al recargar,
  uvicorn envía Ctrl+C a toda su consola y, si compartiera consola con Tauri, la cerraría también.
- Para probar el sidecar empaquetado en desarrollo: `npm run sidecar:build` y luego
  `$env:GUIONARIA_SPAWN_CORE=1; npm run tauri -w @guionaria/desktop -- dev --config src-tauri/tauri.bundle.conf.json`.
