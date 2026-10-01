import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_OVERLAY,
  overlayBoxCss,
  overlayChars,
  overlayLines,
  overlayLook,
  overlayTextCss,
  overlayTiming,
  wrapOverlay,
} from "./overlayMeta";
import { effectLook } from "./previewMeta";
import { fadeGain } from "./PreviewPlayer";

const style = (over = {}) => ({ ...DEFAULT_TEXT_OVERLAY, ...over });

describe("textos de las pistas propias (igual que el ASS del render)", () => {
  it("parte las líneas como captions.wrap_overlay y overlay_chars", () => {
    expect(wrapOverlay("uno dos tres cuatro", 9)).toEqual(["uno dos", "tres", "cuatro"]);
    expect(wrapOverlay("línea uno\n\nlínea dos\n", 40)).toEqual(["línea uno", "", "línea dos"]);
    expect(overlayChars(1080, 72, 90, 0)).toBe(24);
    expect(overlayChars(1080, 72, 90, 10)).toBe(19);
    expect(overlayLines("hola mundo", style({ uppercase: true }), 1080)).toEqual(["HOLA MUNDO"]);
  });

  it("tiempos de entrada y salida (la máquina de escribir depende del largo)", () => {
    expect(overlayTiming(style({ animation_s: 0.5 }), 2, 10)).toEqual({ a: 0.5, b: 0.5 });
    expect(overlayTiming(style({ animation_s: 2 }), 2, 10)).toEqual({ a: 1, b: 1 });
    expect(overlayTiming(style({ animation_in: "none", animation_out: "none" }), 2, 10)).toEqual({ a: 0, b: 0 });
    const typed = overlayTiming(style({ animation_in: "typewriter", animation_s: 0.4 }), 4, 50);
    expect(typed.a).toBeCloseTo(1.5);
    expect(typed.b).toBe(0.4);
  });

  it("animaciones de entrada", () => {
    const fade = overlayLook(style({ animation_in: "fade", animation_s: 0.4 }), 0.2, 3, 5, 1080, 1920);
    expect(fade.opacity).toBeCloseTo(0.5);
    const pop = overlayLook(style({ animation_in: "pop", animation_s: 0.4 }), 0, 3, 5, 1080, 1920);
    expect(pop.scale).toBeCloseTo(0.6);
    const up = overlayLook(style({ animation_in: "slide_up", animation_s: 0.5 }), 0, 3, 5, 1080, 1920);
    expect(up.dy).toBe(154); // entra desde abajo: 8 % del alto
    const left = overlayLook(style({ animation_in: "slide_left", animation_s: 0.5 }), 0.25, 3, 5, 1080, 1920);
    expect(left.dx).toBeCloseTo(43); // a mitad de camino desde la derecha
    const blur = overlayLook(style({ animation_in: "blur", animation_s: 0.4 }), 0, 3, 5, 1080, 1920);
    expect(blur.blur).toBe(20);
    const typed = overlayLook(style({ animation_in: "typewriter", animation_s: 0.3 }), 0.01, 4, 10, 1080, 1920);
    expect(typed.chars).toBe(1);
    const still = overlayLook(style(), 1.5, 3, 5, 1080, 1920);
    expect(still).toEqual({ opacity: 1, scale: 1, dx: 0, dy: 0, blur: 0, chars: null });
  });

  it("animaciones de salida", () => {
    const out = overlayLook(style({ animation_out: "zoom", animation_s: 0.5 }), 2.75, 3, 5, 1080, 1920);
    expect(out.scale).toBeCloseTo(1 - 0.8 * 0.25);
    expect(out.opacity).toBeCloseTo(0.5);
    const slide = overlayLook(style({ animation_out: "slide_up", animation_s: 0.5 }), 2.6, 3, 5, 1080, 1920);
    expect(slide.dy).toBeLessThan(0); // sale hacia arriba
    expect(slide.opacity).toBe(1); // el fundido empieza al 30 % de la salida
  });

  it("aspecto: borde (doble en CSS), sombra, caja y anclaje", () => {
    const css = overlayTextCss(style({ outline_width: 4, shadow: true, shadow_distance: 3, shadow_blur: 6 }), 0.5);
    expect(css.WebkitTextStroke).toBe("4px #000000");
    expect(css.textShadow).toBe("1.5px 1.5px 3px rgba(0, 0, 0, 0.6)");
    const boxed = overlayTextCss(style({ background: true, background_color: "#FF0000", background_opacity: 50 }), 1);
    expect(boxed.background).toBe("rgba(255, 0, 0, 0.5)");
    expect(boxed.WebkitTextStroke).toBeUndefined();
    const pos = overlayBoxCss(style({ align: "left", x: 0.1, y: 0.2, rotation: 15 }), { opacity: 1, scale: 1, dx: 0, dy: 0, blur: 0, chars: null }, 1);
    expect(pos.left).toBe("10%");
    expect(pos.transformOrigin).toBe("0% 50%");
    expect(String(pos.transform)).toContain("rotate(15deg)");
  });
});

describe("efectos nuevos en la vista previa", () => {
  it("color, viñeta, franjas, fundido de entrada, destello y velocidad", () => {
    expect(effectLook("blanco_negro", 0.5, 0.12, 3).filter).toBe("grayscale(1)");
    expect(effectLook("vineta", 0.5, 0.12, 3).vignette).toBe(0.6);
    expect(effectLook("cinematico", 0.5, 0.12, 3).bars).toBe(0.11);
    expect(effectLook("fundido_entrada", 0, 0.12, 3).fade).toBe(1);
    expect(effectLook("fundido_entrada", 0.5, 0.12, 3).fade).toBe(0);
    expect(effectLook("destello", 0, 0.12, 3).flash).toBe(1);
    expect(effectLook("camara_lenta", 0.5, 0.12, 3).playbackRate).toBe(0.5);
  });

  it("movimientos: paneos, golpe de zoom y cámara en mano", () => {
    expect(effectLook("paneo_izquierda", 0, 0.12, 3).transform).toContain("translateX(-3.7037%)");
    expect(effectLook("paneo_vertical", 1, 0.12, 3).transform).toContain("translateY(3.7037%)");
    expect(effectLook("zoom_rapido", 1, 0.12, 3).transform).toBe("scale(1.16)");
    expect(effectLook("zoom_rapido", 0, 0.12, 3).transform).toBe("scale(1)");
    expect(effectLook("temblor", 0.3, 0.12, 3).transform).toMatch(/^scale\(1\.06\) translate\(/);
  });

  it("fundidos de los SFX como los afade del render", () => {
    expect(fadeGain(0.05, 1, 0.1, 0)).toBeCloseTo(0.5);
    expect(fadeGain(0.95, 1, 0, 0.2)).toBeCloseTo(0.25);
    expect(fadeGain(0.5, 1, 0.1, 0.2)).toBe(1);
  });
});
