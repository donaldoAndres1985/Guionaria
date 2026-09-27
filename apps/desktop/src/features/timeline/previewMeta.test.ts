import { describe, expect, it } from "vitest";
import type { PreviewScene } from "@/lib/api";
import {
  captionAt,
  captionGroups,
  effectLook,
  formatClock,
  musicVolume,
  sceneIndexAt,
  sceneTextPx,
  subtitleFontPx,
} from "./previewMeta";
import { DEFAULT_STYLE } from "./RenderPanel";

const words = [
  { text: "Se", start: 0, end: 0.2 },
  { text: "lanzó", start: 0.2, end: 0.6 },
  { text: "del", start: 0.6, end: 0.8 },
  { text: "avión", start: 0.8, end: 1.2 },
  { text: "en", start: 1.2, end: 1.3 },
  { text: "paracaídas.", start: 1.3, end: 2 },
  { text: "Nunca", start: 2.4, end: 2.8 },
];

const scene = (position: number, start_s: number): PreviewScene => ({
  position, scene_id: position, kind: "image", start_s, duration_s: 1, media: null, effect: null, text: null,
});

describe("vista previa: cálculos", () => {
  it("frases iguales a las del render (3 palabras, corte en el punto)", () => {
    const groups = captionGroups(words, 3, 22);
    expect(groups.map((g) => g.map((w) => w.text))).toEqual([
      ["Se", "lanzó", "del"],
      ["avión", "en", "paracaídas."],
      ["Nunca"],
    ]);
  });

  it("frase visible y palabra que se dice", () => {
    const groups = captionGroups(words, 3, 22);
    expect(captionAt(groups, 0.3)).toMatchObject({ active: 1 });
    expect(captionAt(groups, 0.3)!.words[0].text).toBe("Se");
    // Hueco corto: la frase sigue hasta la siguiente (sin parpadeo).
    expect(captionAt(groups, 0.79)!.words[0].text).toBe("Se");
    expect(captionAt(groups, 2.2)).toBeNull(); // pausa larga tras el punto
    expect(captionAt(groups, 2.5)!.words[0].text).toBe("Nunca");
  });

  it("escena en cada instante", () => {
    const scenes = [scene(1, 0), scene(2, 1), scene(3, 2)];
    expect(sceneIndexAt(scenes, 0)).toBe(0);
    expect(sceneIndexAt(scenes, 1.5)).toBe(1);
    expect(sceneIndexAt(scenes, 9)).toBe(2);
    expect(sceneIndexAt([], 1)).toBe(-1);
  });

  it("efectos aproximados", () => {
    expect(effectLook("zoom_lento_in", 0.5, 0.15, 4).transform).toBe("scale(1.075)");
    expect(effectLook("zoom_lento_out", 1, 0.15, 4).transform).toBe("scale(1)");
    expect(effectLook("ken_burns", 0, 0.15, 4).transform).toMatch(/^scale\(1\.12\) translateX\(5\.3/);
    expect(effectLook("fundido_negro", 1, 0.15, 4).fade).toBeCloseTo(1);
    expect(effectLook("fundido_negro", 0.5, 0.15, 4).fade).toBe(0);
    expect(effectLook("camara_rapida", 0.5, 0.15, 4).playbackRate).toBe(2);
    expect(effectLook(null, 0.5, 0.15, 4).transform).toBe("none");
  });

  it("tamaños como en el render y ducking de la música", () => {
    expect(subtitleFontPx(DEFAULT_STYLE, 1080, 1920)).toBeCloseTo(1080 * 0.078);
    expect(subtitleFontPx({ ...DEFAULT_STYLE, size: "large" }, 1920, 1080)).toBeCloseTo(1080 * 0.062 * 1.25);
    expect(sceneTextPx(1080, 1920, false)).toBeCloseTo(1080 / 13);
    expect(musicVolume(0.35, words, 0.5)).toBeCloseTo(0.35 * 0.35);
    expect(musicVolume(0.35, words, 5)).toBe(0.35);
    expect(formatClock(75.25)).toBe("1:15.3");
  });
});
