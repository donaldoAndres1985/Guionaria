import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { coreUrl, type PreviewMedia, type PreviewScene, type PreviewSound, type PreviewState, type SubtitleStyle, type TextStyle, type VideoLook } from "@/lib/api";
import { cn } from "@/lib/utils";
import { OverlayTexts } from "./OverlayText";
import {
  captionAt,
  captionGroups,
  captionLayout,
  subtitleTextCss,
  effectLook,
  layoutText,
  lineChars,
  sceneIndexAt,
  sceneTextPx,
  subtitleFontPx,
  TEXT_MARGIN,
  textLook,
  textTop,
  transitionLook,
  lookCss,
  NEUTRAL_LOOK,
  sceneEffect,
} from "./previewMeta";

const DEFAULT_TEXT: TextStyle = { font: "Montserrat", size: "medium", uppercase: false, animation: "pop", box: false, text_color: "#FFFFFF" };

/** Reloj de la vista previa: reproducir/pausar, buscar y avanzar en tiempo real. */
export function usePreviewClock(duration: number) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const anchor = useRef({ t0: 0, at: 0 });
  const timeRef = useRef(0);
  timeRef.current = time;

  useEffect(() => {
    if (!playing) return;
    anchor.current = { t0: timeRef.current, at: performance.now() };
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const t = anchor.current.t0 + (now - anchor.current.at) / 1000;
      if (t >= duration) {
        setTime(duration);
        setPlaying(false);
        return;
      }
      if (now - last > 33) {
        last = now;
        setTime(t);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.min(Math.max(t, 0), duration);
      anchor.current = { t0: clamped, at: performance.now() };
      timeRef.current = clamped;
      setTime(clamped);
    },
    [duration],
  );

  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && timeRef.current >= duration - 0.05) seek(0);
      return !p;
    });
  }, [duration, seek]);

  return { time, playing, seek, toggle, pause: () => setPlaying(false) };
}

export type PreviewClock = ReturnType<typeof usePreviewClock>;

/**
 * Composición en vivo: escena actual (y la siguiente precargada), efecto, texto en pantalla,
 * subtítulos con el estilo elegido y audio (voz, SFX, música a volumen fijo).
 */
export function PreviewCanvas({
  preview,
  time,
  playing,
  burnSubtitles,
  style,
  textStyle,
  look: lookProp,
  onSubtitlesClick,
}: {
  preview: PreviewState;
  time: number;
  playing: boolean;
  burnSubtitles: boolean;
  style: SubtitleStyle;
  /** Estilo del texto en pantalla; por defecto, el guardado. */
  textStyle?: TextStyle;
  /** Look del video (clip de ajuste); por defecto, el guardado. */
  look?: VideoLook;
  onSubtitlesClick?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setBoxWidth(el.getBoundingClientRect().width);
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const scale = boxWidth / preview.width || 0.3;
  const portrait = preview.height > preview.width;

  const index = sceneIndexAt(preview.scenes, time);
  const scene = preview.scenes[index];
  const next = preview.scenes[index + 1];
  const prev = index > 0 ? preview.scenes[index - 1] : undefined;
  // Transición con la que entra esta escena (sobre la cola de la anterior, como en el render).
  const sinceStart = scene ? time - scene.start_s : 0;
  const transS = scene?.transition_in_s ?? 0;
  const trans =
    scene?.transition_in && transS > 0 && sinceStart < transS ? transitionLook(scene.transition_in, sinceStart / transS) : null;

  const layout = captionLayout(style, portrait);
  const groups = useMemo(
    () => captionGroups(preview.words, layout.perLine, layout.maxChars),
    [preview.words, layout.perLine, layout.maxChars],
  );
  const caption = burnSubtitles ? captionAt(groups, time) : null;
  const grade = lookProp ?? preview.look ?? NEUTRAL_LOOK;
  const css = lookCss(grade);
  const effect = scene ? sceneEffect(scene.effect, scene.media?.kind, grade) : null;
  const motion = (grade.motion ?? 100) / 100;
  const look = scene ? effectLook(effect, (time - scene.start_s) / scene.duration_s, preview.zoom, scene.duration_s, motion) : null;

  return (
    <div
      ref={box}
      data-testid="preview-canvas"
      className="relative overflow-hidden rounded-md bg-black shadow-lg"
      style={{ aspectRatio: `${preview.width} / ${preview.height}`, height: "100%", maxWidth: "100%" }}
    >
      {/* Clip de ajuste: el look se aplica a videos, fotos y fondos; el texto y los subtítulos quedan fuera */}
      <div data-testid="look-layer" className="absolute inset-0 isolate overflow-hidden" style={{ filter: css.filter }}>
        {scene && (
          <SceneLayer
            key={scene.position}
            scene={scene}
            time={time}
            playing={playing}
            visible
            zoom={preview.zoom}
            grade={grade}
            layerStyle={{ ...trans?.incoming, zIndex: trans?.outgoingOnTop ? 1 : 2 }}
          />
        )}
        {/* Durante la transición, la escena anterior sigue (su cola) y se funde con esta */}
        {trans && prev && (
          <SceneLayer
            key={prev.position}
            scene={prev}
            time={time}
            playing={playing}
            visible
            outgoing
            zoom={preview.zoom}
            grade={grade}
            layerStyle={{ ...trans.outgoing, zIndex: trans.outgoingOnTop ? 2 : 1 }}
          />
        )}
        {trans?.overlay && (
          <div className="absolute inset-0 z-[3]" style={{ background: trans.overlay.color, opacity: trans.overlay.opacity }} />
        )}
        {next && next.media && (
          <SceneLayer key={next.position} scene={next} time={time} playing={false} visible={false} zoom={preview.zoom} grade={grade} />
        )}

        {look && look.fade > 0 && <div className="absolute inset-0 z-[3] bg-black" style={{ opacity: look.fade }} />}
        {look && (look.flash ?? 0) > 0 && (
          <div data-testid="effect-flash" className="absolute inset-0 z-[3] bg-white" style={{ opacity: look.flash }} />
        )}
        {css.tint && (
          <div className="absolute inset-0 z-[3] mix-blend-soft-light" style={{ background: css.tint.color, opacity: css.tint.opacity }} />
        )}
        {css.vignette > 0 && (
          <div
            data-testid="look-vignette"
            className="absolute inset-0 z-[3]"
            style={{ background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${Math.round(css.vignette * 90) / 100}) 100%)` }}
          />
        )}
        {css.grain > 0 && <Grain amount={css.grain} time={time} />}
      </div>

      {/* Texto en pantalla de la escena */}
      {scene?.text && (
        <SceneText
          key={scene.position}
          text={scene.text}
          centered={!scene.media}
          raised={burnSubtitles}
          width={preview.width}
          height={preview.height}
          scale={scale}
          local={time - scene.start_s}
          duration={scene.duration_s}
          style={textStyle ?? preview.text_style ?? DEFAULT_TEXT}
        />
      )}

      {/* Textos de las pistas propias (las de más arriba, encima) */}
      {preview.overlays && preview.overlays.length > 0 && (
        <OverlayTexts overlays={preview.overlays} time={time} width={preview.width} height={preview.height} scale={scale} />
      )}

      {/* Subtítulos */}
      {caption && (
        <button
          type="button"
          data-testid="preview-subtitle"
          title="Clic para editar el estilo de los subtítulos"
          onClick={onSubtitlesClick}
          className={cn(
            "absolute z-[4] left-[4%] right-[4%] flex justify-center",
            style.position === "middle" ? "top-1/2 -translate-y-1/2" : "",
          )}
          style={style.position === "middle" ? undefined : { bottom: `${(portrait ? 22 : 8)}%` }}
        >
          <span
            className={cn("text-center leading-tight font-bold", style.background && "rounded bg-black/60 px-[0.3em]")}
            style={{
              ...subtitleTextCss(style, scale),
              fontSize: subtitleFontPx(style, preview.width, preview.height) * scale,
            }}
          >
            {caption.words.map((w, i) => {
              const text = style.uppercase ? w.text.toUpperCase() : w.text;
              return (
                <span key={`${w.start}-${i}`}>
                  <span
                    // Con «pop», la palabra activa se vuelve a montar para repetir la animación.
                    key={i === caption.active ? `activa-${w.start}` : "normal"}
                    data-active={i === caption.active || undefined}
                    className={style.animation === "pop" && i === caption.active ? "inline-block" : undefined}
                    style={{
                      ...(style.highlight && i === caption.active ? { color: style.highlight_color } : {}),
                      ...(style.animation === "pop" && i === caption.active
                        ? { animation: "subtitle-pop 140ms ease-out" }
                        : {}),
                    }}
                  >
                    {text}
                  </span>
                  {i < caption.words.length - 1 ? " " : ""}
                </span>
              );
            })}
          </span>
        </button>
      )}

      {/* Audio */}
      {preview.voice_url && (
        <AudioTrack src={coreUrl(preview.voice_url) ?? ""} start={0} duration={preview.duration_s} time={time} playing={playing} volume={1} />
      )}
      {preview.sfx.map((s, i) => (
        <SoundTrack key={`sfx-${s.start_s}-${i}`} sound={s} time={time} playing={playing} volume={s.volume ?? preview.sfx_volume} />
      ))}
      {preview.music.map((s) => (
        <SoundTrack
          key={`music-${s.start_s}`}
          sound={s}
          time={time}
          playing={playing}
          volume={s.volume ?? preview.music_volume}
        />
      ))}
    </div>
  );
}

function SceneLayer({
  scene,
  time,
  playing,
  visible,
  zoom,
  outgoing,
  layerStyle,
  grade,
}: {
  scene: PreviewScene;
  time: number;
  playing: boolean;
  visible: boolean;
  zoom: number;
  /** La escena que sale durante una transición (se ve pasado su final). */
  outgoing?: boolean;
  layerStyle?: React.CSSProperties;
  grade?: VideoLook;
}) {
  const local = Math.max(time - scene.start_s, 0);
  const look = effectLook(
    sceneEffect(scene.effect, scene.media?.kind, grade),
    local / scene.duration_s,
    zoom,
    scene.duration_s,
    (grade?.motion ?? 100) / 100,
  );
  const blur = grade ? lookCss(grade).photoBlur : 0;
  const media = scene.media;
  const common = "absolute inset-0 size-full object-cover";
  return (
    <div
      className={cn("absolute inset-0 overflow-hidden", !visible && "invisible")}
      data-testid={outgoing ? "preview-outgoing" : visible ? "preview-scene" : undefined}
      data-position={scene.position}
      style={layerStyle}
    >
      {media?.kind === "video" ? (
        <VideoLayer scene={scene} local={local} playing={playing && visible} visible={visible} rate={look.playbackRate} style={{ transform: look.transform, filter: look.filter }} className={common} />
      ) : media?.kind === "image" ? (
        <img
          src={coreUrl(media.url) ?? ""}
          alt=""
          draggable={false}
          className={common}
          style={{ transform: look.transform, filter: [look.filter, blur > 0 ? `blur(${blur / 2}px)` : ""].filter(Boolean).join(" ") || undefined }}
        />
      ) : (
        <div className="absolute inset-0 bg-black" />
      )}
      {(look.vignette ?? 0) > 0 && (
        <div
          data-testid="effect-vignette"
          className="absolute inset-0"
          style={{ background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${look.vignette}) 100%)` }}
        />
      )}
      {(look.bars ?? 0) > 0 && (
        <>
          <div data-testid="effect-bars" className="absolute inset-x-0 top-0 bg-black" style={{ height: `${(look.bars ?? 0) * 100}%` }} />
          <div className="absolute inset-x-0 bottom-0 bg-black" style={{ height: `${(look.bars ?? 0) * 100}%` }} />
        </>
      )}
    </div>
  );
}

/** Instante del archivo que se ve `local` segundos después del inicio de la escena. En bucle
 * (video más corto que la escena), el tramo vuelve a empezar al terminar, como en el render. */
export function videoTime(media: PreviewMedia, local: number, rate = 1): number {
  const shown = Math.min(Math.max(local, 0), media.duration_s) * rate;
  return media.source_in_s + (media.loop_s ? shown % media.loop_s : shown);
}

function VideoLayer({
  scene,
  local,
  playing,
  visible,
  rate,
  style,
  className,
}: {
  scene: PreviewScene;
  local: number;
  playing: boolean;
  visible: boolean;
  rate: number;
  style: React.CSSProperties;
  className: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const media = scene.media!;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const target = videoTime(media, local, rate);
    v.playbackRate = rate;
    const frozen = local >= media.duration_s - 0.02; // el video es más corto: se congela
    if (playing && !frozen) {
      if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
      if (v.paused) void v.play().catch(() => {});
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
    }
  }, [local, playing, visible, rate, media.duration_s, media.source_in_s, media.loop_s]);
  return <video ref={ref} src={coreUrl(media.url) ?? ""} muted playsInline preload="auto" className={className} style={style} />;
}

/** Texto en pantalla: mismas líneas, tamaño, posición y animación que el ASS del render. */
function SceneText({
  text,
  centered,
  raised,
  width,
  height,
  scale,
  local,
  duration,
  style,
}: {
  text: string;
  centered: boolean;
  raised: boolean;
  width: number;
  height: number;
  scale: number;
  local: number;
  duration: number;
  style: TextStyle;
}) {
  const size = sceneTextPx(width, height, centered, style.size);
  const px = size * scale;
  const laid = layoutText(style.uppercase ? text.toUpperCase() : text, lineChars(width, size));
  const look = textLook(style.animation, local, duration, laid.length);
  const shown = look.chars === null ? laid : laid.slice(0, look.chars);
  const hidden = look.chars === null ? "" : laid.slice(look.chars);
  const margin = `${TEXT_MARGIN * 100}%`;
  return (
    <div
      data-testid="scene-text"
      className="pointer-events-none absolute z-[4] text-center"
      style={{
        left: margin,
        right: margin,
        top: `${(textTop(centered, raised) + look.rise) * 100}%`,
        transform: `translateY(-50%) scale(${look.scale})`,
        opacity: look.opacity,
      }}
    >
      <span
        className="whitespace-pre-line"
        style={{
          fontFamily: style.font === "Montserrat" ? '"Montserrat", sans-serif' : style.font,
          fontWeight: style.font === "Montserrat" ? 800 : 700,
          fontSize: px,
          lineHeight: 1.2,
          color: style.text_color,
          ...(style.box
            ? { background: "rgba(0,0,0,0.67)", padding: `0 ${px * 0.2}px`, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }
            : {
                WebkitTextStroke: `${Math.max(1, px / 12)}px #000`,
                paintOrder: "stroke fill",
                textShadow: `0 ${Math.max(1, px * 0.04)}px ${Math.max(1, px * 0.04)}px rgba(0,0,0,0.5)`,
              }),
        }}
      >
        {shown}
        {hidden && <span style={{ opacity: 0 }}>{hidden}</span>}
      </span>
    </div>
  );
}

function SoundTrack({ sound, time, playing, volume }: { sound: PreviewSound; time: number; playing: boolean; volume: number }) {
  return (
    <AudioTrack
      src={coreUrl(sound.url) ?? ""}
      start={sound.start_s}
      duration={sound.duration_s}
      time={time}
      playing={playing}
      volume={volume * fadeGain(time - sound.start_s, sound.duration_s, sound.fade_in_s ?? 0, sound.fade_out_s ?? 0)}
      loop={sound.loop}
    />
  );
}

/** Ganancia de los fundidos de entrada y salida (0–1), como los afade del render. */
export function fadeGain(local: number, duration: number, fadeIn: number, fadeOut: number): number {
  let gain = 1;
  if (fadeIn > 0 && local < fadeIn) gain = Math.min(gain, Math.max(local / fadeIn, 0));
  if (fadeOut > 0 && local > duration - fadeOut) gain = Math.min(gain, Math.max((duration - local) / fadeOut, 0));
  return gain;
}

/** Un audio sincronizado con el reloj: suena solo dentro de su tramo. */
function AudioTrack({
  src,
  start,
  duration,
  time,
  playing,
  volume,
  loop = false,
}: {
  src: string;
  start: number;
  duration: number;
  time: number;
  playing: boolean;
  volume: number;
  /** Audio de fondo: se repite (la posición es el tiempo módulo su largo). */
  loop?: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const inside = time >= start && time < start + duration;
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.volume = Math.min(Math.max(volume, 0), 1);
    a.loop = loop;
    const target = loop && a.duration > 0 ? (time - start) % a.duration : time - start;
    if (playing && inside) {
      if (Math.abs(a.currentTime - target) > 0.3) a.currentTime = target;
      if (a.paused) void a.play().catch(() => {});
    } else {
      if (!a.paused) a.pause();
      if (inside && Math.abs(a.currentTime - target) > 0.1) a.currentTime = target;
    }
  }, [time, playing, inside, start, volume, loop]);
  return <audio ref={ref} src={src} preload="auto" />;
}

// Ruido fractal (SVG) para el grano de película; se desplaza cada cuadro para que «viva».
const GRAIN_URL = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;

function Grain({ amount, time }: { amount: number; time: number }) {
  const frame = Math.floor(time * 24);
  return (
    <div
      data-testid="look-grain"
      className="pointer-events-none absolute inset-0 z-[3] mix-blend-overlay"
      style={{ backgroundImage: GRAIN_URL, backgroundPosition: `${(frame * 37) % 160}px ${(frame * 53) % 160}px`, opacity: amount * 0.45 }}
    />
  );
}
