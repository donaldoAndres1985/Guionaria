import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, Candidate, MediaOverview, Project, SceneMedia } from "@/lib/api";
import { useUiStore } from "@/stores/ui";
import { MediaBottomBar } from "./MediaBottomBar";
import { MediaStage } from "./MediaStage";
import { useMediaController } from "./useMediaController";

const project: Project = {
  id: 1, channel_id: 1, channel_name: "C", channel_slug: "c", title: "P", slug: "p",
  format: "reel", status: "MEDIOS_EN_REVISION", topic: null, research_notes: null,
  target_duration_s: 60, target_publish_at: null, priority: 2, tags: [], folder_path: "",
  parent_project_id: null, created_at: "", updated_at: "",
};

const summary = (id: number, over: Partial<MediaOverview["scenes"][number]> = {}) => ({
  scene_id: id, position: id, media_kind: "image" as const, visual_description: `Escena ${id}`,
  status: "candidates" as const, needs_media: true, candidate_count: 5, downloaded_count: 0,
  selected_count: 0, approved_thumb_url: null, ...over,
});

const sceneMedia = (id: number): SceneMedia => ({
  scene_id: id, position: id, seg_key: `seg_00${id}`, media_kind: "image", narration: "N",
  visual_description: `Escena ${id}`, query_en: "q", query_alt: null, query_real: null,
  start_s: 0, end_s: 2, status: "candidates", needs_media: true, default_query: "q",
  search_kind: "image", available_providers: ["pexels"], default_providers: ["pexels"],
  approved: [], candidates: [],
});

const videoAsset = (id: number, duration: number): Asset => ({
  id, kind: "video", file_name: `v${id}.mp4`, file_url: `/api/assets/${id}/file`, thumb_url: null,
  provider: "pexels", provider_id: String(id), source_page_url: null, author: null, license: null,
  width: 1080, height: 1920, duration_s: duration, orientation: "portrait", size_bytes: 1000, low_res: false,
});

const videoCandidate = (id: number, assetId: number, duration: number): Candidate => ({
  id, scene_id: 1, provider: "pexels", provider_id: String(assetId), kind: "video",
  preview_url: null, video_preview_url: null, full_url: null, page_url: null,
  width: 1080, height: 1920, duration_s: duration, author: null, license: null, query: null,
  selected: false, selection_order: null, download_status: "done", error: null,
  asset: videoAsset(assetId, duration),
});

function Harness() {
  const ctl = useMediaController(project);
  return (
    <>
      <MediaStage project={project} ctl={ctl} onGoToScenes={() => {}} />
      <MediaBottomBar project={project} ctl={ctl} />
    </>
  );
}

describe("flujo de medios en pantalla", () => {
  let overview: MediaOverview;
  let posts: string[];
  let scene1Candidates: Candidate[];
  let mergeBody: unknown;

  beforeEach(() => {
    posts = [];
    scene1Candidates = [];
    mergeBody = undefined;
    useUiStore.setState({ mediaHelpHidden: false });
    overview = {
      project_id: 1, orientation: "portrait", editable: true, approved: false, configured_providers: ["pexels"],
      scenes: [
        summary(1, { selected_count: 2 }),
        summary(2, { status: "approved" }),
        summary(3, { media_kind: "text", needs_media: false, candidate_count: 0 }),
        summary(4),
      ],
      needing_media: 3, with_media: 1, selected_pending: 2,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (init?.method === "POST") posts.push(path);
        const ok = (d: unknown) => new Response(JSON.stringify(d));
        if (path === "/api/projects/1/media") return ok(overview);
        if (path === "/api/projects/1/media:unlock") return ok({ ...overview, approved: false, editable: true });
        if (path === "/api/projects/1/scenes") return ok({ scenes: [], review_count: 0 });
        if (path.match(/\/api\/scenes\/\d+\/media$/)) {
          const id = Number(path.split("/")[3]);
          return ok(id === 1 ? { ...sceneMedia(1), candidates: scene1Candidates } : sceneMedia(id));
        }
        if (init?.method === "PUT" && path === "/api/scenes/1/media-kind") {
          const body = JSON.parse(String(init.body)) as { kind: "video" | "image" };
          return ok({ ...sceneMedia(1), media_kind: body.kind, search_kind: body.kind });
        }
        if (path === "/api/scenes/1/assets:merge") {
          mergeBody = JSON.parse(String(init?.body));
          return ok({ id: 7, type: "merge_media", project_id: 1, status: "running", progress: 0.1,
            message: null, result: null, error: null, created_at: "", finished_at: null });
        }
        if (path.startsWith("/api/jobs/7")) {
          return ok({ id: 7, type: "merge_media", project_id: 1, status: "running", progress: 0.1,
            message: null, result: null, error: null, created_at: "", finished_at: null });
        }
        if (path === "/api/projects/1/media:download-selected") {
          return ok({ id: 6, type: "download_selected", project_id: 1, status: "running", progress: 0.4,
            message: null, result: null, error: null, created_at: "", finished_at: null });
        }
        if (path.startsWith("/api/jobs/6")) {
          return ok({ id: 6, type: "download_selected", project_id: 1, status: "running", progress: 0.4,
            message: null, result: null, error: null, created_at: "", finished_at: null });
        }
        return ok([]);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderStage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("la lista marca en naranja lo elegido, en verde lo que tiene medio y «Render» en texto", async () => {
    renderStage();
    expect((await screen.findByTestId("scene-chosen-1")).textContent).toBe("2");
    expect(screen.getByLabelText("Con medio")).toBeTruthy();
    expect(screen.getByText("Render")).toBeTruthy();
    expect(screen.getByTitle("Se genera en el render (texto o negro): no necesita medio")).toBeTruthy();
  });

  it("explica los pasos y la guía se puede ocultar (se recuerda)", async () => {
    renderStage();
    const note = await screen.findByRole("note");
    expect(note.textContent).toContain("1. Elige");
    expect(note.textContent).toContain("«Descargar y aprobar»");
    fireEvent.click(screen.getByLabelText("Ocultar guía"));
    expect(screen.queryByRole("note")).toBeNull();
    expect(useUiStore.getState().mediaHelpHidden).toBe(true);
  });

  it("«Descargar y aprobar» baja lo elegido de todas las escenas y muestra el progreso", async () => {
    renderStage();
    const button = await screen.findByText("Descargar y aprobar (2)");
    expect(screen.getByText("Aprobar medios").closest("button")!.disabled).toBe(true);
    expect(screen.getByText("Descarga lo elegido para dejar esas escenas con medio")).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(posts).toContain("/api/projects/1/media:download-selected"));
    expect(await screen.findByText("Descargando… 40%")).toBeTruthy();
  });

  it("sin nada elegido indica cuántas escenas faltan", async () => {
    overview = { ...overview, selected_pending: 0, scenes: overview.scenes.map((s) => ({ ...s, selected_count: 0 })) };
    renderStage();
    expect(await screen.findByText("Faltan 2 escenas: elige un medio en cada una")).toBeTruthy();
    expect(screen.getByText("Descargar y aprobar").closest("button")!.disabled).toBe(true);
  });

  it("con todas las escenas con medio se puede aprobar", async () => {
    overview = { ...overview, with_media: 3, selected_pending: 0 };
    renderStage();
    await waitFor(() => expect(screen.getByText("Aprobar medios").closest("button")!.disabled).toBe(false));
  });

  it("cambia el tipo de la escena entre video e imagen sin desbloquear las escenas", async () => {
    renderStage();
    const toggle = await screen.findByText("Cambiar a video");
    fireEvent.click(toggle);
    expect(await screen.findByText("Cambiar a imagen")).toBeTruthy();
    expect(screen.getByText("Escena 1 · Video")).toBeTruthy();
  });

  it("con medios ya aprobados, ofrece desbloquearlos para cambiar el principal de la escena", async () => {
    overview = { ...overview, approved: true, editable: false };
    renderStage();
    expect(await screen.findByText(/desbloquéalos para quitar el principal/)).toBeTruthy();
    fireEvent.click(screen.getByText("Desbloquear medios")); // banner de la escena, no el de la barra inferior
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Desbloquear"));
    await waitFor(() => expect(posts).toContain("/api/projects/1/media:unlock"));
  });

  it("elegir 2 videos descargados suma sus duraciones y fusionarlos llama al endpoint", async () => {
    scene1Candidates = [videoCandidate(101, 9001, 5), videoCandidate(102, 9002, 7.5)];
    renderStage();
    const checkboxes = await screen.findAllByRole("checkbox", { name: /Fusionar/ });
    expect(checkboxes).toHaveLength(2);
    expect(screen.queryByText(/videos elegidos para fusionar/)).toBeNull();

    fireEvent.click(checkboxes[0]);
    expect(screen.queryByText(/videos elegidos para fusionar/)).toBeNull(); // falta el segundo
    fireEvent.click(checkboxes[1]);
    expect(await screen.findByText(/suman 12.5 s/)).toBeTruthy();

    fireEvent.click(screen.getByText("Fusionar en un video"));
    await waitFor(() => expect(mergeBody).toEqual({ asset_ids: [9001, 9002] }));
    expect(screen.queryByText(/videos elegidos para fusionar/)).toBeNull(); // la barra se cierra
  });
});
