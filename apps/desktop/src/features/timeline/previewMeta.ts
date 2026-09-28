/**
 * Cálculos de la vista previa en vivo. Replican los del render (services/render/plan.py y
 * captions.py) para que lo que se ve se parezca lo más posible al MP4 final.
 */
import type { PreviewScene, PreviewWord, SubtitleStyle, TextStyle } from "@/lib/api";

/** Escena que se ve en el instante t (la última si t está al final). */
export function sceneIndexAt(scenes: PreviewScene[], t: number): number {
  if (!scenes.length) return -1;
  for (let i = scenes.length - 1; i >= 0; i--) {
    if (t >= scenes[i].start_s - 1e-6) return i;
  }
  return 0;
}

// --- subtítulos (igual que captions.group_words) ---

const STRONG_PAUSE = [".", "?", "!", "…", ":", ";"];
const GAP_JOIN_S = 0.35;

export function captionGroups(words: PreviewWord[], perLine: number, maxChars: number): PreviewWord[][] {
  const groups: PreviewWord[][] = [];
  let current: PreviewWord[] = [];
  for (const word of words) {
    if (!word.text.trim()) continue;
    if (current.length) {
      const text = [...current, word].map((w) => w.text).join(" ");
      const pause = word.start - current[current.length - 1].end > 0.6;
      if (current.length >= perLine || text.length > maxChars || pause) {
        groups.push(current);
        current = [];
      }
    }
    current.push(word);
    if (STRONG_PAUSE.some((p) => word.text.trimEnd().endsWith(p))) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

export function captionLayout(style: SubtitleStyle, portrait: boolean) {
  return {
    perLine: style.words_per_line || (portrait ? 3 : 6),
    maxChars: portrait ? 18 : 42,
  };
}

/** Frase visible en t y la palabra que se está diciendo (índice), o null. */
export function captionAt(groups: PreviewWord[][], t: number): { words: PreviewWord[]; active: number } | null {
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    let end = g[g.length - 1].end;
    const next = groups[i + 1];
    if (next && next[0].start - end < GAP_JOIN_S) end = next[0].start;
    if (t >= g[0].start && t < end) {
      let active = 0;
      for (let j = 0; j < g.length; j++) if (t >= g[j].start) active = j;
      return { words: g, active };
    }
  }
  return null;
}

export const SUBTITLE_SIZE = { small: 0.8, medium: 1, large: 1.25 } as const;

/** Aspecto del texto de los subtítulos en CSS (fuente, cursiva, borde o sombra), como en el ASS. */
export function subtitleTextCss(style: SubtitleStyle, scale: number): React.CSSProperties {
  const edge = style.edge ?? "outline";
  const css: React.CSSProperties = {
    fontFamily: style.font === "Montserrat" ? '"Montserrat", sans-serif' : style.font,
    fontWeight: style.font === "Montserrat" ? 800 : 700,
    fontStyle: style.italic ? "italic" : "normal",
    color: style.text_color,
    paintOrder: "stroke fill",
  };
  if (style.background) return css;
  const px = (v: number) => `${Math.max(v * scale, 1)}px`;
  if (edge === "outline" || edge === "both") css.WebkitTextStroke = `${px(edge === "both" ? 6 : 8)} ${style.outline_color}`;
  if (edge === "shadow") css.WebkitTextStroke = `${px(2)} ${style.outline_color}`;
  if (edge === "shadow" || edge === "both") css.textShadow = `0 ${px(6)} ${px(8)} rgba(0,0,0,0.75)`;
  return css;
}

/** Tamaño de letra de los subtítulos en px del cuadro de salida (como en captions.build_ass). */
export function subtitleFontPx(style: SubtitleStyle, width: number, height: number): number {
  const portrait = height > width;
  const base = portrait ? width * 0.078 : height * 0.062;
  return base * SUBTITLE_SIZE[style.size];
}

// --- texto en pantalla (como captions.scene_text_size, layout_text y _text_events) ---

const TEXT_SIZE: Record<TextStyle["size"], number> = { small: 0.8, medium: 1, large: 1.2 };
/** Margen lateral del texto (fracción del ancho), el mismo del render. */
export const TEXT_MARGIN = 0.05;

/** Tamaño del texto en pantalla, en píxeles del video. */
export function sceneTextPx(width: number, height: number, centered: boolean, size: TextStyle["size"] = "medium"): number {
  const base = height < width ? height / (centered ? 11 : 16) : width / (centered ? 11 : 13);
  return Math.round(base * TEXT_SIZE[size]);
}

/** Caracteres que caben en una línea (ancho medio de un carácter en negrita ≈ 0,56 del tamaño). */
export function lineChars(width: number, px: number): number {
  return Math.max(10, Math.round((width * (1 - 2 * TEXT_MARGIN)) / (0.56 * px)));
}

const SEPARATOR = /\s+[·|•–—]\s+/;

/** Corta en los separadores («Nombre · 50 años · socióloga») las líneas que no caben. */
export function layoutText(text: string, limit: number): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const parts = line.split(SEPARATOR);
    if (line.length <= limit || parts.length === 1) {
      out.push(line);
      continue;
    }
    const seps = line.match(new RegExp(SEPARATOR.source, "g")) ?? [];
    let current = parts[0];
    parts.slice(1).forEach((part, i) => {
      if (current.length + seps[i].length + part.length <= limit) current += seps[i] + part;
      else {
        out.push(current);
        current = part;
      }
    });
    out.push(current);
  }
  return out.filter(Boolean).join("\n");
}

/** Centro vertical del texto (fracción del alto): arriba si hay subtítulos quemados. */
export function textTop(centered: boolean, raised: boolean): number {
  if (centered) return raised ? 0.42 : 0.5; // con subtítulos, más arriba para no pisarlos
  return raised ? 0.16 : 0.78;
}

export interface TextLook {
  opacity: number;
  /** Escala (pop) y desplazamiento vertical en fracción del alto (deslizar). */
  scale: number;
  rise: number;
  /** Caracteres visibles (máquina de escribir); null = todos. */
  chars: number | null;
}

const ease = (x: number) => 1 - (1 - x) ** 3;

/** Animación de entrada del texto, `local` segundos después de que empieza la escena. */
export function textLook(animation: TextStyle["animation"], local: number, duration: number, length: number): TextLook {
  const look: TextLook = { opacity: 1, scale: 1, rise: 0, chars: null };
  const outMs = Math.min(150, duration * 250) / 1000;
  const left = duration - local;
  const fadeOut = (inS: number) => (left < outMs ? Math.max(left / outMs, 0) : Math.min(local / inS, 1));
  if (animation === "fade") look.opacity = fadeOut(0.3);
  else if (animation === "pop") {
    look.opacity = fadeOut(0.09);
    const ms = local * 1000;
    look.scale = ms < 150 ? 0.6 + 0.48 * (ms / 150) : ms < 260 ? 1.08 - 0.08 * ((ms - 150) / 110) : 1;
  } else if (animation === "slide") {
    look.opacity = fadeOut(0.22);
    look.rise = 0.03 * (1 - ease(Math.min(local / 0.3, 1)));
  } else if (animation === "typewriter") {
    const reveal = Math.min(1.2, Math.max(0.4, duration * 0.4));
    const steps = Math.min(30, length);
    const k = Math.min(Math.floor((local / reveal) * steps) + 1, steps);
    look.chars = k >= steps ? null : Math.round((length * k) / steps);
    if (left < outMs) look.opacity = Math.max(left / outMs, 0);
  }
  return look;
}

// --- efectos (aproximación de plan.effect_filter) ---

export interface EffectLook {
  transform: string;
  filter?: string;
  /** Opacidad del velo negro (fundido al final). */
  fade: number;
  playbackRate: number;
}

/** Cuánto se acerca el zoom lento (como plan.zoom_amount): 3 %/s, entre 4 % y el máximo. */
export function zoomAmount(duration: number, max: number): number {
  return Math.round(Math.min(max, Math.max(0.04, 0.03 * duration)) * 10000) / 10000;
}

const KEN_BURNS = 1.08;

export function effectLook(effect: string | null, progress: number, zoom: number, sceneDuration: number): EffectLook {
  const p = Math.min(Math.max(progress, 0), 1);
  const look: EffectLook = { transform: "none", fade: 0, playbackRate: 1 };
  const r = (v: number) => Math.round(v * 10000) / 10000;
  const amount = zoomAmount(sceneDuration, zoom);
  if (effect === "zoom_lento_in") look.transform = `scale(${r(1 + amount * p)})`;
  else if (effect === "zoom_lento_out") look.transform = `scale(${r(1 + amount - amount * p)})`;
  else if (effect === "ken_burns") {
    const pan = ((1 - 1 / KEN_BURNS) / 2) * 100; // % que se desplaza hacia cada lado
    look.transform = `scale(${KEN_BURNS}) translateX(${r(pan - 2 * pan * p)}%)`;
  } else if (effect === "estatica") look.filter = "saturate(0.6) contrast(1.1)";
  else if (effect === "glitch") look.filter = "hue-rotate(8deg) saturate(1.3)";
  else if (effect === "fundido_negro") {
    const left = (1 - p) * sceneDuration;
    look.fade = left < 0.6 ? 1 - left / 0.6 : 0;
  } else if (effect === "camara_rapida") look.playbackRate = 2;
  return look;
}

/** La música baja mientras habla la voz (ducking aproximado). */
export function musicVolume(base: number, words: PreviewWord[], t: number): number {
  const speaking = words.some((w) => t >= w.start - 0.15 && t <= w.end + 0.3);
  return speaking ? base * 0.35 : base;
}

export function formatClock(t: number): string {
  const s = Math.max(t, 0);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** Estilos rápidos: combinaciones listas (se pueden retocar después). */
export const SUBTITLE_PRESETS: { id: string; label: string; style: Partial<SubtitleStyle> }[] = [
  {
    id: "reel",
    label: "Reel cursiva",
    style: {
      font: "Montserrat", italic: true, edge: "shadow", animation: "pop", uppercase: true,
      highlight: true, highlight_color: "#FFD400", text_color: "#FFFFFF", background: false,
    },
  },
  {
    id: "classic",
    label: "Clásico",
    style: {
      font: "Arial", italic: false, edge: "outline", animation: "none", uppercase: true,
      highlight: true, highlight_color: "#FFD400", text_color: "#FFFFFF", background: false,
    },
  },
  {
    id: "box",
    label: "Caja",
    style: {
      font: "Arial", italic: false, edge: "outline", animation: "none", uppercase: false,
      highlight: true, highlight_color: "#FFD400", text_color: "#FFFFFF", background: true,
    },
  },
];

// --- transiciones (aproximación en CSS de xfade de FFmpeg) ---

export interface TransitionLook {
  /** La escena que entra y la que sale (esta sigue con su cola durante la transición). */
  incoming: React.CSSProperties;
  outgoing: React.CSSProperties;
  /** La que sale va encima (p. ej. el círculo que se cierra sobre la nueva). */
  outgoingOnTop?: boolean;
  /** Velo de color (fundido a negro o destello blanco). */
  overlay?: { color: string; opacity: number };
}

const pctStr = (v: number) => `${Math.round(v * 10000) / 100}%`;

/** Cómo se ven las dos escenas en el punto `p` (0 → 1) de la transición `kind`. */
export function transitionLook(kind: string, p: number): TransitionLook {
  const x = Math.min(Math.max(p, 0), 1);
  const cross = { incoming: { opacity: x }, outgoing: {} };
  switch (kind) {
    case "fadeblack":
    case "fadewhite": {
      // Primero se oscurece (o aclara) la que sale; después aparece la nueva.
      const color = kind === "fadeblack" ? "#000" : "#fff";
      return x < 0.5
        ? { incoming: { opacity: 0 }, outgoing: {}, overlay: { color, opacity: x * 2 } }
        : { incoming: {}, outgoing: { opacity: 0 }, overlay: { color, opacity: 2 - x * 2 } };
    }
    case "fadegrays":
      return { incoming: { opacity: x, filter: `grayscale(${1 - x})` }, outgoing: { filter: `grayscale(${x})` } };
    case "slideleft":
      return { incoming: { transform: `translateX(${pctStr(1 - x)})` }, outgoing: { transform: `translateX(${pctStr(-x)})` } };
    case "slideright":
      return { incoming: { transform: `translateX(${pctStr(x - 1)})` }, outgoing: { transform: `translateX(${pctStr(x)})` } };
    case "slideup":
      return { incoming: { transform: `translateY(${pctStr(1 - x)})` }, outgoing: { transform: `translateY(${pctStr(-x)})` } };
    case "slidedown":
      return { incoming: { transform: `translateY(${pctStr(x - 1)})` }, outgoing: { transform: `translateY(${pctStr(x)})` } };
    case "wipeleft":
    case "smoothleft":
      return { incoming: { clipPath: `inset(0 0 0 ${pctStr(1 - x)})` }, outgoing: {} };
    case "wiperight":
      return { incoming: { clipPath: `inset(0 ${pctStr(1 - x)} 0 0)` }, outgoing: {} };
    case "wipeup":
      return { incoming: { clipPath: `inset(${pctStr(1 - x)} 0 0 0)` }, outgoing: {} };
    case "wipedown":
      return { incoming: { clipPath: `inset(0 0 ${pctStr(1 - x)} 0)` }, outgoing: {} };
    case "circleopen":
      return { incoming: { clipPath: `circle(${pctStr(x * 0.75)} at 50% 50%)` }, outgoing: {} };
    case "circleclose":
      return { incoming: {}, outgoing: { clipPath: `circle(${pctStr((1 - x) * 0.75)} at 50% 50%)` }, outgoingOnTop: true };
    case "horzopen":
      return { incoming: { clipPath: `inset(${pctStr((1 - x) / 2)} 0 ${pctStr((1 - x) / 2)} 0)` }, outgoing: {} };
    case "radial": {
      const mask = `conic-gradient(#000 ${Math.round(x * 360)}deg, transparent 0)`;
      return { incoming: { maskImage: mask, WebkitMaskImage: mask }, outgoing: {} };
    }
    case "zoomin":
      return { incoming: { opacity: x }, outgoing: { transform: `scale(${1 + x})` } };
    case "hblur":
    case "pixelize": {
      const blur = `blur(${Math.round(Math.sin(x * Math.PI) * 12)}px)`;
      return { incoming: { opacity: x, filter: blur }, outgoing: { filter: blur } };
    }
    default: // fade, dissolve
      return cross;
  }
}
