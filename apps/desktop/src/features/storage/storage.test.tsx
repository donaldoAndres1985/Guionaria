import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CleanupPreview, StorageNode, StorageUsage } from "@/lib/api";
import { StoragePage } from "@/pages/Storage";
import { formatSize, pathTo, percent, squarify } from "./treemap";

vi.mock("@/components/layout/PageLayout", () => ({
  PageLayout: ({ children, bottomBar, actions }: { children: React.ReactNode; bottomBar?: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {actions}
      {children}
      {bottomBar}
    </div>
  ),
}));

const node = (id: string, name: string, bytes: number, children: StorageNode[] = [], kind: StorageNode["kind"] = "part"): StorageNode => ({
  id,
  name,
  kind,
  bytes,
  files: children.length ? children.reduce((n, c) => n + c.files, 0) : 3,
  project_id: kind === "project" ? 1 : null,
  channel_id: null,
  children,
});

const MB = 1024 * 1024;
const TREE = node(
  "root",
  "Guionaria",
  700 * MB,
  [
    node(
      "c1",
      "Casos Reales",
      600 * MB,
      [node("p1", "El secuestro", 600 * MB, [node("p1:candidates", "Candidatos", 450 * MB), node("p1:approved", "Aprobados", 150 * MB)], "project")],
      "channel",
    ),
    node("models", "Modelos de voz y Whisper", 100 * MB, [], "area"),
  ],
  "root",
);

describe("treemap", () => {
  it("ocupa todo el rectángulo en proporción a los valores", () => {
    const tiles = squarify([6, 6, 4, 3, 2, 2, 1], (v) => v, { x: 0, y: 0, w: 600, h: 400 });
    expect(tiles).toHaveLength(7);
    const area = tiles.reduce((s, t) => s + t.w * t.h, 0);
    expect(area).toBeCloseTo(600 * 400, 3);
    // Cada rectángulo tiene el área que le toca (24 = suma de los valores).
    for (const t of tiles) expect((t.w * t.h) / (600 * 400)).toBeCloseTo(t.item / 24, 5);
    // Todos dentro del rectángulo.
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-9);
      expect(t.y).toBeGreaterThanOrEqual(-1e-9);
      expect(t.x + t.w).toBeLessThanOrEqual(600 + 1e-6);
      expect(t.y + t.h).toBeLessThanOrEqual(400 + 1e-6);
    }
    // El más grande va primero.
    expect(tiles[0].item).toBe(6);
  });

  it("ignora vacíos y rectángulos sin tamaño", () => {
    expect(squarify([0, 0], (v) => v, { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    expect(squarify([1], (v) => v, { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
    expect(squarify([5], (v) => v, { x: 0, y: 0, w: 10, h: 20 })).toEqual([{ x: 0, y: 0, w: 10, h: 20, item: 5 }]);
  });

  it("tamaños, porcentajes y migas", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1.50 KB");
    expect(formatSize(12.34 * MB)).toBe("12.3 MB");
    expect(formatSize(250 * 1024 * MB)).toBe("250 GB");
    expect(percent(1, 3)).toBe(33);
    expect(percent(1, 0)).toBe(0);
    expect(pathTo(TREE, "p1:approved").map((n) => n.name)).toEqual(["Guionaria", "Casos Reales", "El secuestro", "Aprobados"]);
    expect(pathTo(TREE, "nada")).toEqual([]);
  });
});

describe("pantalla de almacenamiento", () => {
  let posts: unknown[];
  const usage: StorageUsage = { home: "C:\\Guionaria", tree: TREE, shared_bytes: 150 * MB, disk_total: 500 * 1024 * MB, disk_free: 120 * 1024 * MB };
  const preview: CleanupPreview = {
    projects: [
      { project_id: 1, title: "El secuestro", channel_name: "Casos Reales", status: "VOZ_LISTA", media_approved: true, count: 12, bytes: 300 * MB },
      { project_id: 2, title: "En revisión", channel_name: "Casos Reales", status: "MEDIOS_EN_REVISION", media_approved: false, count: 4, bytes: 50 * MB },
    ],
    total_count: 16,
    total_bytes: 350 * MB,
  };

  beforeEach(() => {
    posts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ deleted: 12, freed_bytes: 300 * MB }));
        }
        return new Response(JSON.stringify(path.endsWith("/usage") ? usage : preview));
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
        <StoragePage />
      </QueryClientProvider>,
    );
  }

  it("lista con porcentajes, treemap y navegación por niveles", async () => {
    renderPage();
    expect(await screen.findByText("700 MB")).toBeTruthy(); // Guionaria ocupa
    expect(screen.getByText("120 GB")).toBeTruthy(); // libre
    expect(screen.getAllByText("86%").length).toBeGreaterThan(0); // Casos Reales 600/700
    const treemap = screen.getByTestId("treemap");
    expect(treemap.children).toHaveLength(2);

    fireEvent.click(screen.getAllByText("Casos Reales")[0]);
    fireEvent.click((await screen.findAllByText("El secuestro"))[0]);
    expect(screen.getAllByText("Candidatos").length).toBeGreaterThan(0);
    expect(screen.getAllByText("75%").length).toBeGreaterThan(0);
    // Migas: volver al canal.
    fireEvent.click(screen.getByRole("button", { name: "Casos Reales" }));
    expect(screen.getAllByText("El secuestro").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Lista"));
    expect(screen.queryByTestId("treemap")).toBeNull();
  });

  it("limpieza: por defecto solo los proyectos con medios aprobados", async () => {
    renderPage();
    fireEvent.click(await screen.findByText(/Liberar 350 MB de candidatos sin usar/));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("El secuestro") as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText("En revisión") as HTMLInputElement).checked).toBe(false);
    expect(within(dialog).getByText(/medios todavía en revisión/)).toBeTruthy();
    fireEvent.click(within(dialog).getByText("Borrar 12 archivos · 300 MB"));
    await waitFor(() => expect(posts).toEqual([{ project_ids: [1] }]));
  });
});
