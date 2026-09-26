import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaOverview, Project, SceneMedia } from "@/lib/api";
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

  beforeEach(() => {
    posts = [];
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
        if (path === "/api/projects/1/scenes") return ok({ scenes: [], review_count: 0 });
        if (path.match(/\/api\/scenes\/\d+\/media$/)) return ok(sceneMedia(Number(path.split("/")[3])));
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
});
