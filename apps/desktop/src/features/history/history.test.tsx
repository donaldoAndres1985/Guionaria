import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RightsPanel } from "@/features/rights/RightsPanel";
import type { HistoryItem, RightsReport, TrashItem } from "@/lib/api";
import { HistoryPage } from "@/pages/History";
import { dayLabel, groupByDay, timeLabel } from "./historyMeta";

vi.mock("@/components/layout/PageLayout", () => ({
  PageLayout: ({ children, bottomBar }: { children: React.ReactNode; bottomBar?: React.ReactNode }) => (
    <div>
      {children}
      {bottomBar}
    </div>
  ),
}));

const NOW = new Date(2026, 8, 26, 12, 0);
const at = (d: number, h: number) => new Date(2026, 8, d, h, 5).toISOString();
const op = (id: number, over: Partial<HistoryItem> = {}): HistoryItem => ({
  id,
  at: at(26, 10),
  actor: "ui",
  action: "approve",
  entity: "script",
  text: "Guion aprobado (versión 2)",
  project_id: 1,
  project_title: "El secuestro",
  can_restore: false,
  ...over,
});

describe("utilidades del historial", () => {
  it("días y horas", () => {
    expect(dayLabel(at(26, 9), NOW)).toBe("Hoy");
    expect(dayLabel(at(25, 23), NOW)).toBe("Ayer");
    expect(dayLabel(at(20, 9), NOW)).toMatch(/20 de septiembre/);
    expect(timeLabel(new Date(2026, 8, 26, 7, 3).toISOString())).toBe("07:03");
  });

  it("agrupa por día sin cambiar el orden", () => {
    const groups = groupByDay([op(3), op(2, { at: at(25, 9) }), op(1, { at: at(25, 8) })], NOW);
    expect(groups.map((g) => [g.day, g.items.map((i) => i.id)])).toEqual([
      ["Hoy", [3]],
      ["Ayer", [2, 1]],
    ]);
  });
});

describe("historial y papelera", () => {
  let requests: { method: string; url: URL }[];
  let trash: TrashItem[];

  beforeEach(() => {
    requests = [];
    trash = [
      { project_id: 7, title: "Borrado", channel_name: "Casos Reales", format: "reel", status: "GUION_APROBADO", deleted_at: "2026-09-25T10:00:00+00:00", days_left: 2, bytes: 5 * 1024 * 1024 },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        requests.push({ method, url });
        const ok = (data: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status });
        if (url.pathname === "/api/trash") return ok(trash);
        if (url.pathname.endsWith(":restore")) {
          trash = [];
          return ok({ id: 7 });
        }
        if (url.pathname === "/api/trash/7" && method === "DELETE") return ok(null, 204);
        if (url.pathname === "/api/history") {
          const before = url.searchParams.get("before");
          if (before) return ok({ items: [op(1, { text: "Proyecto creado (reel 9:16)" })], next_before: null });
          return ok({
            items: [
              op(3, { actor: "mcp", entity: "idea", text: "Idea guardada: «Desde Claude»", project_id: null, project_title: null }),
              op(2, { action: "delete", entity: "project", text: "Proyecto enviado a la papelera", project_id: 7, project_title: "Borrado", can_restore: true }),
            ],
            next_before: 2,
          });
        }
        return ok({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HistoryPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("lista, filtros, restaurar y cargar anteriores", async () => {
    renderPage();
    expect(await screen.findByText("Idea guardada: «Desde Claude»")).toBeTruthy();
    expect(screen.getAllByText("Claude (MCP)").length).toBe(2); // filtro + fila
    fireEvent.click(screen.getByText("Restaurar"));
    await waitFor(() => expect(requests.some((r) => r.url.pathname === "/api/trash/7:restore")).toBe(true));

    fireEvent.click(screen.getByText("Cargar anteriores"));
    expect(await screen.findByText("Proyecto creado (reel 9:16)")).toBeTruthy();
    expect(requests.some((r) => r.url.searchParams.get("before") === "2")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Claude (MCP)" }));
    await waitFor(() => expect(requests.some((r) => r.url.searchParams.get("actor") === "mcp")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Medios" }));
    await waitFor(() => expect(requests.some((r) => r.url.searchParams.get("group") === "media")).toBe(true));
  });

  it("papelera: días restantes, borrar con confirmación y vaciar", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Papelera (1)"));
    expect(screen.getByText("Se borra en 2 días")).toBeTruthy();
    expect(screen.getByText(/eliminado el .* · 5.00 MB/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Borrar$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Borrar definitivamente"));
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE" && r.url.pathname === "/api/trash/7")).toBe(true));
  });
});

describe("registro de derechos", () => {
  const report: RightsReport = {
    project_id: 1,
    review_count: 1,
    credits: "Créditos — El secuestro\n",
    rows: [
      { scene_position: 2, scene_start: "0:02", role: "principal", file_name: "002.jpg", provider: "pexels", origin: "Pexels", author: "Ana", license: "Pexels License", source_url: "https://pexels.com/1", needs_review: false },
      { scene_position: 3, scene_start: "0:04", role: "principal", file_name: "003.jpg", provider: "searxng", origin: "Tercero", author: null, license: null, source_url: "https://noticias.example/1", needs_review: true },
    ],
  };
  let posts: string[];

  beforeEach(() => {
    posts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (init?.method === "POST") {
          posts.push(path);
          return new Response(JSON.stringify({ path: "C:\\x\\derechos.csv" }));
        }
        return new Response(JSON.stringify(report));
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("tabla con avisos, copiar créditos y exportar", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RightsPanel projectId={1} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("1 por revisar")).toBeTruthy();
    expect(screen.getByText("Derechos: revisar")).toBeTruthy();
    expect(screen.getByText("Tercero · Web (SearXNG)")).toBeTruthy();
    fireEvent.click(screen.getByText("Copiar créditos"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Créditos — El secuestro\n"));
    fireEvent.click(screen.getByText("Exportar CSV"));
    await waitFor(() => expect(posts).toEqual(["/api/projects/1/rights:export"]));
  });
});
