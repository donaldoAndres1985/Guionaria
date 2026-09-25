"""Punto de entrada: `guionaria-core [serve|mcp]`."""

import argparse
import sys

DEFAULT_HOST = "127.0.0.1"  # solo localhost, nunca 0.0.0.0
DEFAULT_PORT = 8765


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="guionaria-core")
    sub = parser.add_subparsers(dest="command")

    serve = sub.add_parser("serve", help="Inicia la API local (por defecto)")
    serve.add_argument("--port", type=int, default=DEFAULT_PORT)
    serve.add_argument("--reload", action="store_true", help="Recarga en caliente (desarrollo)")
    serve.add_argument(
        "--parent-pid", type=int, help="PID de la app: el núcleo se cierra cuando ella termina"
    )

    sub.add_parser("mcp", help="Servidor MCP por stdio para Claude Desktop")

    args = parser.parse_args(argv)

    if args.command == "mcp":
        print("El servidor MCP llega en la Fase 2 (sección 17 de SPEC.md).", file=sys.stderr)
        return 2

    import uvicorn

    port = getattr(args, "port", DEFAULT_PORT)
    if parent_pid := getattr(args, "parent_pid", None):
        from guionaria_core.watchdog import exit_when_parent_dies

        exit_when_parent_dies(parent_pid)

    if getattr(args, "reload", False):
        # Sin límite, la recarga se traba esperando las conexiones keep-alive de la UI.
        uvicorn.run(
            "guionaria_core.main:app",
            host=DEFAULT_HOST,
            port=port,
            reload=True,
            timeout_graceful_shutdown=2,
        )
    else:
        from guionaria_core.main import app

        uvicorn.run(app, host=DEFAULT_HOST, port=port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
