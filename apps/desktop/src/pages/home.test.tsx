import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/api";
import { HomePage } from "./Home";

const navigate = vi.fn();
vi.mock("react-router", async (orig) => ({ ...(await orig<typeof import("react-router")>()), useNavigate: () => navigate }));

const project = (over: Partial<Project>): Project => ({
  id: 1, channel_id: 1, channel_name: "Crimen Real", channel_slug: "crimen-real", title: "El caso",
  slug: "el-caso", format: "reel", status: "MEDIOS_EN_REVISION", topic: null, research_notes: null,
  target_duration_s: 60, target_publish_at: null, priority: 2, tags: [], folder_path: "",
  parent_project_id: null, created_at: "", updated_at: "2026-09-27T10:00:00", ...over,
});

describe("pantalla de Inicio", () => {
  let projects: Project[];

  beforeEach(() => {
    navigate.mockReset();
    projects = [
      project({ id: 1, title: "D. B. Cooper", status: "RENDERIZADO", target_publish_at: "2026-09-28" }),
      project({ id: 2, title: "Caso Priscila", status: "MEDIOS_EN_REVISION", target_publish_at: "2026-10-15" }),
      project({ id: 3, title: "Publicado", status: "PUBLICADO" }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        const ok = (d: unknown) => new Response(JSON.stringify(d));
        if (path === "/api/projects") return ok(projects);
        if (path === "/api/channels") return ok([{ id: 1, name: "Crimen Real" }]);
        if (path === "/api/ideas") return ok([{ id: 1 }, { id: 2 }]);
        if (path === "/api/library/stats") return ok({ assets: 25, bytes: 1, unique_bytes: 1, saved_bytes: 2048, duplicate_groups: 0 });
        if (path === "/api/health") {
          return ok({ status: "ok", version: "0.1", home: "C:\\G", db_ok: true, dependencies: [
            { name: "ffmpeg", label: "FFmpeg", ok: true, required: true, version: null, path: null, detail: null, install_hint: "" },
            { name: "searxng", label: "SearXNG", ok: false, required: false, version: null, path: null, detail: null, install_hint: "" },
          ] });
        }
        if (path === "/api/settings") return ok({ api_keys: { pexels: "x", pixabay: "", unsplash: "", freesound: "", elevenlabs: "y" } });
        if (path === "/api/integrations/mcp") return ok({ claude_code_registered: true });
        return ok([]);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderHome() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("presenta Guionaria con el titular en estilo subtítulo", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: "De una idea a un video listo." })).toBeTruthy();
    expect(screen.getByTestId("caption-monitor").textContent).toContain("DE");
    expect(screen.getByText("Qué incluye Guionaria")).toBeTruthy();
  });

  it("línea de producción: cada proyecto en su etapa; las vacías explican la etapa", async () => {
    renderHome();
    const medios = await screen.findByTestId("stage-medios");
    expect(await within(medios).findByText("Caso Priscila")).toBeTruthy();
    expect(within(screen.getByTestId("stage-publicacion")).getByText("D. B. Cooper")).toBeTruthy();
    expect(within(screen.getByTestId("stage-guion")).getByText(/Claude redacta el guion/)).toBeTruthy();
    expect(screen.queryByText("Publicado", { selector: "span" })).toBeNull(); // los publicados no están en curso
    fireEvent.click(within(medios).getByText("Caso Priscila"));
    expect(navigate).toHaveBeenCalledWith("/proyectos/2");
  });

  it("«Continuar» con el más urgente y su siguiente paso", async () => {
    renderHome();
    const next = await screen.findByTestId("next-up");
    expect(await within(next).findByText("D. B. Cooper")).toBeTruthy();
    expect(within(next).getByText(/Programa la fecha y sube el video/)).toBeTruthy();
    fireEvent.click(within(next).getByText(/Seguir con publicación/));
    expect(navigate).toHaveBeenCalledWith("/proyectos/1");
  });

  it("cifras reales y conexiones", async () => {
    renderHome();
    expect(await screen.findByText(/KB ahorrados al reutilizar/)).toBeTruthy();
    const estudio = screen.getByText("Tu estudio").closest("div")!;
    expect(within(estudio).getByText("Renderizados").nextElementSibling!.textContent).toBe("2"); // el publicado también se renderizó
    expect(within(estudio).getByText("Ideas en el banco").nextElementSibling!.textContent).toBe("2");
    const conexiones = screen.getByText("Conexiones").closest("div")!.parentElement!;
    expect(await within(conexiones).findByText("Claude por MCP")).toBeTruthy();
    expect(within(conexiones).getByText("ElevenLabs")).toBeTruthy();
  });
});
