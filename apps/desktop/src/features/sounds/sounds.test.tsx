import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FreesoundResult, Sound } from "@/lib/api";
import { SfxMusicPage } from "@/pages/SfxMusic";
import { SceneSoundsBar } from "./SceneSoundsBar";
import { formatSeconds } from "./usePreview";

vi.mock("@/components/layout/PageLayout", () => ({
  PageLayout: ({ children, bottomBar, actions }: { children: React.ReactNode; bottomBar?: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {actions}
      {children}
      {bottomBar}
    </div>
  ),
}));

const sound = (id: number, over: Partial<Sound> = {}): Sound => ({
  id,
  kind: "sfx",
  title: `sonido ${id}`,
  file_url: `/api/sounds/${id}/file`,
  provider: "manual",
  source_url: null,
  author: null,
  license: null,
  duration_s: 1.2,
  tags: ["whoosh"],
  mood: null,
  bpm: null,
  size_bytes: 1000,
  used_in: 0,
  created_at: "2026-09-26T10:00:00",
  ...over,
});

const result: FreesoundResult = {
  freesound_id: 101,
  title: "whoosh_fast",
  tags: ["whoosh", "fast"],
  duration_s: 1.2,
  license: "CC BY 4.0",
  author: "sonidista",
  page_url: "https://freesound.org/s/101/",
  preview_url: "https://cdn.freesound.org/101.mp3",
  saved_sound_id: null,
};

describe("sonidos", () => {
  let requests: { method: string; url: URL; body: unknown }[];
  let sounds: Sound[];

  beforeEach(() => {
    requests = [];
    sounds = [sound(1, { title: "golpe seco", tags: ["impact"], used_in: 2 }), sound(2)];
    vi.stubGlobal("Audio", class {
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn();
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ method, url, body });
        const ok = (data: unknown) => new Response(JSON.stringify(data));
        if (url.pathname === "/api/sounds/tags") return ok([{ tag: "impact", count: 1 }, { tag: "whoosh", count: 1 }]);
        if (url.pathname === "/api/sounds:upload") return ok([sound(9, { title: "subido" })]);
        if (url.pathname === "/api/sounds") {
          const tag = url.searchParams.get("tag");
          const kind = url.searchParams.get("kind");
          return ok(sounds.filter((s) => (!tag || s.tags.includes(tag)) && (!kind || s.kind === kind)));
        }
        if (url.pathname === "/api/freesound/search") return ok({ results: [result], total: 1, page: 1, has_more: false });
        if (url.pathname === "/api/freesound:save") return ok(sound(10, { title: "whoosh_fast", provider: "freesound" }));
        if (url.pathname.startsWith("/api/sounds/") && method === "PATCH") return ok({ ...sounds[0], ...(body as object) });
        if (url.pathname === "/api/scenes/5/sounds" && method === "PUT") {
          return ok({ scene_id: 5, sfx: (body as { sound_id: number | null }).sound_id ? sounds[0] : null, music: null });
        }
        if (url.pathname === "/api/scenes/5/sounds") return ok({ scene_id: 5, sfx: null, music: null });
        if (url.pathname.endsWith("/suggestions")) return ok([sounds[1]]);
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

  it("formato de duración", () => {
    expect(formatSeconds(1.23)).toBe("1.2 s");
    expect(formatSeconds(75)).toBe("1:15");
    expect(formatSeconds(null)).toBe("—");
  });

  it("biblioteca: lista, filtro por etiqueta, escuchar, editar e importar", async () => {
    wrap(<SfxMusicPage />);
    expect(await screen.findByText("golpe seco")).toBeTruthy();
    expect(screen.getByText("2 escenas")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Escuchar golpe seco"));
    expect(screen.getByLabelText("Pausar golpe seco")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /impact 1/ }));
    await waitFor(() => expect(requests.some((r) => r.url.searchParams.get("tag") === "impact")).toBe(true));
    await waitFor(() => expect(screen.queryByText("sonido 2")).toBeNull());

    fireEvent.click(screen.getByText("golpe seco"));
    const detail = screen.getByLabelText("Detalle del sonido");
    const tags = within(detail).getByLabelText("Etiquetas");
    fireEvent.change(tags, { target: { value: "impact, golpe" } });
    fireEvent.blur(tags);
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")!.body).toEqual({ tags: ["impact", "golpe"] });

    const file = new File(["RIFF"], "golpe.wav", { type: "audio/wav" });
    fireEvent.change(screen.getByTestId("sound-files"), { target: { files: [file] } });
    await waitFor(() => expect(requests.some((r) => r.url.pathname === "/api/sounds:upload")).toBe(true));
    expect((requests.find((r) => r.url.pathname === "/api/sounds:upload")!.body as FormData).get("kind")).toBe("sfx");
  });

  it("Freesound: buscar y guardar", async () => {
    wrap(<SfxMusicPage />);
    fireEvent.click(await screen.findByText("Buscar en Freesound"));
    const panel = screen.getByLabelText("Freesound");
    fireEvent.change(within(panel).getByLabelText("Buscar en Freesound"), { target: { value: "whoosh" } });
    fireEvent.click(within(panel).getByRole("button", { name: /Buscar/ }));
    expect(await within(panel).findByText("whoosh_fast")).toBeTruthy();
    expect(within(panel).getByText(/sonidista · CC BY 4.0/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(requests.some((r) => r.url.pathname === "/api/freesound:save")).toBe(true));
    expect(requests.find((r) => r.url.pathname === "/api/freesound:save")!.body).toEqual({ result, kind: "sfx" });
  });

  it("escena: elegir efecto con sugerencias y quitarlo", async () => {
    wrap(<SceneSoundsBar sceneId={5} sfxCue="whoosh" musicCue={null} />);
    expect(await screen.findByText("Pide: whoosh")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Elegir")[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/La escena pide: «whoosh»/)).toBeTruthy();
    await within(dialog).findByText(/sonido 2/);
    fireEvent.click(within(dialog).getAllByText("Usar")[0]);
    await waitFor(() => expect(requests.some((r) => r.method === "PUT")).toBe(true));
    expect(requests.find((r) => r.method === "PUT")!.body).toEqual({ role: "sfx", sound_id: 2 });
    expect(await screen.findByText("golpe seco")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Quitar SFX"));
    await waitFor(() => expect(requests.filter((r) => r.method === "PUT")).toHaveLength(2));
  });
});
