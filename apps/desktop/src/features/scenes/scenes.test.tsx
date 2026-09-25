import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReorderScenes, useScenes, useUpdateScene } from "@/hooks/useScenes";
import type { Scene, ScenesState } from "@/lib/api";
import { EditableCell } from "./EditableCell";
import { ScenesTable } from "./ScenesTable";
import {
  filterScenes,
  formatSceneTime,
  isFirstOfSegment,
  kindCounts,
  missingQuery,
  needsReview,
} from "./sceneMeta";

const scene = (id: number, over: Partial<Scene> = {}): Scene => ({
  id,
  seg_key: "seg_001",
  position: id,
  start_s: 0,
  end_s: 1,
  timing_source: "estimated",
  narration: "Esto no es una película.",
  media_kind: "video",
  visual_description: "Toma aérea",
  query_en: "city aerial",
  query_alt: null,
  query_real: null,
  effect: "ninguno",
  on_screen_text: null,
  sfx: null,
  music_cue: null,
  status: "pending",
  approved_asset_id: null,
  segment_missing: false,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("utilidades de escenas", () => {
  const scenes = [
    scene(1),
    scene(2, { media_kind: "image" }),
    scene(3, { media_kind: "real", seg_key: "seg_002", query_real: null }),
    scene(4, { media_kind: "text", seg_key: "seg_002" }),
  ];

  it("cuenta y filtra por tipo", () => {
    expect(kindCounts(scenes)).toEqual({ all: 4, video: 1, image: 1, real: 1, text: 1, black: 0 });
    expect(filterScenes(scenes, "real").map((s) => s.id)).toEqual([3]);
    expect(filterScenes(scenes, "all")).toHaveLength(4);
  });

  it("formatea tiempos con décimas", () => {
    expect(formatSceneTime(3.75)).toBe("0:03.7");
    expect(formatSceneTime(65.2)).toBe("1:05.2");
    expect(formatSceneTime(null)).toBe("—");
  });

  it("detecta el primer segmento de cada grupo", () => {
    expect(scenes.map((_, i) => isFirstOfSegment(scenes, i))).toEqual([true, false, true, false]);
  });

  it("avisa de búsquedas faltantes según el tipo (sección 11.2)", () => {
    expect(missingQuery(scene(1, { query_en: null }))).toBe("Falta la búsqueda en inglés");
    expect(missingQuery(scene(1, { media_kind: "image", query_en: null }))).not.toBeNull();
    expect(missingQuery(scenes[2])).toBe("Falta la búsqueda de material real");
    expect(missingQuery(scene(1, { media_kind: "black", query_en: null }))).toBeNull();
  });

  it("por revisar: estado review o segmento eliminado", () => {
    expect(needsReview(scene(1, { status: "review" }))).toBe(true);
    expect(needsReview(scene(1, { segment_missing: true }))).toBe(true);
    expect(needsReview(scene(1))).toBe(false);
  });
});

describe("celda editable", () => {
  it("clic, escribir y Enter guarda el texto recortado", () => {
    const onCommit = vi.fn();
    render(<EditableCell label="SFX" value="whoosh" editable onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar SFX" }));
    const input = screen.getByRole("textbox", { name: "SFX" });
    fireEvent.change(input, { target: { value: "  static glitch  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("static glitch");
  });

  it("vaciar guarda null; sin cambios no guarda; Esc cancela", () => {
    const onCommit = vi.fn();
    render(<EditableCell label="SFX" value="whoosh" editable onCommit={onCommit} />);
    const open = () => fireEvent.click(screen.getByRole("button", { name: "Editar SFX" }));

    open();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();

    open();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "otro" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();

    open();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("varias líneas: Mayús+Enter no guarda, Enter sí", () => {
    const onCommit = vi.fn();
    render(<EditableCell label="Descripción" value="" editable multiline onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar Descripción" }));
    const area = screen.getByRole("textbox");
    fireEvent.change(area, { target: { value: "línea 1\nlínea 2" } });
    fireEvent.keyDown(area, { key: "Enter", shiftKey: true });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(area, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("línea 1\nlínea 2");
  });

  it("de solo lectura no abre el campo", () => {
    render(<EditableCell label="SFX" value={null} editable={false} onCommit={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("tabla de escenas", () => {
  const props = {
    reorderable: true,
    grouped: true,
    onUpdate: vi.fn(),
    onReorder: vi.fn(),
    onAction: vi.fn(),
  };

  it("agrupa la narración por segmento y marca escenas por revisar", () => {
    const scenes = [
      scene(1),
      scene(2, { status: "review" }),
      scene(3, { seg_key: "seg_009", segment_missing: true, narration: null }),
    ];
    render(<ScenesTable scenes={scenes} editable {...props} />);
    expect(screen.getAllByText("Esto no es una película.")).toHaveLength(1);
    expect(screen.getByText("↳ mismo segmento")).toBeTruthy();
    expect(screen.getByText("Segmento eliminado del guion")).toBeTruthy();
    expect(screen.getAllByText("Revisar")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Arrastrar para reordenar" })).toHaveLength(3);
  });

  it("marcar revisada y editar una celda llaman a sus acciones", () => {
    const onAction = vi.fn();
    const onUpdate = vi.fn();
    render(
      <ScenesTable
        scenes={[scene(7, { status: "review" })]}
        editable
        {...props}
        onAction={onAction}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByTitle("Marcar como revisada"));
    expect(onAction).toHaveBeenCalledWith(7, "reviewed");

    fireEvent.click(screen.getByRole("button", { name: "Editar Búsqueda EN" }));
    const input = screen.getByRole("textbox", { name: "Búsqueda EN" });
    fireEvent.change(input, { target: { value: "mexico city aerial" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onUpdate).toHaveBeenCalledWith(7, { query_en: "mexico city aerial" });
  });

  it("de solo lectura: sin arrastre, sin acciones y sin edición", () => {
    render(<ScenesTable scenes={[scene(1)]} editable={false} {...props} reorderable={false} />);
    expect(screen.queryByRole("button", { name: "Arrastrar para reordenar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Acciones de la escena" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
  });

  it("sin agrupar (filtro activo) muestra la narración en cada escena", () => {
    render(<ScenesTable scenes={[scene(1), scene(2)]} editable {...props} grouped={false} />);
    expect(screen.getAllByText("Esto no es una película.")).toHaveLength(2);
  });
});

describe("hooks de escenas", () => {
  let server: ScenesState;
  let fail = false;
  const requests: { method: string; path: string; body: unknown }[] = [];

  beforeEach(() => {
    fail = false;
    requests.length = 0;
    server = {
      project_id: 1,
      editable: true,
      approved: false,
      scenes: [scene(1), scene(2, { seg_key: "seg_002" }), scene(3, { seg_key: "seg_003" })],
      total_s: 3,
      review_count: 0,
      segments_without_scenes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ method, path, body });
        const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
        if (fail) return new Response(JSON.stringify({ detail: "rechazado" }), { status: 409 });
        if (method === "GET") return ok(server);
        if (method === "PATCH") {
          const id = Number(path.split("/").at(-1));
          const updated = { ...server.scenes.find((s) => s.id === id)!, ...body };
          server = { ...server, scenes: server.scenes.map((s) => (s.id === id ? updated : s)) };
          return ok(updated);
        }
        if (path.endsWith(":reorder")) {
          const byId = new Map(server.scenes.map((s) => [s.id, s]));
          server = {
            ...server,
            scenes: (body.scene_ids as number[]).map((id, i) => ({ ...byId.get(id)!, position: i + 1, start_s: i })),
          };
          return ok(server);
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
    return renderHook(
      () => ({ scenes: useScenes(1), update: useUpdateScene(1), reorder: useReorderScenes(1) }),
      { wrapper },
    );
  }

  it("editar una escena actualiza la tabla al instante y guarda en el núcleo", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.scenes.data).toBeTruthy());
    act(() => result.current.update.mutate({ id: 2, data: { sfx: "whoosh" } }));
    await waitFor(() =>
      expect(result.current.scenes.data!.scenes.find((s) => s.id === 2)!.sfx).toBe("whoosh"),
    );
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")).toEqual({
      method: "PATCH",
      path: "/api/scenes/2",
      body: { sfx: "whoosh" },
    });
  });

  it("si el núcleo rechaza la edición, la tabla vuelve a su valor", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.scenes.data).toBeTruthy());
    fail = true;
    act(() => result.current.update.mutate({ id: 2, data: { sfx: "whoosh" } }));
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(result.current.scenes.data!.scenes.find((s) => s.id === 2)!.sfx).toBeNull();
  });

  it("reordenar cambia el orden al instante y toma los tiempos del núcleo", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.scenes.data).toBeTruthy());
    act(() => result.current.reorder.mutate([3, 1, 2]));
    await waitFor(() =>
      expect(result.current.scenes.data!.scenes.map((s) => s.id)).toEqual([3, 1, 2]),
    );
    await waitFor(() => expect(result.current.reorder.isSuccess).toBe(true));
    expect(result.current.scenes.data!.scenes.map((s) => s.start_s)).toEqual([0, 1, 2]);
    expect(requests.find((r) => r.path.endsWith(":reorder"))!.body).toEqual({ scene_ids: [3, 1, 2] });
  });

  it("si el núcleo rechaza el orden, vuelve al anterior", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.scenes.data).toBeTruthy());
    fail = true;
    act(() => result.current.reorder.mutate([3, 2, 1]));
    await waitFor(() => expect(result.current.reorder.isError).toBe(true));
    expect(result.current.scenes.data!.scenes.map((s) => s.id)).toEqual([1, 2, 3]);
  });
});
