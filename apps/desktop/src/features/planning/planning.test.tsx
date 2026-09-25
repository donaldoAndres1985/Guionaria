import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Idea, Project } from "@/lib/api";
import { CalendarPage } from "@/pages/Calendar";
import { IdeasPage } from "@/pages/Ideas";
import {
  byDate,
  COLUMNS,
  canMove,
  dropAction,
  dueSoon,
  isoDate,
  monthGrid,
  weekDays,
} from "./calendarMeta";
import { reminderText, takeUnnotified } from "./useReminders";

vi.mock("@/components/layout/PageLayout", () => ({
  PageLayout: ({ children, bottomBar, actions }: { children: React.ReactNode; bottomBar?: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {actions}
      {children}
      {bottomBar}
    </div>
  ),
}));

const project = (id: number, over: Partial<Project> = {}): Project =>
  ({
    id,
    channel_id: 1,
    channel_name: "Casos Reales",
    channel_slug: "casos-reales",
    title: `Proyecto ${id}`,
    slug: `p${id}`,
    format: "reel",
    status: "GUION_BORRADOR",
    topic: null,
    research_notes: null,
    target_duration_s: 60,
    target_publish_at: null,
    priority: 2,
    tags: [],
    folder_path: "x",
    parent_project_id: null,
    created_at: "2026-09-01T00:00:00",
    updated_at: "2026-09-01T00:00:00",
    ...over,
  }) as Project;

describe("utilidades del calendario", () => {
  it("la cuadrícula del mes empieza en lunes y cubre 6 semanas", () => {
    const grid = monthGrid(2026, 8); // septiembre 2026: el 1 es martes
    expect(grid).toHaveLength(42);
    expect(isoDate(grid[0])).toBe("2026-08-31");
    expect(grid[0].getDay()).toBe(1);
    expect(isoDate(grid[1])).toBe("2026-09-01");
  });

  it("semana de lunes a domingo", () => {
    const days = weekDays(new Date(2026, 8, 27)); // domingo
    expect(isoDate(days[0])).toBe("2026-09-21");
    expect(isoDate(days[6])).toBe("2026-09-27");
  });

  it("agrupa por fecha", () => {
    const g = byDate([project(1, { target_publish_at: "2026-09-30" }), project(2), project(3, { target_publish_at: "2026-09-30" })]);
    expect(g.get("2026-09-30")?.map((p) => p.id)).toEqual([1, 3]);
    expect(g.size).toBe(1);
  });

  it("solo las etapas finales se mueven a mano", () => {
    const col = (id: string) => COLUMNS.find((c) => c.id === id)!;
    expect(canMove("TIMELINE_LISTO", col("PUBLICADO"))).toBe(true);
    expect(canMove("PUBLICADO", col("RENDERIZADO"))).toBe(true);
    expect(canMove("GUION_BORRADOR", col("PUBLICADO"))).toBe(false);
    expect(canMove("TIMELINE_LISTO", col("voz"))).toBe(false);
  });

  it("acción al soltar", () => {
    const p = project(1, { target_publish_at: "2026-09-30", status: "TIMELINE_LISTO" });
    expect(dropAction(p, "date-2026-10-02")).toEqual({ kind: "reschedule", date: "2026-10-02" });
    expect(dropAction(p, "date-2026-09-30")).toBeNull(); // mismo día
    expect(dropAction(p, "undated")).toEqual({ kind: "reschedule", date: null });
    expect(dropAction(p, "col-PROGRAMADO")).toEqual({ kind: "status", status: "PROGRAMADO" });
    expect(dropAction(p, "col-TIMELINE_LISTO")).toBeNull();
    expect(dropAction(project(2), "col-PUBLICADO")).toEqual({ kind: "blocked" });
  });

  it("recordatorios: hoy y mañana, sin publicados, una vez al día", () => {
    localStorage.clear();
    const today = new Date(2026, 8, 25);
    const list = [
      project(1, { target_publish_at: "2026-09-25" }),
      project(2, { target_publish_at: "2026-09-26" }),
      project(3, { target_publish_at: "2026-09-27" }),
      project(4, { target_publish_at: "2026-09-25", status: "PUBLICADO" }),
      project(5, { target_publish_at: "2026-09-24" }),
    ];
    const due = dueSoon(list, today);
    expect(due.map((p) => p.id)).toEqual([1, 2]);
    expect(reminderText(due[0], "2026-09-25")).toBe("«Proyecto 1» se publica hoy (Casos Reales).");
    expect(reminderText(due[1], "2026-09-25")).toBe("«Proyecto 2» se publica mañana (Casos Reales).");
    expect(takeUnnotified(due, "2026-09-25").map((p) => p.id)).toEqual([1, 2]);
    expect(takeUnnotified(due, "2026-09-25")).toEqual([]); // ya avisados hoy
    expect(takeUnnotified(due, "2026-09-26")).toHaveLength(2); // otro día
  });
});

describe("páginas de planificación", () => {
  let ideas: Idea[];
  let projects: Project[];
  let requests: { method: string; path: string; body: unknown }[];

  beforeEach(() => {
    requests = [];
    ideas = [];
    projects = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ method, path: url.pathname, body });
        const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
        if (url.pathname === "/api/channels") return ok([{ id: 1, name: "Casos Reales", slug: "casos-reales" }]);
        if (url.pathname === "/api/ideas" && method === "POST") {
          const idea = { id: 10, channel_id: 1, channel_name: "Casos Reales", notes: null, priority: 2, status: "open", project_id: null, created_at: "", updated_at: "", ...body };
          ideas = [idea, ...ideas];
          return ok(idea, 201);
        }
        if (url.pathname === "/api/ideas") return ok(ideas);
        if (url.pathname.endsWith(":convert")) return ok(project(77), 201);
        if (url.pathname.startsWith("/api/ideas/") && method === "PATCH") {
          ideas = ideas.map((i) => (i.id === 10 ? { ...i, ...body } : i));
          return ok(ideas[0]);
        }
        if (url.pathname === "/api/projects") return ok(projects);
        return ok({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderPage(page: React.ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>{page}</MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("agrega una idea, la descarta y la convierte", async () => {
    renderPage(<IdeasPage />);
    const input = await screen.findByPlaceholderText("Nueva idea para Casos Reales…");
    fireEvent.change(input, { target: { value: "El faro de Alejandría" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.path === "/api/ideas")).toBe(true));
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({ channel_id: 1, title: "El faro de Alejandría" });

    expect(await screen.findByDisplayValue("El faro de Alejandría")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Notas"), { target: { value: "Fuente: archivo" } });
    fireEvent.blur(screen.getByLabelText("Notas"));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH" && (r.body as { notes?: string }).notes === "Fuente: archivo")).toBe(true));

    fireEvent.click(screen.getAllByText("Convertir en proyecto")[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Video/ }));
    expect((screen.getByLabelText("Duración") as HTMLInputElement).value).toBe("10");
    fireEvent.change(screen.getByLabelText("Publicación objetivo"), { target: { value: "2026-10-03" } });
    fireEvent.click(screen.getByText("Crear proyecto"));
    await waitFor(() => expect(requests.some((r) => r.path === "/api/ideas/10:convert")).toBe(true));
    expect(requests.find((r) => r.path === "/api/ideas/10:convert")!.body).toEqual({
      format: "video",
      target_duration_s: 600,
      target_publish_at: "2026-10-03",
    });
  });

  it("el calendario muestra los proyectos por fecha y el tablero por etapa", async () => {
    const today = isoDate(new Date());
    projects = [
      project(1, { target_publish_at: today, title: "Hoy sale" }),
      project(2, { title: "Sin fecha" }),
      project(3, { status: "PROGRAMADO", title: "Ya programado" }),
    ];
    renderPage(<CalendarPage />);
    const cell = await waitFor(() => {
      const el = document.querySelector(`[data-date="${today}"]`) as HTMLElement;
      expect(within(el).getByText("Hoy sale")).toBeTruthy();
      return el;
    });
    expect(cell).toBeTruthy();
    expect(screen.getAllByText("Sin fecha").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Semana"));
    expect(screen.getByTestId("week-grid")).toBeTruthy();
    fireEvent.click(screen.getByText("Tablero"));
    expect(within(screen.getByTestId("col-guion")).getAllByText(/Proyecto|Hoy sale|Sin fecha/)).toHaveLength(2);
    expect(within(screen.getByTestId("col-PROGRAMADO")).getByText("Ya programado")).toBeTruthy();
  });
});
