/**
 * Cálculos de la vista previa en vivo. Replican los del render (services/render/plan.py y
 * captions.py) para que lo que se ve se parezca lo más posible al MP4 final.
 */
import type { PreviewScene, PreviewWord, SubtitleStyle } from "@/lib/api";

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

/** Tamaño del texto en pantalla (como en plan.text_filter). */
export function sceneTextPx(width: number, height: number, centered: boolean): number {
  return height < width ? height / (centered ? 9 : 16) : width / (centered ? 9 : 13);
}

// --- efectos (aproximación de plan.effect_filter) ---

export interface EffectLook {
  transform: string;
  filter?: string;
  /** Opacidad del velo negro (fundido al final). */
  fade: number;
  playbackRate: number;
}

export function effectLook(effect: string | null, progress: number, zoom: number, sceneDuration: number): EffectLook {
  const p = Math.min(Math.max(progress, 0), 1);
  const look: EffectLook = { transform: "none", fade: 0, playbackRate: 1 };
  const r = (v: number) => Math.round(v * 10000) / 10000;
  if (effect === "zoom_lento_in") look.transform = `scale(${r(1 + zoom * p)})`;
  else if (effect === "zoom_lento_out") look.transform = `scale(${r(1 + zoom - zoom * p)})`;
  else if (effect === "ken_burns") {
    const pan = ((1 - 1 / 1.12) / 2) * 100; // % que se desplaza hacia cada lado
    look.transform = `scale(1.12) translateX(${pan - 2 * pan * p}%)`;
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
