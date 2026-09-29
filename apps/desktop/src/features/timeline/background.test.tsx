import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundAudio } from "@/lib/api";
import { BackgroundAudioPanel } from "./BackgroundAudioPanel";
import { effectLook, presetLook, sceneEffect, zoomAmount } from "./previewMeta";

const KEVIN = '"Tranquility" Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/';

describe("audio de fondo en bucle", () => {
  let bg: BackgroundAudio;
  let calls: { method: string; path: string; body: unknown }[];

  beforeEach(() => {
    calls = [];
    bg = { sound_id: 4, volume: 35, title: "Tranquility", duration_s: 180, file_url: "/api/sounds/4/file", attribution: null, missing: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : init?.body;
        calls.push({ method, path: url.pathname, body });
        const ok = (d: unknown) => new Response(JSON.stringify(d));
        if (url.pathname === "/api/projects/7/background") {
          if (method === "PUT") bg = { ...bg, ...(body as object) };
          return ok(bg);
        }
        if (url.pathname === "/api/sounds") return ok([{ id: 4, title: "Tranquility" }, { id: 5, title: "Amazing Grace" }]);
        if (method === "PATCH") return ok({ id: 4, attribution: KEVIN });
        return ok([]);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const renderPanel = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BackgroundAudioPanel projectId={7} />
      </QueryClientProvider>,
    );

  it("volumen propio: se ajusta y se guarda", async () => {
    renderPanel();
    const slider = await screen.findByLabelText("Volumen del audio de fondo");
    expect(screen.getByText("35 %")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "80" } });
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(calls).toContainEqual({ method: "PUT", path: "/api/projects/7/background", body: { sound_id: 4, volume: 80 } }));
  });

  it("atribución: se guarda en el sonido; quitar el audio", async () => {
    renderPanel();
    const box = await screen.findByLabelText("Atribución del audio");
    fireEvent.change(box, { target: { value: KEVIN } });
    fireEvent.blur(box);
    await waitFor(() => expect(calls).toContainEqual({ method: "PATCH", path: "/api/sounds/4", body: { attribution: KEVIN } }));
    fireEvent.click(screen.getByLabelText("Quitar audio de fondo"));
    await waitFor(() => expect(calls).toContainEqual({ method: "PUT", path: "/api/projects/7/background", body: { sound_id: null, volume: 35 } }));
  });
});

describe("movimiento más fluido", () => {
  it("intensidad y efectos con aceleración suave", () => {
    expect(zoomAmount(3, 0.12, 1.5)).toBeCloseTo(0.135);
    // Deriva: arranca quieta (aceleración suave) y termina más cerca y desplazada.
    const start = effectLook("deriva_suave", 0, 0.12, 3, 1);
    const end = effectLook("deriva_suave", 1, 0.12, 3, 1);
    expect(start.transform).toMatch(/^scale\(1\.04\) translate\(/);
    expect(end.transform).toMatch(/^scale\(1\.157\) translate\(-?\d/);
    const divine = effectLook("zoom_divino", 0.5, 0.12, 3, 1.6);
    expect(divine.filter).toBe("brightness(1.06) saturate(1.08)");
    expect(divine.transform).toMatch(/^scale\(1\.108\)/);
    // El estilo «Celestial» usa el zoom celestial en las fotos sin efecto.
    const celestial = presetLook("celestial");
    expect([celestial.photo_effect, celestial.motion]).toEqual(["zoom_divino", 160]);
    expect(sceneEffect(null, "image", celestial)).toBe("zoom_divino");
  });
});
