# Guionaria

Aplicación de escritorio local y gratuita que convierte una idea en un video listo para editar:
guion → escenas → medios → voz → timeline. La especificación completa está en [SPEC.md](SPEC.md).

## Estructura

```
apps/desktop/   App de escritorio: Tauri 2 + React + TypeScript + Tailwind + shadcn/ui
core/           Núcleo local: Python 3.12 + FastAPI + SQLModel/SQLite + Alembic (guionaria-core)
scripts/        dev.ps1 (desarrollo) y build-sidecar.ps1 (empaquetado del núcleo)
docs/           Guía de instalación y capturas de referencia de estilo
```

## Requisitos

Node LTS, Rust (MSVC), uv, FFmpeg y Claude Code CLI. Ver [docs/setup-windows.md](docs/setup-windows.md).

## Comandos (desde la raíz)

| Comando | Qué hace |
|---|---|
| `npm install` | Instala las dependencias del frontend (workspaces) |
| `npm run dev` | Arranca el núcleo con recarga (ventana minimizada aparte) y la app Tauri |
| `npm run core:dev` | Solo el núcleo en `http://127.0.0.1:8765` |
| `npm test` | Todas las pruebas: núcleo (pytest + ruff) y app (vitest) |
| `npm run core:test` | Pruebas y lint del núcleo |
| `npm run app:test` | Pruebas de la app (editor de guion, conversiones) |
| `npm run typecheck` | Chequeo de tipos del frontend |
| `npm run sidecar:build` | Empaqueta el núcleo con PyInstaller como sidecar |
| `npm run build` | Sidecar + instalador NSIS de la app |

## Datos

Todo se guarda en `%USERPROFILE%\Guionaria` (base de datos, ajustes y proyectos), fuera del repo.
Se puede cambiar con la variable de entorno `GUIONARIA_HOME`.
