import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Publication, PublishingState, QueueItem } from "@/lib/api";
import { PublishingPage } from "@/pages/Publishing";
import { PublishBottomBar, PublishStage, usePublishController } from "./PublishStage";
import { fromLocalInput, splitList, toLocalInput } from "./publishingMeta";

const project = { id: 7, title: "El secuestro", status: "RENDERIZADO", format: "reel", channel_id: 1 } as Project;

const publication = (over: Partial<Publication> = {}): Publication => ({
  id: 1,
  platform: "youtube",
  label: "YouTube",
  enabled: true,
  title: "El secuestro que nadie vio",
  description: "Un caso que cambió todo.",
  tags: ["caso priscila"],
  visibility: "public",
  scheduled_at: null,
  published_at: null,
  external_url: null,
  status: "draft",
  error: null,
  meta: {
    title_options: ["El secuestro que nadie vio", "36 días de silencio"],
    hashtags: ["truecrime"],
    pinned_comment: "¿Qué crees?",
    chapters: [],
    made_for_kids: null,
    synthetic: false,
    playlist_id: null,
    captions: true,
    category_id: "22",
    thumbnail_time_s: null,
    thumbnail_text: null,
    checks: {},
    warning: null,
  },
  checklist: [
    { id: "render", label: "Video final renderizado", done: true, manual: false, hint: null },
    { id: "respect", label: "Sin detalles gráficos", done: false, manual: true, hint: null },
  ],
  limits: { title: 100, description: 5000, tags: 500, hashtags: 5 },
  full_text: "Un caso que cambió todo.\n\n#truecrime\n\nCréditos — El secuestro",
  upload_url: "https://www.youtube.com/upload",
  thumbnail_url: null,
  ...over,
});

const baseState = (over: Partial<PublishingState> = {}): PublishingState => ({
  project_id: 7,
  channel_id: 1,
  channel_name: "Casos Reales",
  format: "reel",
  can_publish: true,
  reason: null,
  video_url: "/api/projects/7/render/files/proyecto.mp4",
  video_file: "C:\\Guionaria\\proyecto.mp4",
  subtitles: true,
  credits: "Créditos — El secuestro",
  publications: [
    publication(),
    publication({ id: 2, platform: "tiktok", label: "TikTok", tags: [], full_text: "Nadie vio nada.", upload_url: "https://www.tiktok.com/tiktokstudio/upload" }),
  ],
  youtube: { configured: false, connected: false, account: null, redirect_uri: "http://127.0.0.1:8765/api/youtube/oauth/callback" },
  ...over,
});

describe("publicación", () => {
  let state: PublishingState;
  let calls: { method: string; path: string; body: unknown }[];

  beforeEach(() => {
    calls = [];
    state = baseState();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path: url.pathname, body });
        const ok = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
        if (url.pathname === "/api/projects/7/publishing") return ok(state);
        if (url.pathname === "/api/jobs") return ok([]);
        if (url.pathname === "/api/settings") {
          return ok(method === "PUT" ? body : { youtube: { client_id: "", client_secret: "" }, api_keys: {} });
        }
        if (url.pathname.endsWith(":upload") || url.pathname.endsWith(":generate")) {
          return ok({ id: 50, type: "publish", project_id: 7, status: "queued", progress: 0, created_at: "" }, 202);
        }
        if (url.pathname === "/api/jobs/50") return ok({ id: 50, type: "publish", project_id: 7, status: "running", progress: 0.4, message: "Subiendo a YouTube… 40 %", created_at: "" });
        if (url.pathname.endsWith("youtube:connect")) return ok({ auth_url: "https://accounts.google.com/x" });
        if (method !== "GET") return ok(state);
        return ok([]);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderStage(onGoToTimeline = vi.fn()) {
    function Harness() {
      const ctl = usePublishController(project);
      return (
        <>
          <PublishStage project={project} ctl={ctl} onGoToTimeline={onGoToTimeline} />
          <PublishBottomBar ctl={ctl} />
        </>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return onGoToTimeline;
  }

  const patches = () => calls.filter((c) => c.method === "PATCH");

  it("sin render invita a ir al Timeline", async () => {
    state = baseState({ can_publish: false, reason: "Renderiza el video final en el Timeline para publicarlo" });
    const go = renderStage();
    fireEvent.click(await screen.findByText("Ir al Timeline"));
    expect(go).toHaveBeenCalled();
  });

  it("plataformas con su interruptor, títulos propuestos, textos y verificación", async () => {
    renderStage();
    const editor = await screen.findByLabelText("Publicación en YouTube");
    // «Publicar en…»: apagar TikTok.
    fireEvent.click(screen.getByLabelText("Publicar en TikTok"));
    await waitFor(() => expect(patches()).toContainEqual({ method: "PATCH", path: "/api/publications/2", body: { enabled: false } }));
    // Elegir otro título propuesto.
    fireEvent.click(within(editor).getByRole("radio", { name: "36 días de silencio" }));
    await waitFor(() => expect(patches().at(-1)).toMatchObject({ path: "/api/publications/1", body: { title: "36 días de silencio" } }));
    // Editar la descripción guarda al salir del campo.
    const desc = within(editor).getByLabelText("Descripción");
    fireEvent.change(desc, { target: { value: "Otra descripción" } });
    fireEvent.blur(desc);
    await waitFor(() => expect(patches().at(-1)?.body).toEqual({ description: "Otra descripción" }));
    // Texto listo para pegar con créditos.
    expect(screen.getByTestId("full-text").textContent).toContain("Créditos — El secuestro");
    // Verificación manual.
    fireEvent.click(within(editor).getByLabelText("Sin detalles gráficos"));
    await waitFor(() => expect(patches().at(-1)?.body).toEqual({ checks: { respect: true } }));
    expect((within(editor).getByLabelText("Video final renderizado") as HTMLInputElement).disabled).toBe(true);
  });

  it("YouTube: configurar el acceso de Google, conectar el canal y subir", async () => {
    renderStage();
    const setup = await screen.findByLabelText("Configurar YouTube");
    fireEvent.change(within(setup).getByLabelText("ID de cliente de Google"), { target: { value: "cid.apps.googleusercontent.com" } });
    fireEvent.change(within(setup).getByLabelText("Secreto de cliente de Google"), { target: { value: "sec" } });
    fireEvent.click(within(setup).getByText("Guardar acceso de Google"));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT" && c.path === "/api/settings")?.body).toMatchObject({
        youtube: { client_id: "cid.apps.googleusercontent.com", client_secret: "sec" },
      }),
    );
    cleanup();

    state = baseState({ youtube: { ...state.youtube, configured: true } });
    renderStage();
    fireEvent.click(await screen.findByText("Conectar canal de YouTube"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/channels/1/youtube:connect")).toBe(true));
    expect(await screen.findByText("Esperando a Google…")).toBeTruthy();
    cleanup();

    state = baseState({ youtube: { ...state.youtube, configured: true, connected: true, account: "Casos Reales TV" } });
    renderStage();
    expect((await screen.findByTestId("youtube-connected")).textContent).toContain("Casos Reales TV");
    // Sin decidir «contenido para niños» no se sube.
    const uploadBtn = screen.getByText("Subir a YouTube").closest("button")!;
    expect(uploadBtn.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    await waitFor(() => expect(patches().at(-1)?.body).toEqual({ made_for_kids: false }));
    cleanup();

    state = baseState({
      youtube: { ...state.youtube, configured: true, connected: true, account: "Casos Reales TV" },
      publications: [publication({ meta: { ...publication().meta, made_for_kids: false } })],
    });
    renderStage();
    fireEvent.click(await screen.findByText("Subir a YouTube"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/publications/1:upload")).toBe(true));
    expect(await screen.findByText("Subiendo a YouTube… 40 %")).toBeTruthy();
  });

  it("publicar a mano: abrir la plataforma y pegar la dirección", async () => {
    renderStage();
    fireEvent.click(await screen.findByText("TikTok"));
    const editor = await screen.findByLabelText("Publicación en TikTok");
    fireEvent.click(within(editor).getByText("Abrir TikTok"));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "POST", path: "/api/system/open-url", body: { url: "https://www.tiktok.com/tiktokstudio/upload" } }),
    );
    fireEvent.change(within(editor).getByLabelText("Dirección publicada en TikTok"), { target: { value: "https://www.tiktok.com/@x/video/1" } });
    fireEvent.click(within(editor).getByText("Marcar como publicado"));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "POST", path: "/api/publications/2:published", body: { url: "https://www.tiktok.com/@x/video/1" } }),
    );
  });

  it("generar los textos con Claude desde la barra inferior", async () => {
    renderStage();
    fireEvent.click(await screen.findByText("Regenerar textos con Claude"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/projects/7/publishing:generate")).toBe(true));
    expect(screen.getByText("YouTube · TikTok")).toBeTruthy();
    expect(screen.getByText("0/2")).toBeTruthy();
  });
});

describe("cola de publicación", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("pendiente por fecha y publicado; abre la etapa del proyecto", async () => {
    const item = (over: Partial<QueueItem>): QueueItem => ({
      id: 1, project_id: 7, project_title: "El secuestro", channel_id: 1, channel_name: "Casos Reales",
      platform: "youtube", label: "YouTube", title: "El secuestro que nadie vio", status: "scheduled",
      scheduled_at: "2026-10-02T18:00:00+00:00", published_at: null, external_url: null, target_publish_at: null, ...over,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/publishing/queue") {
          return new Response(JSON.stringify([item({}), item({ id: 2, platform: "tiktok", label: "TikTok", status: "published", published_at: "2026-09-20T10:00:00+00:00", external_url: "https://tiktok.com/x" })]));
        }
        return new Response("[]");
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/publicacion"]}>
          <Routes>
            <Route path="/publicacion" element={<PublishingPage />} />
            <Route path="/proyectos/:id" element={<p>proyecto abierto</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const pending = await screen.findByRole("region", { name: "Pendiente" });
    expect(within(pending).getByText("Programado")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Publicado" })).getByLabelText("Abrir TikTok")).toBeTruthy();
    fireEvent.click(within(pending).getByText("El secuestro que nadie vio"));
    expect(await screen.findByText("proyecto abierto")).toBeTruthy();
  });
});

describe("utilidades", () => {
  it("listas y fechas", () => {
    expect(splitList("#uno #dos, tres")).toEqual(["uno", "dos", "tres"]);
    expect(splitList("caso priscila, true crime", ",")).toEqual(["caso priscila", "true crime"]);
    const local = "2026-10-02T18:30";
    expect(toLocalInput(fromLocalInput(local))).toBe(local);
    expect(toLocalInput(null)).toBe("");
  });
});
