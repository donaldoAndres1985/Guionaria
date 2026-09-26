import { useEffect, useRef, useState } from "react";

/** Un solo reproductor para escuchar sonidos: al tocar otro, se detiene el anterior. */
export function usePreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  const toggle = (key: string, url: string) => {
    if (playing === key) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const el = new Audio(url);
    el.onended = () => setPlaying((p) => (p === key ? null : p));
    audio.current = el;
    setPlaying(key);
    el.play().catch(() => setPlaying(null));
  };

  return { playing, toggle };
}

export function formatSeconds(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

export const MOODS = ["tensión", "misterio", "triste", "épica", "calma", "oscura", "esperanza", "acción"];
