"""Plan del render (sección 16, «Ensamblado automático»): comandos de FFmpeg como funciones puras.

Se renderiza escena por escena (cada segmento con su efecto, a la duración exacta del timeline)
y después se unen sin volver a codificar. Así el progreso es por escena y un video largo no
depende de un único filtro gigante.
"""

import sys
from dataclasses import dataclass
from pathlib import Path

FPS = 30
ZOOM = 0.15  # zoom lento: 15 % a lo largo de la escena
MUSIC_VOLUME = 0.35
SFX_VOLUME = 0.9


@dataclass
class Quality:
    width: int
    height: int
    preset: str
    crf: int

    @property
    def size(self) -> str:
        return f"{self.width}x{self.height}"


def quality(width: int, height: int, draft: bool) -> Quality:
    """Final a la resolución del formato; borrador a 720p (lado corto) para revisar rápido."""
    if not draft:
        return Quality(width, height, "medium", 20)
    scale = 720 / min(width, height)
    even = lambda v: int(round(v * scale / 2) * 2)  # noqa: E731
    return Quality(even(width), even(height), "veryfast", 28)


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


def effect_filter(effect: str | None, q: Quality, frames: int, duration: float) -> list[str]:
    """Filtros de la sección 11 para una escena ya cubierta a la resolución de salida."""
    n = max(frames - 1, 1)
    center = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    zp = f"d=1:s={q.size}:fps={FPS}"
    if effect == "zoom_lento_in":
        return [cover(q, 2), f"zoompan=z='1+{ZOOM}*on/{n}':{center}:{zp}"]
    if effect == "zoom_lento_out":
        return [cover(q, 2), f"zoompan=z='{1 + ZOOM}-{ZOOM}*on/{n}':{center}:{zp}"]
    if effect == "ken_burns":
        return [cover(q, 2), f"zoompan=z='1.12':x='(iw-iw/zoom)*on/{n}':y='(ih-ih/zoom)/2':{zp}"]
    out = [cover(q)]
    if effect == "estatica":
        out.append("noise=alls=35:allf=t+u,eq=saturation=0.6")
    elif effect == "glitch":
        out.append("rgbashift=rh=-8:bh=8,noise=alls=12:allf=t")
    elif effect == "fundido_negro":
        start = max(duration - 0.6, 0)
        out.append(f"fade=t=out:st={start:.2f}:d={min(0.6, duration):.2f}")
    return out


def text_filter(textfile: Path, font: str | None, q: Quality, centered: bool) -> str:
    """Texto en pantalla con borde, abajo sobre el medio o centrado en las escenas de texto."""
    size = (
        int(q.height / (9 if centered else 16))
        if q.height < q.width
        else int(q.width / (9 if centered else 13))
    )
    y = "(h-text_h)/2" if centered else "h*0.78-text_h/2"
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
    seg: Segment, q: Quality, out: Path, textfile: Path | None, font: str | None
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
        chain += effect_filter(None if fast else seg.effect, q, frames, frames / FPS)
    if textfile:
        chain.append(text_filter(textfile, font, q, centered=seg.kind == "color"))
    # Un video más corto que la escena se congela en su último cuadro.
    chain += [f"tpad=stop_mode=clone:stop_duration={dur}", f"trim=duration={dur}", "format=yuv420p"]
    args += [
        "-vf", ",".join(chain),
        "-r", str(FPS), "-an",
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
