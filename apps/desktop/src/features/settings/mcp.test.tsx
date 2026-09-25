import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpInfo } from "@/lib/api";
import { McpSettings } from "./McpSettings";

const info = (over: Partial<McpInfo> = {}): McpInfo => ({
  http_url: "http://127.0.0.1:8765/mcp",
  claude_code_command: "claude mcp add --transport http --scope user guionaria http://127.0.0.1:8765/mcp",
  desktop_config: '{\n  "mcpServers": {\n    "guionaria": {\n      "command": "C:\\\\Guionaria\\\\guionaria-core.exe",\n      "args": ["mcp"]\n    }\n  }\n}',
  claude_code_available: true,
  claude_code_registered: false,
  ...over,
});

describe("conexión MCP", () => {
  let server: McpInfo;
  let posts: string[];

  beforeEach(() => {
    posts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (init?.method === "POST") {
          posts.push(path);
          server = { ...server, claude_code_registered: true };
        }
        return new Response(JSON.stringify(server));
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderSettings() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <McpSettings />
      </QueryClientProvider>,
    );
  }

  it("registra Guionaria en Claude Code", async () => {
    server = info();
    renderSettings();
    expect(await screen.findByText("Guionaria todavía no está registrado en Claude Code.")).toBeTruthy();
    expect(screen.getByText(info().claude_code_command)).toBeTruthy();
    expect(screen.getByText(/"mcpServers"/)).toBeTruthy();
    fireEvent.click(screen.getByText("Registrar en Claude Code"));
    await waitFor(() => expect(posts).toEqual(["/api/integrations/mcp:register-claude-code"]));
    expect(await screen.findByText(/registrado en Claude Code para todos tus proyectos/)).toBeTruthy();
    expect(screen.queryByText("Registrar en Claude Code")).toBeNull();
  });

  it("sin Claude Code instalado no ofrece registrar", async () => {
    server = info({ claude_code_available: false, claude_code_registered: null });
    renderSettings();
    expect(await screen.findByText("No se encontró Claude Code CLI en este equipo.")).toBeTruthy();
    expect(screen.queryByText("Registrar en Claude Code")).toBeNull();
  });

  it("copia el comando", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    server = info();
    renderSettings();
    await screen.findByText(info().claude_code_command);
    fireEvent.click(screen.getAllByLabelText("Copiar")[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(info().claude_code_command));
  });
});
