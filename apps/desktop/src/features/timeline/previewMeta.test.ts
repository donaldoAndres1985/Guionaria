import { describe, expect, it } from "vitest";
import type { PreviewScene } from "@/lib/api";
import {
  captionAt,
  captionGroups,
  effectLook,
  formatClock,
  layoutText,
  lineChars,
  sceneIndexAt,
  sceneTextPx,
  SUBTITLE_PRESETS,
  subtitleFontPx,
  subtitleTextCss,
  lookCss,
  presetLook,
  sceneEffect,
  textLook,
  transitionLook,
  zoomAmount,
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
    // Zoom según la duración (como plan.zoom_amount): 3 %/s entre 4 % y el máximo.
    expect([zoomAmount(1, 0.12), zoomAmount(3, 0.12), zoomAmount(10, 0.12)]).toEqual([0.04, 0.09, 0.12]);
    expect(effectLook("zoom_lento_in", 0.5, 0.12, 3).transform).toBe("scale(1.045)");
    expect(effectLook("zoom_lento_out", 1, 0.12, 4).transform).toBe("scale(1)");
    expect(effectLook("ken_burns", 0, 0.12, 4).transform).toMatch(/^scale\(1\.08\) translateX\(3\.7/);
    expect(effectLook("fundido_negro", 1, 0.15, 4).fade).toBeCloseTo(1);
    expect(effectLook("fundido_negro", 0.5, 0.15, 4).fade).toBe(0);
    expect(effectLook("camara_rapida", 0.5, 0.15, 4).playbackRate).toBe(2);
    expect(effectLook(null, 0.5, 0.15, 4).transform).toBe("none");
  });

  it("texto en pantalla: mismas líneas y animaciones que el render", () => {
    const limit = lineChars(1080, sceneTextPx(1080, 1920, false));
    expect(limit).toBe(21);
    expect(layoutText("María Marta García Belsunce · 50 años · socióloga", limit)).toBe(
      "María Marta García Belsunce\n50 años · socióloga",
    );
    expect(layoutText("36 DÍAS", limit)).toBe("36 DÍAS");
    // Pop: empieza pequeño, rebota y queda a su tamaño; se desvanece al final.
    expect(textLook("pop", 0, 3, 10).scale).toBeCloseTo(0.6);
    expect(textLook("pop", 0.15, 3, 10).scale).toBeCloseTo(1.08);
    expect(textLook("pop", 1, 3, 10)).toEqual({ opacity: 1, scale: 1, rise: 0, chars: null });
    expect(textLook("pop", 2.95, 3, 10).opacity).toBeCloseTo(1 / 3);
    // Máquina de escribir: letra a letra durante el 40 % de la escena (máx. 1,2 s).
    expect(textLook("typewriter", 0, 3, 20).chars).toBe(1);
    expect(textLook("typewriter", 0.6, 3, 20).chars).toBe(11);
    expect(textLook("typewriter", 1.3, 3, 20).chars).toBeNull();
    expect(textLook("slide", 0, 3, 5).rise).toBeCloseTo(0.03);
    expect(textLook("fade", 0.15, 3, 5).opacity).toBeCloseTo(0.5);
  });

  it("transiciones: cómo se ven las dos escenas", () => {
    expect(transitionLook("fade", 0.25).incoming.opacity).toBe(0.25);
    // Fundido a negro: primero se oscurece la que sale, luego aparece la nueva.
    expect(transitionLook("fadeblack", 0.25)).toMatchObject({ incoming: { opacity: 0 }, overlay: { color: "#000", opacity: 0.5 } });
    expect(transitionLook("fadeblack", 0.75)).toMatchObject({ outgoing: { opacity: 0 }, overlay: { opacity: 0.5 } });
    expect(transitionLook("slideleft", 0.5)).toEqual({ incoming: { transform: "translateX(50%)" }, outgoing: { transform: "translateX(-50%)" } });
    expect(transitionLook("wipeleft", 0.25).incoming.clipPath).toBe("inset(0 0 0 75%)");
    expect(transitionLook("circleopen", 1).incoming.clipPath).toBe("circle(75% at 50% 50%)");
    expect(transitionLook("circleclose", 0.5).outgoingOnTop).toBe(true);
    expect(transitionLook("desconocida", 0.5).incoming.opacity).toBe(0.5); // como un fundido
  });

  it("look del video: CSS aproximado, estilos rápidos y zoom en fotos", () => {
    const neutral = lookCss(presetLook("none"));
    expect(neutral).toEqual({ filter: "none", tint: null, vignette: 0, grain: 0, photoBlur: 0 });
    const crimen = presetLook("crimen");
    expect(crimen).toMatchObject({ preset: "crimen", saturation: 40, temperature: -80, zoom_photos: true, lut: null });
    const css = lookCss(crimen);
    expect(css.filter).toBe("saturate(0.4) contrast(1.35) brightness(0.85)");
    expect(css.tint?.color).toBe("rgb(0, 110, 160)");
    expect(css.tint?.opacity).toBeCloseTo(0.28);
    expect([css.vignette, css.grain]).toEqual([0.75, 0.4]);
    expect(css.photoBlur).toBeCloseTo(0.45);
    expect(lookCss({ ...crimen, temperature: 50 }).tint?.color).toBe("rgb(255, 140, 20)");
    // Zoom lento en las fotos sin efecto (como el render); el efecto elegido se respeta.
    expect(sceneEffect(null, "image", crimen)).toBe("zoom_lento_in");
    expect(sceneEffect("ninguno", "image", crimen)).toBe("zoom_lento_in");
    expect(sceneEffect("ken_burns", "image", crimen)).toBe("ken_burns");
    expect(sceneEffect(null, "video", crimen)).toBeNull();
    expect(sceneEffect(null, "image", presetLook("none"))).toBeNull();
  });

  it("tamaños como en el render", () => {
    expect(subtitleFontPx(DEFAULT_STYLE, 1080, 1920)).toBeCloseTo(1080 * 0.078);
    expect(subtitleFontPx({ ...DEFAULT_STYLE, size: "large" }, 1920, 1080)).toBeCloseTo(1080 * 0.062 * 1.25);
    expect(sceneTextPx(1080, 1920, false)).toBe(83); // como captions.scene_text_size
    expect(sceneTextPx(1080, 1920, true, "large")).toBe(118);
    expect(formatClock(75.25)).toBe("1:15.3");
  });

  it("CSS del texto: cursiva, sombra suave o borde, como en el render", () => {
    const reel = { ...DEFAULT_STYLE, ...SUBTITLE_PRESETS.find((p) => p.id === "reel")!.style };
    const css = subtitleTextCss(reel, 1);
    expect(css.fontFamily).toContain("Montserrat");
    expect(css.fontStyle).toBe("italic");
    expect(css.fontWeight).toBe(800);
    expect(css.textShadow).toContain("rgba(0,0,0,0.75)");
    const classic = subtitleTextCss(DEFAULT_STYLE, 1);
    expect(classic.textShadow).toBeUndefined();
    expect(classic.WebkitTextStroke).toBe("8px #000000");
    expect(subtitleTextCss({ ...DEFAULT_STYLE, background: true }, 1).WebkitTextStroke).toBeUndefined();
  });
});
