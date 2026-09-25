import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { libraryQuery } from "@/hooks/useLibrary";
import type { LibraryItem, LibraryPage, SceneMedia } from "@/lib/api";
import { MediaPage } from "@/pages/Media";
import { LibraryPickerDialog } from "./LibraryPickerDialog";
import { usageLabel } from "./libraryMeta";

vi.mock("@/components/layout/PageLayout", () => ({
  PageLayout: ({ children, bottomBar }: { children: React.ReactNode; bottomBar?: React.ReactNode }) => (
    <div>
      {children}
      {bottomBar}
    </div>
  ),
}));
vi.mock("@/components/layout/ChannelSelector", () => ({ ChannelSelector: () => null }));

const item = (id: number, over: Partial<LibraryItem> = {}): LibraryItem => ({
  asset: {
    id,
    kind: "image",
    file_name: `00${id}_pexels_${id}.jpg`,
    file_url: `/api/assets/${id}/file`,
    thumb_url: `/api/assets/${id}/thumb`,
    provider: "pexels",
    provider_id: String(id),
    source_page_url: `https://www.pexels.com/photo/${id}/`,
    author: "Autora",
    license: "Pexels License",
    width: 1080,
    height: 1920,
    duration_s: null,
    orientation: "portrait",
    size_bytes: 2 * 1024 * 1024,
    low_res: false,
  },
  project_id: 1,
  project_title: "El secuestro",
  project_format: "reel",
  channel_id: 1,
  channel_name: "Casos Reales",
  used_in: [],
  duplicates: 0,
  reused_from_id: null,
  created_at: "2026-09-25T10:00:00",
  ...over,
});

const pageOf = (items: LibraryItem[]): LibraryPage => ({
  items,
  total: items.length,
  total_bytes: items.length * 2 * 1024 * 1024,
  page: 1,
  page_size: 60,
  kinds: [
    { value: "image", count: items.filter((i) => i.asset.kind === "image").length },
    { value: "video", count: items.filter((i) => i.asset.kind === "video").length },
  ],
  providers: [{ value: "pexels", count: items.length }],
  orientations: [],
});

describe("utilidades de la biblioteca", () => {
  it("uso del medio", () => {
    expect(usageLabel(item(1))).toBe("Sin usar");
    expect(usageLabel(item(1, { used_in: [{ scene_id: 3, position: 2, role: "main" }] }))).toBe("Escena 2");
    expect(usageLabel(item(1, { used_in: [{ scene_id: 3, position: 2, role: "alt" }] }))).toBe("Escena 2 (alterno)");
    expect(
      usageLabel(
        item(1, {
          used_in: [
            { scene_id: 3, position: 2, role: "main" },
            { scene_id: 4, position: 5, role: "main" },
            { scene_id: 5, position: 7, role: "alt" },
          ],
        }),
      ),
    ).toBe("Escenas 2, 5 y 7");
  });

  it("arma la consulta sin filtros vacíos", () => {
    expect(libraryQuery({})).toBe("/api/library");
    expect(libraryQuery({ kind: "video", q: " faro ", duplicates: false, project: null, page: 2 })).toBe(
      "/api/library?kind=video&q=faro&page=2",
    );
  });
});

describe("pantallas de la biblioteca", () => {
  let requests: { method: string; url: URL; body: unknown }[];
  let items: LibraryItem[];

  beforeEach(() => {
    requests = [];
    items = [
      item(1, { used_in: [{ scene_id: 9, position: 1, role: "main" }] }),
      item(2, { duplicates: 1 }),
      item(3, { asset: { ...item(3).asset, kind: "video", duration_s: 12.4, file_name: "003_clip.mp4" } }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const ok = (data: unknown) => new Response(JSON.stringify(data));
        if (url.pathname === "/api/library/stats")
          return ok({ assets: 3, bytes: 6e6, unique_bytes: 4e6, saved_bytes: 2 * 1024 * 1024, duplicate_groups: 1 });
        if (url.pathname === "/api/library") {
          const kind = url.searchParams.get("kind");
          return ok(pageOf(kind ? items.filter((i) => i.asset.kind === kind) : items));
        }
        if (url.pathname.endsWith(":reuse")) return ok({ scene_id: 44, candidates: [], approved: [] });
        if (url.pathname === "/api/projects")
          return ok([{ id: 5, title: "Otro caso", channel_name: "Casos Reales", status: "MEDIOS_EN_REVISION" }]);
        if (url.pathname === "/api/projects/5/scenes")
          return ok({ scenes: [{ id: 44, position: 2, media_kind: "image", visual_description: "Calle", narration: null }] });
        return ok([]);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function wrap(node: React.ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("tabla, filtros por tipo, detalle y estadísticas", async () => {
    wrap(<MediaPage />);
    expect(await screen.findByText("001_pexels_1.jpg")).toBeTruthy();
    expect(screen.getByText("×2")).toBeTruthy(); // duplicado
    expect(screen.getByText("Escena 1")).toBeTruthy();
    expect(screen.getAllByText("2.0 MB")).toHaveLength(4); // 3 filas + ahorrado por duplicados

    fireEvent.click(screen.getByText("Videos"));
    await waitFor(() => expect(requests.some((r) => r.url.searchParams.get("kind") === "video")).toBe(true));
    expect(await screen.findByText("003_clip.mp4")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("001_pexels_1.jpg")).toBeNull());

    fireEvent.click(screen.getByText("003_clip.mp4"));
    const detail = screen.getByLabelText("Detalle del medio");
    expect(within(detail).getByText("Pexels License")).toBeTruthy();
    expect(within(detail).getByText("0:12")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Vista de cuadrícula"));
    expect(screen.getByTestId("library-grid")).toBeTruthy();
  });

  it("reutilizar en otro proyecto", async () => {
    wrap(<MediaPage />);
    fireEvent.click(await screen.findByText("002_pexels_2.jpg"));
    fireEvent.click(within(screen.getByLabelText("Detalle del medio")).getByText("Reutilizar en…"));
    expect(await screen.findByText("Reutilizar en otro proyecto")).toBeTruthy();
    // Radix Select no se abre en jsdom: se elige con el teclado.
    const dialog = screen.getByRole("dialog");
    const project = within(dialog).getByLabelText("Proyecto");
    fireEvent.keyDown(project, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Otro caso/ }));
    const scene = within(dialog).getByLabelText("Escena");
    await waitFor(() => expect((scene as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(scene, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /2 · Imagen · Calle/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reutilizar" }));
    await waitFor(() => expect(requests.some((r) => r.url.pathname === "/api/library/2:reuse")).toBe(true));
    expect(requests.find((r) => r.url.pathname === "/api/library/2:reuse")!.body).toEqual({ scene_id: 44 });
  });

  it("el selector de la escena filtra por tipo y orientación y reutiliza", async () => {
    const scene = { scene_id: 44, media_kind: "image", candidates: [] } as unknown as SceneMedia;
    wrap(<LibraryPickerDialog scene={scene} orientation="portrait" open onClose={() => undefined} />);
    const grid = await screen.findByTestId("picker-grid");
    await waitFor(() => expect(within(grid).getAllByText("Usar en esta escena").length).toBeGreaterThan(0));
    const query = requests.find((r) => r.url.pathname === "/api/library")!.url.searchParams;
    expect([query.get("kind"), query.get("orientation")]).toEqual(["image", "portrait"]);
    fireEvent.click(within(grid).getAllByText("Usar en esta escena")[0]);
    await waitFor(() => expect(requests.some((r) => r.url.pathname === "/api/library/1:reuse")).toBe(true));
  });
});
