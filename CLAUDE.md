# CLAUDE.md — Guionaria

- La especificación completa está en `SPEC.md`. Léela antes de cualquier tarea.
- Las imágenes de `docs/ui-reference/` son referencia de estilo y layout (sección 15 de SPEC.md). No copiar marca, logo ni textos de esa aplicación.
- Idioma: responder y comentar en español; código e identificadores en inglés.
- Restricción: solo herramientas y servicios gratuitos / open source.
- IA: solo Claude (Claude Code CLI y MCP). No usar Ollama ni otros LLM locales.
- Stack: Tauri 2 + React/TypeScript (apps/desktop), Python 3.12 + FastAPI + FastMCP + SQLite (core/).
- Trabajar por fases (sección 17). Mostrar plan antes de crear archivos.
- Nunca guardar API keys en el código: van en config/settings.json fuera del repo.

## Comandos

- `npm run dev`: núcleo (uvicorn --reload, consola aparte) + app Tauri.
- `npm run core:test`: pytest + ruff del núcleo (desde `core/`: `uv run pytest -q`).
- `npm run typecheck`: tipos del frontend.
- `npm run sidecar:build` / `npm run build`: PyInstaller + instalador.
- Nueva migración: `cd core; uv run alembic revision --autogenerate -m "..."` y revisar el archivo generado.

## Convenciones

- Datos del usuario en `GUIONARIA_HOME` (por defecto `%USERPROFILE%\Guionaria`).
- El núcleo escucha solo en `127.0.0.1:8765`; CORS limitado al webview de Tauri y a Vite.
- UI: tokens de diseño en `apps/desktop/src/styles/globals.css`. El naranja de marca es `primary`/`brand`;
  en shadcn `accent` es el fondo de hover.
- Cada pantalla usa `PageLayout` (el encabezado es también la barra de título de la ventana).
- Componentes shadcn: `npx shadcn@latest add <componente>` desde `apps/desktop` y revisar que el import de `cn` sea `@/lib/utils`.
