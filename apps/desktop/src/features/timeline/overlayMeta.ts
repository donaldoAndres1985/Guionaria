/**
 * Textos de las pistas propias (como CapCut). Mismos cálculos que el ASS del render
 * (services/render/captions.py: wrap_overlay, overlay_chars, overlay_timing y las animaciones),
 * para que la vista previa y el editor muestren lo que saldrá en el video.
 */
import type { CSSProperties } from "react";
import type { TextAnimationIn, TextAnimationOut, TextFont, TextOverlayStyle } from "@/lib/api";

export const DEFAULT_TEXT_OVERLAY: TextOverlayStyle = {
  font: "Montserrat",
  size: 72,
  color: "#FFFFFF",
  bold: true,
  italic: false,
  underline: false,
  uppercase: false,
  align: "center",
  letter_spacing: 0,
  max_width: 90,
  x: 0.5,
  y: 0.5,
  rotation: 0,
  opacity: 100,
  outline: true,
  outline_color: "#000000",
  outline_width: 4,
  shadow: false,
  shadow_color: "#000000",
  shadow_opacity: 60,
  shadow_distance: 4,
  shadow_blur: 4,
  background: false,
  background_color: "#000000",
  background_opacity: 70,
  background_padding: 16,
  animation_in: "fade",
  animation_out: "fade",
  animation_s: 0.4,
};

export const TEXT_FONTS: { id: TextFont; family: string }[] = [
  { id: "Montserrat", family: '"Montserrat", sans-serif' },
  { id: "Arial", family: "Arial, sans-serif" },
  { id: "Impact", family: "Impact, sans-serif" },
  { id: "Bahnschrift", family: "Bahnschrift, sans-serif" },
  { id: "Segoe UI", family: '"Segoe UI", sans-serif' },
  { id: "Verdana", family: "Verdana, sans-serif" },
  { id: "Tahoma", family: "Tahoma, sans-serif" },
  { id: "Trebuchet MS", family: '"Trebuchet MS", sans-serif' },
  { id: "Georgia", family: "Georgia, serif" },
  { id: "Times New Roman", family: '"Times New Roman", serif' },
  { id: "Courier New", family: '"Courier New", monospace' },
  { id: "Comic Sans MS", family: '"Comic Sans MS", cursive' },
];

export const fontFamily = (font: TextFont) => TEXT_FONTS.find((f) => f.id === font)?.family ?? font;

export const ANIMATIONS_IN: { id: TextAnimationIn; label: string }[] = [
  { id: "none", label: "Ninguna" },
  { id: "fade", label: "Aparecer" },
  { id: "pop", label: "Rebote" },
  { id: "zoom", label: "Acercar" },
  { id: "slide_up", label: "Subir" },
  { id: "slide_down", label: "Bajar" },
  { id: "slide_left", label: "Desde la derecha" },
  { id: "slide_right", label: "Desde la izquierda" },
  { id: "blur", label: "Enfocar" },
  { id: "typewriter", label: "Máquina de escribir" },
];

export const ANIMATIONS_OUT: { id: TextAnimationOut; label: string }[] = [
  { id: "none", label: "Ninguna" },
  { id: "fade", label: "Desvanecer" },
  { id: "pop", label: "Encoger" },
  { id: "zoom", label: "Alejar" },
  { id: "slide_up", label: "Subir" },
  { id: "slide_down", label: "Bajar" },
  { id: "slide_left", label: "Hacia la izquierda" },
  { id: "slide_right", label: "Hacia la derecha" },
  { id: "blur", label: "Desenfocar" },
];

/** Estilos rápidos (plantillas como las de CapCut): se aplican y después se retocan. */
export const TEXT_PRESETS: { id: string; label: string; sample: string; style: Partial<TextOverlayStyle> }[] = [
  {
    id: "impacto",
    label: "Título impacto",
    sample: "IMPACTO",
    style: { font: "Impact", size: 120, uppercase: true, color: "#FFFFFF", outline: true, outline_width: 6, shadow: true, shadow_distance: 6, shadow_blur: 8, background: false, animation_in: "pop", animation_out: "fade" },
  },
  {
    id: "amarillo",
    label: "Amarillo reel",
    sample: "Amarillo",
    style: { font: "Montserrat", size: 80, color: "#FFD400", outline: true, outline_width: 5, shadow: false, background: false, italic: true, animation_in: "pop", animation_out: "fade" },
  },
  {
    id: "caja",
    label: "Caja negra",
    sample: "Caja negra",
    style: { font: "Arial", size: 60, color: "#FFFFFF", background: true, background_color: "#000000", background_opacity: 75, background_padding: 18, outline: false, shadow: false, animation_in: "slide_up", animation_out: "slide_down" },
  },
  {
    id: "etiqueta",
    label: "Etiqueta roja",
    sample: "ÚLTIMA HORA",
    style: { font: "Bahnschrift", size: 54, color: "#FFFFFF", uppercase: true, letter_spacing: 2, background: true, background_color: "#D32F2F", background_opacity: 100, background_padding: 14, outline: false, shadow: false, animation_in: "slide_right", animation_out: "slide_left" },
  },
  {
    id: "cita",
    label: "Cita",
    sample: "«Una cita»",
    style: { font: "Georgia", size: 64, color: "#FFFFFF", italic: true, outline: false, shadow: true, shadow_distance: 3, shadow_blur: 12, shadow_opacity: 80, background: false, animation_in: "fade", animation_out: "fade", animation_s: 0.8 },
  },
  {
    id: "maquina",
    label: "Máquina de escribir",
    sample: "Expediente",
    style: { font: "Courier New", size: 58, color: "#EDEDED", bold: true, outline: true, outline_width: 3, shadow: false, background: false, animation_in: "typewriter", animation_out: "fade" },
  },
  {
    id: "neon",
    label: "Neón",
    sample: "Neón",
    style: { font: "Montserrat", size: 88, color: "#39FF14", outline: false, shadow: true, shadow_color: "#39FF14", shadow_distance: 0, shadow_blur: 24, shadow_opacity: 90, background: false, animation_in: "zoom", animation_out: "blur" },
  },
  {
    id: "dato",
    label: "Dato / fecha",
    sample: "11 · DIC · 2007",
    style: { font: "Montserrat", size: 46, color: "#FFFFFF", uppercase: true, letter_spacing: 6, align: "left", x: 0.06, y: 0.1, background: true, background_color: "#000000", background_opacity: 55, background_padding: 12, outline: false, shadow: false, animation_in: "slide_right", animation_out: "fade" },
  },
  {
    id: "minimal",
    label: "Minimal",
    sample: "Minimal",
    style: { font: "Segoe UI", size: 56, color: "#FFFFFF", bold: false, outline: false, shadow: true, shadow_distance: 2, shadow_blur: 6, shadow_opacity: 70, background: false, animation_in: "fade", animation_out: "fade" },
  },
];

/** Posiciones rápidas (cuadrícula de 3 × 3): anclaje y alineación. */
export const POSITIONS: { label: string; x: number; y: number; align: TextOverlayStyle["align"] }[] = [
  { label: "Arriba izquierda", x: 0.06, y: 0.12, align: "left" },
  { label: "Arriba", x: 0.5, y: 0.12, align: "center" },
  { label: "Arriba derecha", x: 0.94, y: 0.12, align: "right" },
  { label: "Izquierda", x: 0.06, y: 0.5, align: "left" },
  { label: "Centro", x: 0.5, y: 0.5, align: "center" },
  { label: "Derecha", x: 0.94, y: 0.5, align: "right" },
  { label: "Abajo izquierda", x: 0.06, y: 0.84, align: "left" },
  { label: "Abajo", x: 0.5, y: 0.84, align: "center" },
  { label: "Abajo derecha", x: 0.94, y: 0.84, align: "right" },
];

// --- líneas (como captions.overlay_chars y wrap_overlay) ---

export const OVERLAY_CHAR = 0.56;
export const OVERLAY_SHIFT = 0.08;
export const OVERLAY_BLUR = 20;

export function overlayChars(width: number, size: number, maxWidth: number, spacing: number): number {
  return Math.max(4, Math.floor((width * maxWidth) / 100 / (OVERLAY_CHAR * size + spacing)));
}

export function wrapOverlay(text: string, limit: number): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = "";
    for (const word of raw.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= limit) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  while (out.length && !out[0]) out.shift();
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/** Líneas del texto tal como se dibujan (mayúsculas y cortes incluidos). */
export function overlayLines(text: string, style: TextOverlayStyle, width: number): string[] {
  const shown = style.uppercase ? text.toUpperCase() : text;
  return wrapOverlay(shown, overlayChars(width, style.size, style.max_width, style.letter_spacing));
}

// --- animaciones (como captions._overlay_events) ---

export function overlayTiming(style: TextOverlayStyle, duration: number, plainLength: number): { a: number; b: number } {
  const half = duration / 2;
  let a = style.animation_in === "none" ? 0 : Math.min(style.animation_s, half);
  if (style.animation_in === "typewriter") a = Math.min(Math.max(style.animation_s, 0.03 * plainLength), duration * 0.7);
  const b = style.animation_out === "none" ? 0 : Math.min(style.animation_s, half);
  return { a, b: Math.min(b, Math.max(duration - a, 0)) };
}

export interface OverlayLook {
  opacity: number;
  scale: number;
  /** Desplazamiento (px del proyecto) y desenfoque extra (px del proyecto). */
  dx: number;
  dy: number;
  blur: number;
  /** Caracteres visibles (máquina de escribir); null = todos. */
  chars: number | null;
}

const SHIFTS: Record<string, [number, number]> = {
  slide_up: [0, 1],
  slide_down: [0, -1],
  slide_left: [1, 0],
  slide_right: [-1, 0],
};

/** Cómo se ve el texto `local` segundos después de empezar (dura `duration`). */
export function overlayLook(
  style: TextOverlayStyle,
  local: number,
  duration: number,
  plainLength: number,
  width: number,
  height: number,
): OverlayLook {
  const look: OverlayLook = { opacity: 1, scale: 1, dx: 0, dy: 0, blur: 0, chars: null };
  const { a, b } = overlayTiming(style, duration, plainLength);
  const shift = (kind: string, amount: number) => {
    const [sx, sy] = SHIFTS[kind];
    look.dx = sx * Math.round(width * OVERLAY_SHIFT) * amount;
    look.dy = sy * Math.round(height * OVERLAY_SHIFT) * amount;
  };
  if (a > 0 && local < a) {
    const t = Math.max(local / a, 0);
    const kind = style.animation_in;
    if (kind === "typewriter") {
      const steps = Math.min(30, plainLength);
      const k = Math.min(Math.floor(t * steps) + 1, steps);
      look.chars = k >= steps ? null : Math.round((plainLength * k) / steps);
    } else if (kind in SHIFTS) {
      shift(kind, 1 - t);
      look.opacity = Math.min(t / 0.7, 1);
    } else if (kind === "pop") {
      const k = 0.55;
      look.scale = t < k ? 0.6 + 0.48 * (t / k) : 1.08 - 0.08 * ((t - k) / (1 - k));
      look.opacity = Math.min(local / Math.min(0.09, a), 1);
    } else if (kind === "zoom") {
      look.scale = 0.2 + 0.8 * Math.sqrt(t);
      look.opacity = Math.min(t / 0.6, 1);
    } else if (kind === "blur") {
      look.blur = OVERLAY_BLUR * (1 - t);
      look.opacity = Math.min(t / 0.5, 1);
    } else look.opacity = t; // fade
    return look;
  }
  if (b > 0 && local > duration - b) {
    const u = Math.min((local - (duration - b)) / b, 1);
    const kind = style.animation_out;
    if (kind in SHIFTS) {
      shift(kind, -u);
      look.opacity = 1 - Math.max(0, (u - 0.3) / 0.7);
      return look;
    }
    look.opacity = 1 - u;
    if (kind === "pop") look.scale = 1 - 0.4 * u;
    else if (kind === "zoom") look.scale = 1 - 0.8 * u * u;
    else if (kind === "blur") look.blur = OVERLAY_BLUR * u;
  }
  return look;
}

// --- aspecto en CSS (como los tags del ASS) ---

const rgba = (hex: string, alpha: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 1000) / 1000})`;
};

/** Estilo del texto; `scale` pasa de px del proyecto a px de pantalla. */
export function overlayTextCss(style: TextOverlayStyle, scale: number): CSSProperties {
  const px = (v: number) => `${Math.max(v * scale, 0)}px`;
  const css: CSSProperties = {
    fontFamily: fontFamily(style.font),
    fontWeight: style.font === "Montserrat" ? 800 : style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    textDecoration: style.underline ? "underline" : undefined,
    fontSize: px(style.size),
    lineHeight: 1.2,
    letterSpacing: px(style.letter_spacing),
    color: style.color,
    textAlign: style.align,
    whiteSpace: "pre",
  };
  if (style.background) {
    const pad = px(style.background_padding);
    return {
      ...css,
      background: rgba(style.background_color, style.background_opacity / 100),
      padding: `0 ${pad}`,
      boxDecorationBreak: "clone",
      WebkitBoxDecorationBreak: "clone",
    };
  }
  if (style.outline && style.outline_width > 0) {
    // El trazo de CSS va por la mitad del borde de la letra: el doble iguala al \bord del ASS.
    css.WebkitTextStroke = `${px(style.outline_width * 2)} ${style.outline_color}`;
    css.paintOrder = "stroke fill";
  }
  if (style.shadow) {
    const d = px(style.shadow_distance);
    css.textShadow = `${d} ${d} ${px(style.shadow_blur)} ${rgba(style.shadow_color, style.shadow_opacity / 100)}`;
  }
  return css;
}

/** Posición del bloque de texto: su punto de anclaje en (x, y), con giro y animación. */
export function overlayBoxCss(style: TextOverlayStyle, look: OverlayLook, scale: number): CSSProperties {
  const anchor = style.align === "left" ? 0 : style.align === "right" ? 100 : 50;
  return {
    position: "absolute",
    left: `${style.x * 100}%`,
    top: `${style.y * 100}%`,
    transformOrigin: `${anchor}% 50%`,
    transform: `translate(${-anchor}%, -50%) translate(${look.dx * scale}px, ${look.dy * scale}px) rotate(${style.rotation}deg) scale(${look.scale})`,
    opacity: (style.opacity / 100) * look.opacity,
    filter: look.blur > 0 ? `blur(${look.blur * scale * 0.5}px)` : undefined,
  };
}
