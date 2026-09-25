import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import { Button } from "@/components/ui/button";
import type { SegmentVoice } from "@/lib/api";
import { formatSceneTime } from "@/features/scenes/sceneMeta";

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;

export interface SeekRequest {
  time: number;
  play: boolean;
  /** Distinto en cada pedido, para repetir el mismo instante. */
  nonce: number;
}

/** Forma de onda de la voz con los segmentos del guion marcados (wavesurfer.js). */
export function Waveform({
  url,
  segments,
  seek,
  onTime,
}: {
  url: string;
  segments: SegmentVoice[];
  seek: SeekRequest | null;
  onTime: (t: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const regions = useRef<RegionsPlugin | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  useEffect(() => {
    if (!container.current) return;
    const plugin = RegionsPlugin.create();
    const instance = WaveSurfer.create({
      container: container.current,
      url,
      height: 96,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      cursorWidth: 2,
      waveColor: cssVar("--text-subtle"),
      progressColor: cssVar("--accent"),
      cursorColor: cssVar("--text"),
      plugins: [plugin],
    });
    instance.on("ready", (d) => setDuration(d));
    instance.on("timeupdate", (t) => {
      setTime(t);
      onTimeRef.current(t);
    });
    instance.on("play", () => setPlaying(true));
    instance.on("pause", () => setPlaying(false));
    ws.current = instance;
    regions.current = plugin;
    return () => {
      instance.destroy();
      ws.current = null;
      regions.current = null;
    };
  }, [url]);

  // Segmentos como regiones alternadas (sin arrastre: los tiempos los calcula la app).
  useEffect(() => {
    const plugin = regions.current;
    const instance = ws.current;
    if (!plugin || !instance) return;
    const draw = () => {
      plugin.clearRegions();
      segments.forEach((s, i) => {
        if (s.start_s == null || s.end_s == null) return;
        plugin.addRegion({
          start: s.start_s,
          end: s.end_s,
          drag: false,
          resize: false,
          color: i % 2 ? "rgba(255, 122, 26, 0.10)" : "rgba(255, 122, 26, 0.04)",
        });
      });
    };
    if (instance.getDuration() > 0) draw();
    return instance.on("ready", draw);
  }, [segments, url]);

  useEffect(() => {
    const instance = ws.current;
    if (!seek || !instance) return;
    instance.setTime(seek.time);
    if (seek.play) void instance.play();
  }, [seek]);

  return (
    <div className="flex items-center gap-3 rounded-md border bg-panel px-3 py-3">
      <Button
        size="icon"
        variant="outline"
        aria-label={playing ? "Pausar" : "Reproducir"}
        onClick={() => void ws.current?.playPause()}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <div ref={container} className="min-w-0 flex-1" />
      <span className="w-24 shrink-0 text-right font-mono text-[12px] text-muted-foreground">
        {formatSceneTime(time)} / {formatSceneTime(duration)}
      </span>
    </div>
  );
}
