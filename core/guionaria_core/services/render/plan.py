"""Plan del render (sección 16, «Ensamblado automático»): comandos de FFmpeg como funciones puras.

Se renderiza escena por escena (cada segmento con su efecto, a la duración exacta del timeline)
y después se unen sin volver a codificar. Así el progreso es por escena y un video largo no
depende de un único filtro gigante.
"""

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

FPS = 30
# Zoom lento: según lo que dura la escena (3 %/s), entre 4 % y 12 %. Un zoom fijo del 15 %
# en escenas de 3 s se veía apurado.
ZOOM = 0.12  # el máximo
ZOOM_PER_S = 0.03
ZOOM_MIN = 0.04
KEN_BURNS = 1.08  # acercamiento fijo del paneo lateral
MUSIC_VOLUME = 0.35
SFX_VOLUME = 0.9


@dataclass
class Quality:
    width: int
    height: int
    preset: str
    crf: int
    audio_bitrate: str = "192k"

    @property
    def size(self) -> str:
        return f"{self.width}x{self.height}"


Level = Literal["draft", "standard", "high", "max"]
LEVELS: tuple[Level, ...] = ("draft", "standard", "high", "max")


def _scaled(width: int, height: int, short_side: int) -> tuple[int, int]:
    scale = short_side / min(width, height)
    even = lambda v: int(round(v * scale / 2) * 2)  # noqa: E731
    return even(width), even(height)


def quality(width: int, height: int, level: Level | bool) -> Quality:
    """Niveles de render:
    - draft: 720p (lado corto) y rápido, para revisar.
    - standard: la resolución del formato (1080p), equilibrado.
    - high: 1080p más nítido (crf 17, preset slow) y audio a 256 kbps; tarda más.
    - max: reescalado a 4K (2160p): YouTube le asigna más bitrate y se ve mejor incluso en 1080p.
    """
    if isinstance(level, bool):  # compatibilidad: draft=True/False
        level = "draft" if level else "standard"
    if level == "draft":
        w, h = _scaled(width, height, 720)
        return Quality(w, h, "veryfast", 28)
    if level == "high":
        return Quality(width, height, "slow", 17, "256k")
    if level == "max":
        w, h = _scaled(width, height, 2160)
        return Quality(w, h, "slow", 17, "320k")
    return Quality(width, height, "medium", 20)


def find_font() -> str | None:
    """Fuente para textos y subtítulos (Windows trae Arial y Segoe UI)."""
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    return next((str(p) for p in candidates if p.exists()), None)


def ff_path(path: Path | str) -> str:
    """Ruta para opciones de filtros (drawtext fontfile/textfile): barras normales y los dos
    puntos de la unidad escapados, como pide FFmpeg en Windows."""
    text = str(path).replace("\\", "/")
    return text.replace(":", "\\:") if sys.platform == "win32" or ":" in text[:3] else text


def cover(q: Quality, factor: int = 1) -> str:
    """Escala y recorta al centro para llenar el cuadro (lo que no está encuadrado a mano)."""
    w, h = q.width * factor, q.height * factor
    return f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1"


def zoom_amount(duration: float) -> float:
    """Cuánto se acerca (o aleja) el zoom lento en una escena de `duration` segundos."""
    return round(min(ZOOM, max(ZOOM_MIN, ZOOM_PER_S * duration)), 4)


def _window(left: str, top: str, frac: str, interp: str) -> str:
    """Recorte móvil con precisión subpíxel (perspective, evaluado por cuadro): la ventana
    de ancho relativo `frac` con su esquina en (left, top). zoompan redondea a píxeles
    enteros y el zoom «temblaba»."""
    x0, y0 = f"W*({left})", f"H*({top})"
    x1, y1 = f"W*({left}+{frac})", f"H*({top}+{frac})"
    return (
        f"perspective=x0='{x0}':y0='{y0}':x1='{x1}':y1='{y0}':x2='{x0}':y2='{y1}':"
        f"x3='{x1}':y3='{y1}':interpolation={interp}:eval=frame"
    )


def effect_filter(
    effect: str | None, q: Quality, frames: int, duration: float, draft: bool = False
) -> list[str]:
    """Filtros de la sección 11 para una escena ya cubierta a la resolución de salida."""
    n = max(frames - 1, 1)
    interp = "linear" if draft else "cubic"
    amount = zoom_amount(duration)
    if effect in ("zoom_lento_in", "zoom_lento_out"):
        z = f"(1+{amount}*in/{n})" if effect == "zoom_lento_in" else f"(1+{amount}-{amount}*in/{n})"
        frac = f"1/{z}"
        margin = f"(1-1/{z})/2"
        return [cover(q), _window(margin, margin, frac, interp)]
    if effect == "ken_burns":
        frac = f"{1 / KEN_BURNS:.5f}"
        travel = f"{1 - 1 / KEN_BURNS:.5f}"
        return [cover(q), _window(f"{travel}*in/{n}", f"{travel}/2", frac, interp)]
    out = [cover(q)]
    if effect == "estatica":
        # Grano suave: el ruido fuerte cuadro a cuadro se veía como una vibración.
        out.append("noise=alls=14:allf=t,eq=saturation=0.6:contrast=1.05")
    elif effect == "glitch":
        out.append("rgbashift=rh=-8:bh=8,noise=alls=12:allf=t")
    elif effect == "fundido_negro":
        start = max(duration - 0.6, 0)
        out.append(f"fade=t=out:st={start:.2f}:d={min(0.6, duration):.2f}")
    return out


def text_filter(
    textfile: Path, font: str | None, q: Quality, centered: bool, raised: bool = False
) -> str:
    """Texto en pantalla con borde, abajo sobre el medio o centrado en las escenas de texto.
    Con subtítulos quemados (`raised`) sube a la parte de arriba para no taparse con ellos."""
    size = (
        int(q.height / (9 if centered else 16))
        if q.height < q.width
        else int(q.width / (9 if centered else 13))
    )
    y = "(h-text_h)/2" if centered else ("h*0.16-text_h/2" if raised else "h*0.78-text_h/2")
    font_opt = f"fontfile='{ff_path(font)}':" if font else ""
    return (
        f"drawtext={font_opt}textfile='{ff_path(textfile)}':fontsize={size}:fontcolor=white:"
        f"borderw={max(size // 12, 2)}:bordercolor=black:x=(w-text_w)/2:y={y}:line_spacing=8"
    )


@dataclass
class Segment:
    """Una escena del render: medio (o fondo negro), duración y efecto."""

    position: int
    duration: float
    kind: str  # image | video | color
    path: Path | None
    source_in: float
    effect: str | None
    text: str | None


def segment_command(
    seg: Segment,
    q: Quality,
    out: Path,
    textfile: Path | None,
    font: str | None,
    raise_text: bool = False,
    draft: bool = False,
) -> list[str]:
    frames = max(round(seg.duration * FPS), 1)
    dur = f"{frames / FPS:.3f}"
    args = ["ffmpeg", "-y", "-v", "error", "-nostdin"]
    fast = seg.effect == "camara_rapida" and seg.kind == "video"
    if seg.kind == "image":
        args += ["-loop", "1", "-framerate", str(FPS), "-t", dur, "-i", str(seg.path)]
    elif seg.kind == "video":
        read = frames / FPS * (2 if fast else 1)
        args += ["-ss", f"{seg.source_in:.3f}", "-t", f"{read:.3f}", "-i", str(seg.path)]
    else:
        args += ["-f", "lavfi", "-i", f"color=c=black:s={q.size}:r={FPS}:d={dur}"]

    chain: list[str] = []
    if seg.kind == "video":
        chain.append(f"fps={FPS}")
        if fast:
            chain.append("setpts=0.5*PTS")
    if seg.kind == "color":
        chain.append("setsar=1")
    else:
        chain += effect_filter(None if fast else seg.effect, q, frames, frames / FPS, draft)
    if textfile:
        chain.append(
            text_filter(textfile, font, q, centered=seg.kind == "color", raised=raise_text)
        )
    # Un video más corto que la escena se congela en su último cuadro.
    chain += [f"tpad=stop_mode=clone:stop_duration={dur}", f"trim=duration={dur}"]
    # Todos los segmentos con el mismo formato y rango: un JPG saldría en rango completo
    # (yuvj420p) y, al cambiar a mitad del video unido, FFmpeg reinicia los filtros.
    chain += ["scale=out_range=tv", "format=yuv420p"]
    args += [
        "-vf", ",".join(chain),
        "-r", str(FPS), "-an", "-color_range", "tv",
        "-c:v", "libx264", "-preset", q.preset, "-crf", str(q.crf),
        str(out),
    ]  # fmt: skip
    return args


@dataclass
class AudioClip:
    path: Path
    start: float
    duration: float


def audio_filter(
    voice: AudioClip | None, sfx: list[AudioClip], music: list[AudioClip], first_input: int
) -> tuple[str, list[AudioClip]]:
    """Mezcla: voz + SFX en su tiempo + música con ducking (baja cuando habla la voz).
    Devuelve el filtro y las entradas de audio en el orden en que deben pasarse a FFmpeg."""
    inputs: list[AudioClip] = []
    parts: list[str] = []
    labels: list[str] = []

    def prep(clip: AudioClip, label: str, volume: float, fade: bool) -> str:
        idx = first_input + len(inputs)
        inputs.append(clip)
        ms = int(round(clip.start * 1000))
        chain = [
            f"[{idx}:a]aresample=48000",
            "aformat=channel_layouts=stereo",
            f"atrim=0:{clip.duration:.3f}",
            "asetpts=PTS-STARTPTS",
        ]
        if fade and clip.duration > 2:
            chain.append(f"afade=t=out:st={clip.duration - 1:.3f}:d=1")
        chain += [f"volume={volume}", f"adelay={ms}|{ms}[{label}]"]
        parts.append(",".join(chain))
        return f"[{label}]"

    voice_label = prep(voice, "voice", 1.0, False) if voice else None
    sfx_labels = [prep(c, f"sfx{i}", SFX_VOLUME, False) for i, c in enumerate(sfx)]
    music_labels = [prep(c, f"mus{i}", MUSIC_VOLUME, True) for i, c in enumerate(music)]

    if music_labels:
        if len(music_labels) > 1:
            parts.append(
                f"{''.join(music_labels)}amix=inputs={len(music_labels)}:normalize=0[music]"
            )
        else:
            parts[-1] = parts[-1].replace(f"[{music_labels[0][1:-1]}]", "[music]", 1)
        if voice_label:
            parts.append("[voice]asplit=2[voicemix][voicekey]")
            parts.append(
                "[music][voicekey]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=450[ducked]"
            )
            labels += ["[voicemix]", "[ducked]"]
        else:
            labels.append("[music]")
    elif voice_label:
        labels.append(voice_label)
    labels += sfx_labels
    if not labels:
        return "", []
    if len(labels) == 1:
        parts.append(f"{labels[0]}alimiter=limit=0.95[aout]")
    else:
        parts.append(
            f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0,alimiter=limit=0.95[aout]"
        )
    return ";".join(parts), inputs


def subtitle_filter(srt_name: str, portrait: bool) -> str:
    """Subtítulos quemados (ASS): grandes y centrados abajo; más grandes en vertical."""
    size = 16 if portrait else 20
    margin = 90 if portrait else 40
    style = f"FontName=Arial,FontSize={size},Bold=1,Outline=2,Shadow=0,Alignment=2,MarginV={margin}"
    return f"subtitles={srt_name}:force_style='{style}'"


def join_filter(count: int, cuts: list, starts: list[float]) -> tuple[str, str]:
    """Une `count` segmentos: corte directo (concat) o transición (xfade) en cada corte.
    `starts[i]` es el inicio nominal de la escena i: la transición empieza ahí, sobre la
    cola de la escena anterior, así el video dura lo mismo. Devuelve (filtro, etiqueta)."""
    parts = [f"[{i}:v]settb=AVTB,fps={FPS}[s{i}]" for i in range(count)]
    acc = "s0"
    for i in range(count - 1):
        cut, nxt, out = cuts[i], f"s{i + 1}", f"j{i + 1}"
        if cut.transition:
            parts.append(
                f"[{acc}][{nxt}]xfade=transition={cut.transition}:duration={cut.duration:.3f}:"
                f"offset={starts[i + 1]:.3f}[{out}]"
            )
        else:
            parts.append(f"[{acc}][{nxt}]concat=n=2:v=1:a=0[{out}]")
        acc = out
    return ";".join(parts), acc
