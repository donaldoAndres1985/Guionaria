import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundAudio } from "@/lib/api";
import { attributionsText, parseAttribution } from "@/features/sounds/attribution";
import { UploadSoundDialog } from "@/features/sounds/UploadSoundDialog";
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
        if (url.pathname === "/api/sounds") return ok([{ id: 4, title: "Tranquility", favorite_channels: [] }, { id: 5, title: "Amazing Grace" }]);
        if (url.pathname === "/api/channels") return ok([{ id: 3, name: "Fe y esperanza" }]);
        if (url.pathname === "/api/sounds:upload") return ok([{ id: 9, title: "Tranquility" }]);
        if (url.pathname.endsWith(":favorite")) return ok({ id: 4, favorite_channels: [3] });
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
        <BackgroundAudioPanel projectId={7} channelId={3} />
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
  it("favorito del canal: la estrella lo guarda para este canal", async () => {
    renderPanel();
    fireEvent.click(await screen.findByLabelText("Marcar como favorito del canal"));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "POST", path: "/api/sounds/4:favorite", body: { channel_id: 3, favorite: true } }),
    );
  });

  it("subir con atribución: muestra los datos y los envía con el canal favorito", async () => {
    const onAdded = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <UploadSoundDialog open onClose={() => {}} kind="music" channelId={3} onAdded={onAdded} />
      </QueryClientProvider>,
    );
    const file = new File(["x"], "tranquility.mp3", { type: "audio/mpeg" });
    fireEvent.change(screen.getByLabelText("Archivo de audio"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Atribución del nuevo audio"), { target: { value: KEVIN } });
    const facts = screen.getByLabelText("Datos de la atribución");
    expect(facts.textContent).toContain("Kevin MacLeod");
    expect(facts.textContent).toContain("CC BY 4.0");
    fireEvent.click(screen.getByRole("button", { name: /Guardar en la biblioteca/ }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    const sent = calls.find((c) => c.path === "/api/sounds:upload")!.body as FormData;
    expect([sent.get("kind"), sent.get("attribution"), sent.get("favorite_channel")]).toEqual(["music", KEVIN, "3"]);
  });
});

describe("atribuciones", () => {
  it("lee el texto de la licencia y arma el bloque para copiar", () => {
    expect(parseAttribution(KEVIN)).toEqual({
      title: "Tranquility",
      author: "Kevin MacLeod",
      license: "CC BY 4.0",
      license_url: "http://creativecommons.org/licenses/by/4.0/",
    });
    expect(parseAttribution("«Amanecer» de Ana Ruiz — CC0")).toEqual({ title: "Amanecer", author: "Ana Ruiz", license: "Dominio público (CC0)" });
    const sounds = [{ attribution: KEVIN }, { attribution: null }, { attribution: "Otra" }] as never;
    expect(attributionsText(sounds)).toBe(`${KEVIN}\n\nOtra`);
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
