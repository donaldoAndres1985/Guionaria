import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate, MediaOverview, Project, SceneMedia } from "@/lib/api";
import { CandidateCard } from "./CandidateCard";
import { isVideoSite, parseClock } from "./dropUtils";
import { useMediaController } from "./useMediaController";
import { VideoUrlDialog } from "./VideoUrlDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("utilidades de video desde URL", () => {
  it("reconoce enlaces de YouTube y redes", () => {
    expect(isVideoSite("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isVideoSite("https://youtu.be/abc")).toBe(true);
    expect(isVideoSite("https://m.facebook.com/video/1")).toBe(true);
    expect(isVideoSite("https://noticias.example/nota")).toBe(false);
    expect(isVideoSite("no es url")).toBe(false);
  });

  it("interpreta tiempos mm:ss", () => {
    expect(parseClock("1:25")).toBe(85);
    expect(parseClock("45")).toBe(45);
    expect(parseClock("1:02:03")).toBe(3723);
    expect(parseClock("12.5")).toBe(12.5);
    expect(parseClock("")).toBeNull();
    expect(parseClock("uno")).toBeNaN();
  });
});

describe("etiqueta de derechos", () => {
  it("el material web sin licencia muestra «Derechos: revisar»", () => {
    const c: Candidate = {
      id: 1, scene_id: 1, provider: "searxng", provider_id: "a", kind: "image", preview_url: null,
      video_preview_url: null, full_url: "https://n.example/f.jpg", page_url: "https://n.example",
      width: 800, height: 1200, duration_s: null, author: "n.example", license: "Derechos: revisar",
      query: "q", selected: false, download_status: "none", error: null, asset: null,
    };
    render(
      <CandidateCard candidate={c} index={0} orientation="portrait" selected={false} approvedRole={null}
        editable onToggle={vi.fn()} onApprove={vi.fn()} onRetry={vi.fn()} onOpen={vi.fn()} onHover={vi.fn()} />,
    );
    expect(screen.getByText("Derechos: revisar")).toBeTruthy();
    expect(screen.getByText("Web (SearXNG)")).toBeTruthy();
  });
});

describe("fuentes por escena y video desde URL", () => {
  const project: Project = {
    id: 1, channel_id: 1, channel_name: "C", channel_slug: "c", title: "P", slug: "p",
    format: "reel", status: "MEDIOS_EN_REVISION", topic: null, research_notes: null,
    target_duration_s: 60, target_publish_at: null, priority: 2, tags: [], folder_path: "",
    parent_project_id: null, created_at: "", updated_at: "",
  };
  let requests: { path: string; body: unknown }[];

  beforeEach(() => {
    requests = [];
    const scene: SceneMedia = {
      scene_id: 1, position: 3, seg_key: "seg_003", media_kind: "real", narration: "N",
      visual_description: "Foto real", query_en: null, query_alt: null, query_real: "priscila foto",
      start_s: 4, end_s: 6, status: "candidates", needs_media: true, default_query: "priscila foto",
      search_kind: "image", available_providers: ["pexels", "openverse", "wikimedia", "searxng"],
      default_providers: ["searxng", "wikimedia", "openverse"], approved: [],
      candidates: [{ id: 9, scene_id: 1, provider: "wikimedia", provider_id: "1", kind: "image",
        preview_url: null, video_preview_url: null, full_url: null, page_url: null, width: 1, height: 2,
        duration_s: null, author: null, license: null, query: "q", selected: false, download_status: "none",
        error: null, asset: null }],
    };
    const overview: MediaOverview = {
      project_id: 1, orientation: "portrait", editable: true, approved: false,
      configured_providers: ["pexels", "openverse", "wikimedia", "searxng"],
      scenes: [{ scene_id: 1, position: 3, media_kind: "real", visual_description: "Foto real", status: "candidates",
        needs_media: true, candidate_count: 1, downloaded_count: 0, selected_count: 0, approved_thumb_url: null }],
      needing_media: 1, with_media: 0, selected_pending: 0,
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path, body });
      const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
      if (path === "/api/projects/1/media") return ok(overview);
      if (path === "/api/scenes/1/media") return ok(scene);
      if (path.endsWith("/search")) return ok({ scene, warnings: [], page: 1, has_more: false });
      if (path.endsWith("assets:video-url")) {
        return ok({ id: 4, type: "download_url", project_id: 1, status: "queued", progress: 0, message: null,
          result: null, error: null, created_at: "", finished_at: null });
      }
      return new Response("{}", { status: 404 });
    }));
  });

  function setup() {
    let ctl!: ReturnType<typeof useMediaController>;
    function Harness() {
      ctl = useMediaController(project);
      return <VideoUrlDialog ctl={ctl} />;
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Harness />
      </QueryClientProvider>,
    );
    return () => ctl;
  }

  it("una escena de material real busca por defecto en web, Wikimedia y Openverse", async () => {
    const ctl = setup();
    await waitFor(() => expect(ctl().scene).toBeTruthy());
    expect(ctl().providers).toEqual(["searxng", "wikimedia", "openverse"]);
    await act(() => ctl().search());
    expect(requests.find((r) => r.path.endsWith("/search"))!.body).toMatchObject({
      providers: ["searxng", "wikimedia", "openverse"],
    });
    act(() => ctl().setProviders(["wikimedia"]));
    await act(() => ctl().search());
    expect(requests.filter((r) => r.path.endsWith("/search")).at(-1)!.body).toMatchObject({ providers: ["wikimedia"] });
  });

  it("pegar un enlace de YouTube abre el diálogo y descarga solo el fragmento", async () => {
    const ctl = setup();
    await waitFor(() => expect(ctl().scene).toBeTruthy());
    await act(() => ctl().importMedia({ kind: "url", url: "https://youtu.be/abc" }));
    expect(requests.some((r) => r.path.includes("assets:import"))).toBe(false);
    expect(await screen.findByText("Video desde URL")).toBeTruthy();
    expect((screen.getByPlaceholderText("https://www.youtube.com/watch?v=…") as HTMLInputElement).value).toBe(
      "https://youtu.be/abc",
    );

    fireEvent.change(screen.getByPlaceholderText("1:25"), { target: { value: "1:25" } });
    expect(screen.getByText("Indica inicio y fin, o deja ambos vacíos para el video completo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Descargar video" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("1:32"), { target: { value: "1:32" } });
    expect(screen.getByText("Se bajará un fragmento de 7 s.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Descargar video" }));
    await waitFor(() => expect(requests.some((r) => r.path.endsWith("assets:video-url"))).toBe(true));
    expect(requests.find((r) => r.path.endsWith("assets:video-url"))).toEqual({
      path: "/api/scenes/1/assets:video-url",
      body: { url: "https://youtu.be/abc", start_s: 85, end_s: 92 },
    });
    await waitFor(() => expect(ctl().videoDialogUrl).toBeNull());
  });

  it("video completo si no hay fragmento; valida el orden", async () => {
    const ctl = setup();
    await waitFor(() => expect(ctl().scene).toBeTruthy());
    act(() => ctl().openVideoDialog());
    const url = await screen.findByPlaceholderText("https://www.youtube.com/watch?v=…");
    fireEvent.change(url, { target: { value: "https://vimeo.com/1" } });
    fireEvent.change(screen.getByPlaceholderText("1:25"), { target: { value: "2:00" } });
    fireEvent.change(screen.getByPlaceholderText("1:32"), { target: { value: "1:00" } });
    expect(screen.getByText("El fin debe ser mayor que el inicio")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("1:25"), { target: { value: "" } });
    fireEvent.change(screen.getByPlaceholderText("1:32"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Descargar video" }));
    await waitFor(() =>
      expect(requests.find((r) => r.path.endsWith("assets:video-url"))!.body).toEqual({
        url: "https://vimeo.com/1", start_s: null, end_s: null,
      }),
    );
  });
});
