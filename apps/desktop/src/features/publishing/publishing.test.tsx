import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Publication, PublishingState, QueueItem } from "@/lib/api";
import { PublishingPage } from "@/pages/Publishing";
import { PublishBottomBar, PublishStage, usePublishController } from "./PublishStage";
import { kitSteps, kitSummary } from "./ManualKit";
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
  caption: "Un caso que cambió todo.\n\n#truecrime\n\nCréditos — El secuestro",
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
    publication({
      id: 2,
      platform: "tiktok",
      label: "TikTok",
      tags: [],
      full_text: "Nadie vio nada.",
      caption: "El secuestro que nadie vio\n\nNadie vio nada.",
      upload_url: "https://www.tiktok.com/tiktokstudio/upload",
    }),
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
        const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path: url.pathname, body });
        const ok = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
        if (url.pathname === "/api/projects/7/publishing") return ok(state);
        if (url.pathname === "/api/jobs") return ok([]);
        if (url.pathname === "/api/settings") {
          return ok(method === "PUT" ? body : { youtube: { client_id: "", client_secret: "" }, api_keys: {} });
        }
        if ((url.pathname.startsWith("/api/publications/") && url.pathname.endsWith(":upload")) || url.pathname.endsWith(":generate") || url.pathname.endsWith(":titles") || url.pathname.endsWith("cover:design")) {
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

  it("publicar a mano: pasos de la plataforma, copiar cada dato, mostrar archivos y pegar la dirección", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText, write: vi.fn() }, configurable: true });
    renderStage();
    fireEvent.click(await screen.findByText("TikTok"));
    const editor = await screen.findByLabelText("Publicación en TikTok");
    const kit = within(editor).getByLabelText("Publicar a mano en TikTok");
    // Pasos de TikTok: abrir, video, texto único (con el título arriba), portada, fecha, créditos, comentario.
    expect(within(kit).getAllByRole("listitem").map((li) => li.dataset.testid).filter(Boolean)).toEqual([
      "kit-open", "kit-video", "kit-caption", "kit-cover", "kit-schedule", "kit-credits", "kit-pinned",
    ]);
    fireEvent.click(within(within(kit).getByTestId("kit-open")).getByText("Abrir"));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "POST", path: "/api/system/open-url", body: { url: "https://www.tiktok.com/tiktokstudio/upload" } }),
    );
    fireEvent.click(within(kit).getByLabelText("Mostrar archivo: Sube el video: arrástralo desde la carpeta"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/projects/7/publishing:reveal" && c.method === "POST")).toBe(true));
    fireEvent.click(within(kit).getByLabelText("Copiar: Descripción (título, texto y hashtags)"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("El secuestro que nadie vio\n\nNadie vio nada."));
    fireEvent.click(within(kit).getByLabelText("Copiar: Créditos de los medios en el primer comentario"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Créditos — El secuestro"));
    fireEvent.click(within(kit).getByText("Copiar todo"));
    await waitFor(() => expect(String(writeText.mock.calls.at(-1)?.[0])).toContain("TIKTOK — El secuestro que nadie vio"));
    fireEvent.change(within(editor).getByLabelText("Dirección publicada en TikTok"), { target: { value: "https://www.tiktok.com/@x/video/1" } });
    fireEvent.click(within(editor).getByText("Marcar como publicado"));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "POST", path: "/api/publications/2:published", body: { url: "https://www.tiktok.com/@x/video/1" } }),
    );
  });

  it("miniatura propia: soltar, pegar con Ctrl+V o subir desde el disco", async () => {
    renderStage();
    const drop = await screen.findByTestId("cover-drop");
    const uploads = () => calls.filter((c) => c.path === "/api/projects/7/publishing/thumbnail:upload");
    const png = new File([new Uint8Array([137, 80, 78, 71])], "mia.png", { type: "image/png" });

    fireEvent.drop(drop, { dataTransfer: { files: [png] } });
    await waitFor(() => expect(uploads()).toHaveLength(1));
    expect((uploads()[0].body as FormData).get("file")).toBeInstanceOf(File);

    const paste = new Event("paste", { bubbles: true }) as ClipboardEvent;
    Object.defineProperty(paste, "clipboardData", { value: { files: [png] } });
    window.dispatchEvent(paste);
    await waitFor(() => expect(uploads()).toHaveLength(2));

    fireEvent.change(screen.getByLabelText("Archivo de miniatura"), { target: { files: [png] } });
    await waitFor(() => expect(uploads()).toHaveLength(3));
    // Un archivo que no es imagen no se envía.
    fireEvent.drop(drop, { dataTransfer: { files: [new File(["x"], "nota.txt", { type: "text/plain" })] } });
    expect(uploads()).toHaveLength(3);
  });

  it("generar los textos con Claude desde la barra inferior", async () => {
    renderStage();
    fireEvent.click(await screen.findByText("Regenerar textos con Claude"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/projects/7/publishing:generate")).toBe(true));
    expect(screen.getByText("YouTube · TikTok")).toBeTruthy();
    expect(screen.getByText("0/2")).toBeTruthy();
  });
});

describe("títulos con gancho y miniatura con Claude", () => {
  let state: PublishingState;
  let calls: { method: string; path: string; body: unknown }[];

  beforeEach(() => {
    calls = [];
    const pub = publication();
    state = baseState({
      publications: [
        {
          ...pub,
          meta: {
            ...pub.meta,
            title_ideas: [
              { title: "36 días creyendo que fue un accidente", hook: "Cifra concreta", why: "Dato real y verificable." },
              { title: "¿Quién movió el cuerpo?", hook: "Pregunta abierta", why: "Intriga." },
            ],
          },
        },
      ],
      cover_options: [
        { index: 1, url: "/api/projects/7/publishing/cover/1?v=1", design: { cuadro: 1, plantilla: "impacto", texto: "¿Un accidente?", resaltar: "accidente", etiqueta: "Caso real", color: "#FFD400", foco_x: 0.4, foco_y: 0.3, por_que: "El rostro se ve claro." } },
        { index: 2, url: "/api/projects/7/publishing/cover/2?v=1", design: { cuadro: 2, plantilla: "expediente", texto: "Nadie vio nada", resaltar: "nada", etiqueta: null, color: "#FFD400", foco_x: 0.5, foco_y: 0.5, por_que: "" } },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const ok = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
        if (url.pathname === "/api/projects/7/publishing") return ok(state);
        if (url.pathname.endsWith(":titles") || url.pathname.endsWith("cover:design")) {
          return ok({ id: 60, type: "publishing_titles", project_id: 7, status: "queued", progress: 0, created_at: "" }, 202);
        }
        if (url.pathname === "/api/jobs/60") return ok({ id: 60, type: "publishing_titles", project_id: 7, status: "running", progress: 0.2, message: "Claude está pensando…", created_at: "" });
        if (method !== "GET") return ok(state);
        return ok([]);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderStage() {
    function Harness() {
      const ctl = usePublishController(project);
      return <PublishStage project={project} ctl={ctl} onGoToTimeline={() => {}} />;
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/proyectos/7"]}>
          <Routes>
            <Route path="/proyectos/7" element={<Harness />} />
            <Route path="/ajustes" element={<p>ajustes abiertos</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("propone títulos con gancho, se elige uno y se puede editar la guía", async () => {
    renderStage();
    const ideas = await screen.findByLabelText("Títulos propuestos por Claude");
    expect(within(ideas).getByText("Cifra concreta")).toBeTruthy();
    expect(within(ideas).getByText("Dato real y verificable.")).toBeTruthy();
    fireEvent.click(within(ideas).getByText("¿Quién movió el cuerpo?"));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ title: "¿Quién movió el cuerpo?" }));
    fireEvent.click(screen.getByText("Proponer otros títulos"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/publications/1:titles")).toBe(true));
    expect(await screen.findByText("Claude está pensando títulos…")).toBeTruthy();
    fireEvent.click(screen.getByText("Editar la guía de títulos"));
    expect(await screen.findByText("ajustes abiertos")).toBeTruthy();
  });

  it("doble clic en una propuesta la abre en grande", async () => {
    renderStage();
    const designer = await screen.findByLabelText("Miniatura con Claude");
    fireEvent.doubleClick(within(designer).getByRole("radio", { name: "Propuesta 2: Nadie vio nada" }));
    const big = await screen.findByTestId("image-preview");
    expect(big.getAttribute("src")).toContain("/api/projects/7/publishing/cover/2");
    expect(screen.getByText("Propuesta 2: Nadie vio nada")).toBeTruthy();
    fireEvent.keyDown(big, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("image-preview")).toBeNull());
  });

  it("miniatura: Claude diseña, se elige una propuesta, se retoca y se usa", async () => {
    renderStage();
    const designer = await screen.findByLabelText("Miniatura con Claude");
    expect(within(designer).getByText("El rostro se ve claro.")).toBeTruthy();
    fireEvent.click(within(designer).getByRole("radio", { name: "Propuesta 2: Nadie vio nada" }));
    const edit = within(designer).getByLabelText("Retocar propuesta");
    fireEvent.change(within(edit).getByLabelText("Texto de la miniatura"), { target: { value: "Silencio total" } });
    fireEvent.click(within(edit).getByLabelText("Acento #E53935"));
    fireEvent.click(within(edit).getByText("Volver a dibujar"));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith("cover:redraw"))?.body).toMatchObject({
        index: 2,
        design: { texto: "Silencio total", color: "#E53935", plantilla: "expediente" },
      }),
    );
    fireEvent.click(within(edit).getByText("Usar esta"));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("cover:choose"))?.body).toEqual({ index: 2 }));
    fireEvent.click(within(designer).getByText("Diseñar otras con Claude"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/projects/7/publishing/cover:design")).toBe(true));
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

describe("kit de publicación manual", () => {
  it("YouTube: pasos en el orden de Studio con cada dato para copiar", () => {
    const state = baseState();
    const yt = { ...publication(), meta: { ...publication().meta, made_for_kids: false } };
    const steps = kitSteps(yt, state);
    expect(steps.map((s) => s.id)).toEqual(["open", "video", "title", "description", "thumbnail", "kids", "tags", "subtitles", "visibility", "pinned"]);
    expect(steps.find((s) => s.id === "kids")?.label).toBe("Audiencia: No, no es contenido para niños");
    expect(steps.find((s) => s.id === "tags")?.action).toEqual({ kind: "copy", text: "caso priscila", what: "Etiquetas" });
    // Sin miniatura, el paso avisa que falta el archivo.
    expect(steps.find((s) => s.id === "thumbnail")?.action).toEqual({ kind: "reveal", file: "thumbnail", available: false });
    const summary = kitSummary(yt, state);
    expect(summary).toContain("TÍTULO:\nEl secuestro que nadie vio");
    expect(summary).toContain("ETIQUETAS:\ncaso priscila");
    expect(summary).toContain("VIDEO: C:\\Guionaria\\proyecto.mp4");
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
