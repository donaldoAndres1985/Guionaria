import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, Candidate, MediaOverview, Project, SceneMedia } from "@/lib/api";
import { CandidateCard } from "./CandidateCard";
import { canSelect, formatBytes, formatClip, formatResolution, orientationMismatch } from "./mediaMeta";
import { useMediaController } from "./useMediaController";

const asset = (id: number, over: Partial<Asset> = {}): Asset => ({
  id,
  kind: "image",
  file_name: `00${id}.jpg`,
  file_url: `/api/assets/${id}/file`,
  thumb_url: `/api/assets/${id}/thumb`,
  provider: "pexels",
  provider_id: String(id),
  source_page_url: null,
  author: "Autor",
  license: "Pexels License",
  width: 1080,
  height: 1920,
  duration_s: null,
  orientation: "portrait",
  size_bytes: 2048,
  low_res: false,
  ...over,
});

const candidate = (id: number, over: Partial<Candidate> = {}): Candidate => ({
  id,
  scene_id: 1,
  provider: "pexels",
  provider_id: String(id),
  kind: "image",
  preview_url: `https://img/${id}.jpg`,
  video_preview_url: null,
  full_url: `https://img/${id}-full.jpg`,
  page_url: `https://pexels.com/${id}`,
  width: 1080,
  height: 1920,
  duration_s: null,
  author: `Autor ${id}`,
  license: "Pexels License",
  query: "street night",
  selected: false,
  download_status: "none",
  error: null,
  asset: null,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("utilidades de medios", () => {
  it("formatea resolución, tamaño y duración", () => {
    expect(formatResolution(1080, 1920)).toBe("1080×1920");
    expect(formatResolution(null, 10)).toBeNull();
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatClip(72.4)).toBe("1:12");
  });

  it("detecta orientación distinta a la del proyecto", () => {
    expect(orientationMismatch(candidate(1, { width: 1920, height: 1080 }), "portrait")).toBe(true);
    expect(orientationMismatch(candidate(1), "portrait")).toBe(false);
    expect(orientationMismatch(candidate(1), "landscape")).toBe(true);
  });

  it("solo se eligen candidatos no descargados o fallidos", () => {
    expect(canSelect(candidate(1))).toBe(true);
    expect(canSelect(candidate(1, { download_status: "failed" }))).toBe(true);
    expect(canSelect(candidate(1, { download_status: "done" }))).toBe(false);
    expect(canSelect(candidate(1, { download_status: "downloading" }))).toBe(false);
  });
});

describe("tarjeta de candidato", () => {
  const base = {
    index: 0,
    orientation: "portrait" as const,
    selected: false,
    approvedRole: null,
    editable: true,
    onToggle: vi.fn(),
    onApprove: vi.fn(),
    onRetry: vi.fn(),
    onOpen: vi.fn(),
    onHover: vi.fn(),
  };

  it("clic elige el candidato y muestra su número de atajo", () => {
    const onToggle = vi.fn();
    render(<CandidateCard {...base} candidate={candidate(1)} onToggle={onToggle} />);
    expect(screen.getByText("1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Elegir candidato 1" }));
    expect(onToggle).toHaveBeenCalled();
    expect(screen.getByText("1080×1920")).toBeTruthy();
  });

  it("descargado: botones Aprobar y Alterno", () => {
    const onApprove = vi.fn();
    render(
      <CandidateCard {...base} candidate={candidate(1, { download_status: "done", asset: asset(9) })} onApprove={onApprove} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));
    fireEvent.click(screen.getByRole("button", { name: "Alterno" }));
    expect(onApprove.mock.calls).toEqual([["main"], ["alt"]]);
    expect(screen.getByRole("button", { name: "Elegir candidato 1" }).hasAttribute("disabled")).toBe(true);
  });

  it("fallido: muestra el error y permite reintentar", () => {
    const onRetry = vi.fn();
    render(
      <CandidateCard
        {...base}
        candidate={candidate(1, { download_status: "failed", error: "HTTP 403. Ábrelo en el navegador" })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/HTTP 403/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("descargando: muestra el progreso; aprobado: etiqueta Principal y sin botones", () => {
    const { rerender } = render(
      <CandidateCard {...base} candidate={candidate(1, { download_status: "downloading" })} />,
    );
    expect(screen.getByText("Descargando…")).toBeTruthy();
    rerender(
      <CandidateCard
        {...base}
        approvedRole="main"
        candidate={candidate(1, { download_status: "done", asset: asset(9, { low_res: true }) })}
      />,
    );
    expect(screen.getByText("Principal")).toBeTruthy();
    expect(screen.getByText("baja res.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aprobar" })).toBeNull();
  });
});

describe("controlador de medios", () => {
  const project: Project = {
    id: 1, channel_id: 1, channel_name: "C", channel_slug: "c", title: "P", slug: "p",
    format: "reel", status: "MEDIOS_EN_REVISION", topic: null, research_notes: null,
    target_duration_s: 60, target_publish_at: null, priority: 2, tags: [], folder_path: "",
    parent_project_id: null, created_at: "", updated_at: "",
  };

  let requests: { method: string; path: string; body: unknown }[];
  let scenes: Record<number, SceneMedia>;
  let overview: MediaOverview;

  const sceneMedia = (id: number, over: Partial<SceneMedia> = {}): SceneMedia => ({
    scene_id: id, position: id, seg_key: `seg_00${id}`, media_kind: "image", narration: "N",
    visual_description: "Calle", query_en: "street night", query_alt: null, query_real: null,
    start_s: 0, end_s: 2, status: "pending", needs_media: true, default_query: "street night",
    search_kind: "image", available_providers: ["pexels"], default_providers: ["pexels"],
    approved: [], candidates: [], ...over,
  });

  beforeEach(() => {
    requests = [];
    scenes = { 1: sceneMedia(1), 2: sceneMedia(2), 3: sceneMedia(3, { media_kind: "text", needs_media: false }) };
    overview = {
      project_id: 1, orientation: "portrait", editable: true, approved: false,
      configured_providers: ["pexels"],
      scenes: Object.values(scenes).map((s) => ({
        scene_id: s.scene_id, position: s.position, media_kind: s.media_kind,
        visual_description: s.visual_description, status: s.status, needs_media: s.needs_media,
        candidate_count: 0, downloaded_count: 0, approved_thumb_url: null,
      })),
      needing_media: 2, with_media: 0,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ method, path, body });
        const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
        if (path === "/api/projects/1/media") return ok(overview);
        const sceneId = Number(path.split("/")[3]);
        if (path.endsWith("/media")) return ok(scenes[sceneId]);
        if (path.endsWith("/search")) {
          scenes[sceneId] = { ...scenes[sceneId], status: "candidates", candidates: [candidate(10), candidate(11)] };
          return ok({ scene: scenes[sceneId], warnings: ["Pixabay: falta la clave"], page: body.page, has_more: true });
        }
        if (path.endsWith("candidates:download")) {
          return ok({ id: 5, type: "download_media", project_id: 1, status: "queued", progress: 0,
            message: null, result: null, error: null, created_at: "", finished_at: null });
        }
        if (path.includes(":approve")) {
          scenes[sceneId] = { ...scenes[sceneId], status: "approved" };
          overview = {
            ...overview, with_media: 1,
            scenes: overview.scenes.map((s) => (s.scene_id === sceneId ? { ...s, status: "approved" } : s)),
          };
          return ok(scenes[sceneId]);
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });

  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(() => useMediaController(project), { wrapper });
  }

  it("abre la primera escena sin medio y busca sola con su búsqueda y la orientación", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.scene?.candidates).toHaveLength(2));
    expect(result.current.sceneId).toBe(1);
    const search = requests.find((r) => r.path.endsWith("/search"))!;
    expect(search.path).toBe("/api/scenes/1/search");
    // Solo el proveedor configurado.
    expect(search.body).toEqual({ query: "street night", providers: ["pexels"], page: 1, any_orientation: false });
    expect(result.current.warnings).toEqual(["Pixabay: falta la clave"]);
    expect(result.current.hasMore).toBe(true);
  });

  it("elegir, descargar (manda los ids y vacía la selección) y mostrar más", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.scene?.candidates).toHaveLength(2));
    act(() => result.current.toggle(10));
    act(() => result.current.toggle(11));
    act(() => result.current.toggle(11));
    expect(result.current.selected).toEqual([10]);

    await act(() => result.current.download());
    expect(requests.find((r) => r.path.endsWith("candidates:download"))!.body).toEqual({ candidate_ids: [10] });
    expect(result.current.selected).toEqual([]);

    await act(() => result.current.loadMore());
    expect(requests.filter((r) => r.path.endsWith("/search")).at(-1)!.body).toMatchObject({ page: 2 });
  });

  it("aprobar el principal pasa a la siguiente escena sin medio", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.scene).toBeTruthy());
    act(() => result.current.approve(9, "main"));
    await waitFor(() => expect(result.current.sceneId).toBe(2));
    expect(requests.find((r) => r.path.includes(":approve"))).toMatchObject({
      path: "/api/scenes/1/assets/9:approve",
      body: { role: "main" },
    });
  });

  it("anterior/siguiente recorre solo las escenas que necesitan medio", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.sceneId).toBe(1));
    act(() => result.current.next());
    expect(result.current.sceneId).toBe(2);
    act(() => result.current.next());
    expect(result.current.sceneId).toBe(1); // la 3 (texto) se salta y vuelve al inicio
    act(() => result.current.prev());
    expect(result.current.sceneId).toBe(2);
  });

  it("búsqueda con una sugerencia o consulta propia", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.scene).toBeTruthy());
    await act(() => result.current.search({ query: "rainy alley" }));
    expect(requests.filter((r) => r.path.endsWith("/search")).at(-1)!.body).toMatchObject({ query: "rainy alley", page: 1 });
    expect(result.current.query).toBe("rainy alley");
  });
});
