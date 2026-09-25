import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, Candidate, MediaOverview, Project, SceneMedia } from "@/lib/api";
import { CandidateCard } from "./CandidateCard";
import { extractUrl, isEditableTarget, isMediaFile, urlFromText } from "./dropUtils";
import { MediaViewer } from "./MediaViewer";
import { useMediaController } from "./useMediaController";
import { useMediaDrop } from "./useMediaDrop";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const data = (entries: Record<string, string>) => ({ getData: (t: string) => entries[t] ?? "" });

describe("lectura de lo que se suelta o se pega", () => {
  it("prefiere la imagen del HTML a la página", () => {
    expect(
      extractUrl(data({
        "text/html": '<a href="https://nota.example"><img alt="x" src="https://cdn.example/foto.jpg"></a>',
        "text/uri-list": "https://nota.example",
      })),
    ).toBe("https://cdn.example/foto.jpg");
  });

  it("usa uri-list (ignorando comentarios) o texto plano", () => {
    expect(extractUrl(data({ "text/uri-list": "# comentario\nhttps://a.example/x.png" }))).toBe("https://a.example/x.png");
    expect(extractUrl(data({ "text/plain": "  https://b.example/v.mp4 " }))).toBe("https://b.example/v.mp4");
    expect(extractUrl(data({ "text/plain": "hola mundo" }))).toBeNull();
  });

  it("valida URLs, archivos de medios y campos editables", () => {
    expect(urlFromText("ftp://x")).toBeNull();
    expect(urlFromText("https://x.example")).toBe("https://x.example");
    expect(isMediaFile("C:\\fotos\\Foto.JPEG")).toBe(true);
    expect(isMediaFile("clip.mov")).toBe(true);
    expect(isMediaFile("notas.txt")).toBe(false);
    const input = document.createElement("input");
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
  });
});

describe("pegar y soltar (useMediaDrop)", () => {
  function pasteEvent(files: File[], text = "") {
    const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { files, getData: (t: string) => (t === "text/plain" ? text : "") },
    });
    return event;
  }

  it("Ctrl+V con una imagen la sube; con una dirección la importa", async () => {
    const importer = vi.fn(async () => {});
    renderHook(() => useMediaDrop(true, importer));
    const image = new File(["x"], "image.png", { type: "image/png" });
    act(() => void window.dispatchEvent(pasteEvent([image])));
    await waitFor(() => expect(importer).toHaveBeenCalledWith({ kind: "file", file: image }));
    act(() => void window.dispatchEvent(pasteEvent([], "https://nota.example/foto.jpg")));
    await waitFor(() => expect(importer).toHaveBeenCalledWith({ kind: "url", url: "https://nota.example/foto.jpg" }));
  });

  it("no captura el pegado dentro de un campo ni cuando está desactivado", () => {
    const importer = vi.fn(async () => {});
    const { rerender } = renderHook(({ on }) => useMediaDrop(on, importer), { initialProps: { on: true } });
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = pasteEvent([], "https://x.example");
    Object.defineProperty(event, "target", { value: input });
    act(() => void input.dispatchEvent(event));
    rerender({ on: false });
    act(() => void window.dispatchEvent(pasteEvent([], "https://y.example")));
    expect(importer).not.toHaveBeenCalled();
    input.remove();
  });

  it("soltar archivos (HTML5) sube solo imágenes y videos", async () => {
    const importer = vi.fn(async () => {});
    function Zone() {
      const { dropProps, dragging } = useMediaDrop(true, importer);
      return <div data-testid="zone" data-dragging={dragging} {...dropProps} />;
    }
    render(<Zone />);
    const zone = screen.getByTestId("zone");
    const img = new File(["x"], "foto.jpg", { type: "image/jpeg" });
    const txt = new File(["x"], "notas.txt", { type: "text/plain" });
    fireEvent.dragOver(zone, { dataTransfer: { files: [], getData: () => "" } });
    expect(zone.dataset.dragging).toBe("true");
    fireEvent.drop(zone, { dataTransfer: { files: [img, txt], getData: () => "" } });
    await waitFor(() => expect(importer).toHaveBeenCalledTimes(1));
    expect(importer).toHaveBeenCalledWith({ kind: "file", file: img }, undefined);
    expect(zone.dataset.dragging).toBe("false");
  });

  it("soltar una imagen arrastrada desde el navegador importa su dirección", async () => {
    const importer = vi.fn(async () => {});
    function Zone() {
      const { dropProps } = useMediaDrop(true, importer);
      return <div data-testid="zone" {...dropProps} />;
    }
    render(<Zone />);
    fireEvent.drop(screen.getByTestId("zone"), {
      dataTransfer: { files: [], getData: (t: string) => (t === "text/uri-list" ? "https://cdn.example/a.jpg" : "") },
    });
    await waitFor(() =>
      expect(importer).toHaveBeenCalledWith({ kind: "url", url: "https://cdn.example/a.jpg" }, undefined),
    );
  });
});

// --- datos comunes para tarjeta, visor y controlador --------------------------------

const asset = (id: number): Asset => ({
  id, kind: "image", file_name: `00${id}.jpg`, file_url: `/api/assets/${id}/file`,
  thumb_url: `/api/assets/${id}/thumb`, provider: "pexels", provider_id: String(id),
  source_page_url: "https://pexels.com/1", author: "Ana", license: "Pexels License",
  width: 1080, height: 1920, duration_s: null, orientation: "portrait", size_bytes: 1048576, low_res: false,
});

const candidate = (id: number, over: Partial<Candidate> = {}): Candidate => ({
  id, scene_id: 1, provider: "pexels", provider_id: String(id), kind: "image",
  preview_url: `https://img/${id}.jpg`, video_preview_url: null, full_url: `https://img/${id}-full.jpg`,
  page_url: `https://pexels.com/${id}`, width: 1080, height: 1920, duration_s: null, author: "Ana",
  license: "Pexels License", query: "street", selected: false, download_status: "none", error: null,
  asset: null, ...over,
});

describe("tarjeta: soltar sobre un fallido y ver en grande", () => {
  it("los fallidos son zona para soltar y muestran el aviso al arrastrar", () => {
    const props = {
      index: 0, orientation: "portrait" as const, selected: false, approvedRole: null, editable: true,
      onToggle: vi.fn(), onApprove: vi.fn(), onRetry: vi.fn(), onOpen: vi.fn(), onHover: vi.fn(),
    };
    const { container, rerender } = render(
      <CandidateCard {...props} candidate={candidate(4, { download_status: "failed", error: "HTTP 403" })} dragging />,
    );
    expect(container.querySelector("[data-candidate-drop='4']")).toBeTruthy();
    expect(screen.getByText("Suelta aquí el archivo que bajaste")).toBeTruthy();
    rerender(<CandidateCard {...props} candidate={candidate(4)} />);
    expect(container.querySelector("[data-candidate-drop]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver candidato 1 en grande" }));
    expect(props.onOpen).toHaveBeenCalled();
  });
});

// --- controlador + visor con el núcleo simulado --------------------------------------

describe("vista grande, descargar y aprobar, e importación manual", () => {
  const project: Project = {
    id: 1, channel_id: 1, channel_name: "C", channel_slug: "c", title: "P", slug: "p",
    format: "reel", status: "MEDIOS_EN_REVISION", topic: null, research_notes: null,
    target_duration_s: 60, target_publish_at: null, priority: 2, tags: [], folder_path: "",
    parent_project_id: null, created_at: "", updated_at: "",
  };
  let scene: SceneMedia;
  let requests: { method: string; path: string; body: unknown }[];

  beforeEach(() => {
    requests = [];
    scene = {
      scene_id: 1, position: 1, seg_key: "seg_001", media_kind: "image", narration: "N",
      visual_description: "Calle", query_en: "street", query_alt: null, query_real: null,
      start_s: 0, end_s: 2, status: "candidates", needs_media: true, default_query: "street",
      search_kind: "image", approved: [],
      candidates: [candidate(10), candidate(11, { download_status: "done", asset: asset(7) })],
    };
    const overview: MediaOverview = {
      project_id: 1, orientation: "portrait", editable: true, approved: false, configured_providers: ["pexels"],
      scenes: [{ scene_id: 1, position: 1, media_kind: "image", visual_description: "Calle", status: "candidates",
        needs_media: true, candidate_count: 2, downloaded_count: 1, approved_thumb_url: null }],
      needing_media: 1, with_media: 0,
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      const isForm = init?.body instanceof FormData;
      const body = init?.body && !isForm ? JSON.parse(String(init.body)) : init?.body;
      requests.push({ method, path, body });
      const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
      if (path === "/api/projects/1/media") return ok(overview);
      if (path === "/api/scenes/1/media") return ok(scene);
      if (path.endsWith("candidates:download")) {
        // El núcleo descarga y la galería se refresca con el candidato ya descargado.
        scene = { ...scene, candidates: scene.candidates.map((c) => (c.id === 10 ? { ...c, download_status: "done", asset: asset(8) } : c)) };
        return ok({ id: 3, type: "download_media", project_id: 1, status: "queued", progress: 0, message: null, result: null, error: null, created_at: "", finished_at: null });
      }
      if (path.includes(":approve")) {
        const id = Number(path.split("/")[5].replace(":approve", ""));
        scene = { ...scene, status: "approved", approved: [{ asset: asset(id), role: "main", file_name: "001.jpg" }] };
        return ok(scene);
      }
      if (path.endsWith("assets:import") || path.endsWith("assets:upload")) {
        scene = {
          ...scene,
          candidates: [...scene.candidates, candidate(12, { provider: "manual", download_status: "manual", asset: asset(9) })],
          approved: [{ asset: asset(9), role: "main", file_name: "001.png" }],
        };
        return ok(scene);
      }
      if (path === "/api/system/open-url" || path.endsWith(":reveal")) return new Response(null, { status: 204 });
      return new Response("{}", { status: 404 });
    }));
  });

  function Harness({ onCtl }: { onCtl: (c: ReturnType<typeof useMediaController>) => void }) {
    const ctl = useMediaController(project);
    onCtl(ctl);
    return <MediaViewer ctl={ctl} />;
  }

  function setup() {
    let ctl!: ReturnType<typeof useMediaController>;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness onCtl={(c) => (ctl = c)} />
      </QueryClientProvider>,
    );
    return () => ctl;
  }

  it("abre la vista grande con los datos y recorre con ← →", async () => {
    const ctl = setup();
    await waitFor(() => expect(ctl().scene).toBeTruthy());
    act(() => ctl().openViewer(10));
    expect(await screen.findByText("Medio 1 de 2")).toBeTruthy();
    expect(screen.getByText("Pexels License")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Descargar y aprobar/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(await screen.findByText("Medio 2 de 2")).toBeTruthy();
    // El descargado ofrece aprobar y mostrar en carpeta.
    expect(screen.getByRole("button", { name: "Aprobar como principal" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Mostrar en carpeta/ }));
    await waitFor(() => expect(requests.some((r) => r.path === "/api/assets/7:reveal")).toBe(true));
  });

  it("Abrir en navegador pide al núcleo abrir la página de origen", async () => {
    const ctl = setup();
    await waitFor(() => expect(ctl().scene).toBeTruthy());
    act(() => ctl().openViewer(10));
    fireEvent.click(await screen.findByRole("button", { name: /Abrir en navegador/ }));
    await waitFor(() =>
      expect(requests.find((r) => r.path === "/api/system/open-url")?.body).toEqual({ url: "https://pexels.com/10" }),
    );
  });

  it("Descargar y aprobar: descarga y, al terminar, aprueba como principal", async () => {
    const ctl = setup();
    await waitFor(() => expect(ctl().scene).toBeTruthy());
    act(() => ctl().downloadAndApprove(10));
    await waitFor(() => expect(requests.some((r) => r.path.endsWith(":approve"))).toBe(true));
    expect(requests.find((r) => r.path.endsWith("candidates:download"))!.body).toEqual({ candidate_ids: [10] });
    expect(requests.find((r) => r.path.endsWith(":approve"))!.path).toBe("/api/scenes/1/assets/8:approve");
  });

  it("importar una ruta local, una URL o un archivo pegado", async () => {
    const ctl = setup();
    await waitFor(() => expect(ctl().scene).toBeTruthy());
    await act(() => ctl().importMedia({ kind: "path", path: "C:\\fotos\\a.jpg" }));
    await act(() => ctl().importMedia({ kind: "url", url: "https://nota.example" }, 10));
    await act(() => ctl().importMedia({ kind: "file", file: new File(["x"], "image.png", { type: "image/png" }) }));
    const imports = requests.filter((r) => r.path.includes("assets:"));
    expect(imports[0]).toMatchObject({ path: "/api/scenes/1/assets:import", body: { path: "C:\\fotos\\a.jpg", candidate_id: null } });
    expect(imports[1]).toMatchObject({ body: { url: "https://nota.example", candidate_id: 10 } });
    expect(imports[2].path).toBe("/api/scenes/1/assets:upload");
    expect(imports[2].body).toBeInstanceOf(FormData);
    expect((imports[2].body as FormData).get("file")).toBeInstanceOf(File);
    await waitFor(() => expect(ctl().scene?.approved[0].asset.id).toBe(9));
  });
});
