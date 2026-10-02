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
ZOOM_PUNCH = 0.16  # «zoom rápido»: cuánto se acerca
ZOOM_PUNCH_S = 0.4  # y en cuánto tiempo
SHAKE_ZOOM = 1.06  # «temblor»: acercamiento que deja margen para el vaivén
CINEMA_BAR = 0.11  # «cinematográfico»: alto de cada franja negra (fracción del alto)
# Efectos de color y textura: un filtro fijo detrás del encuadre.
COLOR_EFFECTS: dict[str, str] = {
    "blanco_negro": "hue=s=0",
    "sepia": "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
    "contraste_alto": "eq=contrast=1.3:saturation=1.2:brightness=-0.02",
    "vhs": (
        "rgbashift=rh=-4:bh=4,eq=saturation=0.7:contrast=1.1,noise=alls=10:allf=t,gblur=sigma=0.7"
    ),
    "vineta": "vignette=angle=PI/4",
    "cinematico": (
        f"drawbox=x=0:y=0:w=iw:h=ih*{CINEMA_BAR}:color=black:t=fill,"
        f"drawbox=x=0:y=ih*{1 - CINEMA_BAR:.2f}:w=iw:h=ih*{CINEMA_BAR}:color=black:t=fill"
    ),
}
# Efectos que cambian la velocidad de un video (cuánto metraje se lee por segundo de escena).
SPEED = {"camara_rapida": 2.0, "camara_lenta": 0.5}
MUSIC_VOLUME = 0.35
SFX_VOLUME = 0.9


@dataclass
class Quality:
    width: int
    height: int
    preset: str
    crf: int
    audio_bitrate: str = "192k"
    hardware_ok: bool = False  # admite el codificador por hardware (borrador y estándar)
    # Tope de bitrate (kbps) para el codificador de GPU: su VBR con «-b:v 0» no tiene techo y,
    # en escenas con mucho detalle o ruido (p. ej. el efecto VHS), puede inflar el archivo muy
    # por encima de lo que pesaría el mismo video con x264 a ese CRF.
    max_bitrate_k: int = 0

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
    - standard: la resolución del formato (1080p), equilibrado: x264 «faster» (medium tardaba
      2,5 veces más con casi la misma calidad) o el codificador de la GPU si lo hay, con el
      bitrate que recomienda YouTube para esa resolución (no el que dé la gana su VBR).
    - high: 1080p más nítido (crf 17, preset slow) y audio a 256 kbps; tarda más.
    - max: reescalado a 4K (2160p): YouTube le asigna más bitrate y se ve mejor incluso en 1080p.
    """
    if isinstance(level, bool):  # compatibilidad: draft=True/False
        level = "draft" if level else "standard"
    if level == "draft":
        w, h = _scaled(width, height, 720)
        return Quality(w, h, "veryfast", 28, hardware_ok=True, max_bitrate_k=5000)
    if level == "high":
        return Quality(width, height, "slow", 17, "256k")
    if level == "max":
        w, h = _scaled(width, height, 2160)
        return Quality(w, h, "slow", 17, "320k")
    return Quality(width, height, "faster", 20, hardware_ok=True, max_bitrate_k=8000)


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


def zoom_amount(duration: float, motion: float = 1.0) -> float:
    """Cuánto se acerca (o aleja) el zoom lento en una escena de `duration` segundos.
    `motion` (Look → intensidad del movimiento) lo multiplica: 1,5 = un 50 % más."""
    base = min(ZOOM, max(ZOOM_MIN, ZOOM_PER_S * duration))
    return round(base * motion, 4)


def _ease(n: int) -> str:
    """Aceleración suave (smoothstep) del avance de la escena: arranca y frena sin tirones."""
    p = f"(in/{n})"
    return f"({p}*{p}*(3-2*{p}))"


# Brillo difuso («Zoom celestial»): una copia muy desenfocada y un poco más clara se suma
# en modo pantalla, como la luz de un amanecer.
GLOW = (
    # En RGB: la mezcla «pantalla» sobre los planos de color de YUV tiñe la imagen de rosa.
    "format=gbrp,split[dzbase][dzcopy];[dzcopy]gblur=sigma=16,eq=brightness=0.05:saturation=1.1[dzglow];"
    "[dzbase][dzglow]blend=all_mode=screen:all_opacity=0.28"
)


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
    effect: str | None,
    q: Quality,
    frames: int,
    duration: float,
    draft: bool = False,
    motion: float = 1.0,
) -> list[str]:
    """Filtros de la sección 11 para una escena ya cubierta a la resolución de salida."""
    n = max(frames - 1, 1)
    interp = "linear" if draft else "cubic"
    amount = zoom_amount(duration, motion)
    if effect == "deriva_suave":
        e = _ease(n)
        z = f"(1+{round(0.04 * motion, 4)}+{round(amount * 1.3, 4)}*{e})"
        frac = f"1/{z}"
        left = f"(1-1/{z})*(0.15+0.7*{e})"
        top = f"(1-1/{z})*(0.35+0.3*{e})"
        return [cover(q), _window(left, top, frac, interp)]
    if effect == "zoom_divino":
        e = _ease(n)
        z = f"(1+{round(amount * 1.5, 4)}*{e})"
        frac = f"1/{z}"
        left = f"(1-1/{z})/2"
        top = f"(1-1/{z})*0.4"  # un poco hacia arriba: mirada al cielo
        return [cover(q), _window(left, top, frac, interp), GLOW]
    if effect in ("zoom_lento_in", "zoom_lento_out"):
        z = f"(1+{amount}*in/{n})" if effect == "zoom_lento_in" else f"(1+{amount}-{amount}*in/{n})"
        frac = f"1/{z}"
        margin = f"(1-1/{z})/2"
        return [cover(q), _window(margin, margin, frac, interp)]
    if effect in ("ken_burns", "paneo_izquierda", "paneo_vertical"):
        frac = f"{1 / KEN_BURNS:.5f}"
        travel = f"{1 - 1 / KEN_BURNS:.5f}"
        if effect == "ken_burns":
            left, top = f"{travel}*in/{n}", f"{travel}/2"
        elif effect == "paneo_izquierda":
            left, top = f"{travel}*(1-in/{n})", f"{travel}/2"
        else:  # de abajo hacia arriba
            left, top = f"{travel}/2", f"{travel}*(1-in/{n})"
        return [cover(q), _window(left, top, frac, interp)]
    if effect == "zoom_rapido":
        # Golpe de cámara: se acerca en los primeros 0,4 s y se queda ahí.
        k = max(round(ZOOM_PUNCH_S * FPS), 1)
        p = f"min(in/{k},1)"
        z = f"(1+{round(ZOOM_PUNCH * motion, 4)}*({p}*{p}*(3-2*{p})))"
        margin = f"(1-1/{z})/2"
        return [cover(q), _window(margin, margin, f"1/{z}", interp)]
    if effect == "temblor":
        # Cámara en mano: un leve acercamiento deja margen para un vaivén irregular.
        amp = min(motion, 2.0)
        z = SHAKE_ZOOM
        margin = (1 - 1 / z) / 2
        left = f"{margin:.5f}+{0.007 * amp:.5f}*sin(in*0.7)+{0.005 * amp:.5f}*sin(in*2.1)"
        top = f"{margin:.5f}+{0.006 * amp:.5f}*sin(in*1.1+1)+{0.004 * amp:.5f}*sin(in*2.7)"
        return [cover(q), _window(left, top, f"{1 / z:.5f}", interp)]
    out = [cover(q)]
    if effect == "estatica":
        # Grano suave: el ruido fuerte cuadro a cuadro se veía como una vibración.
        out.append("noise=alls=14:allf=t,eq=saturation=0.6:contrast=1.05")
    elif effect == "glitch":
        out.append("rgbashift=rh=-8:bh=8,noise=alls=12:allf=t")
    elif effect == "fundido_negro":
        start = max(duration - 0.6, 0)
        out.append(f"fade=t=out:st={start:.2f}:d={min(0.6, duration):.2f}")
    elif effect == "fundido_entrada":
        out.append(f"fade=t=in:st=0:d={min(0.6, duration):.2f}")
    elif effect == "destello":
        out.append(f"fade=t=in:st=0:d={min(0.5, duration):.2f}:color=white")
    elif effect in COLOR_EFFECTS:
        out.append(COLOR_EFFECTS[effect])
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
    soften: float = 0.0,
    motion: float = 1.0,
    intermediate: bool = False,
    hardware: str | None = None,
) -> list[str]:
    """Comando de una escena. Con `intermediate` (el paso final vuelve a codificar por el
    texto, los subtítulos o el look) se codifica rápido y casi sin pérdida: la calidad la
    pone ese paso final y codificar dos veces con el preset lento solo sumaba tiempo."""
    frames = max(round(seg.duration * FPS), 1)
    dur = f"{frames / FPS:.3f}"
    args = ["ffmpeg", "-y", "-v", "error", "-nostdin"]
    speed = SPEED.get(seg.effect or "", 1.0) if seg.kind == "video" else 1.0
    if seg.kind == "image":
        args += ["-i", str(seg.path)]  # un solo cuadro: se repite con el filtro loop
    elif seg.kind == "video":
        read = frames / FPS * speed
        args += ["-ss", f"{seg.source_in:.3f}", "-t", f"{read:.3f}", "-i", str(seg.path)]
    else:
        args += ["-f", "lavfi", "-i", f"color=c=black:s={q.size}:r={FPS}:d={dur}"]

    chain: list[str] = []
    if seg.kind == "video":
        if speed > 1:
            chain += [f"fps={FPS}", f"setpts={1 / speed:g}*PTS"]
        elif speed < 1:  # a cámara lenta los cuadros se estiran: se igualan después
            chain += [f"setpts={1 / speed:g}*PTS", f"fps={FPS}"]
        else:
            chain.append(f"fps={FPS}")
    if seg.kind == "color":
        chain.append("setsar=1")
    else:
        motion_effect = None if seg.effect in SPEED else seg.effect
        effect = effect_filter(motion_effect, q, frames, frames / FPS, draft, motion)
        if seg.kind == "image":
            chain += still_chain(effect, frames, soften)
        else:
            chain += effect
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
        *encoder(q, intermediate, hardware),
        str(out),
    ]  # fmt: skip
    return args


HARDWARE_ENCODERS = ("h264_nvenc", "h264_qsv")  # NVIDIA e Intel Quick Sync, en ese orden


def encoder(q: Quality, intermediate: bool, hardware: str | None = None) -> list[str]:
    """Codificador de video: el de la GPU (`hardware`, si la calidad lo admite) o x264 con
    su preset; para un archivo intermedio que se vuelve a codificar, rápido y casi sin pérdida."""
    crf = max(q.crf - 6, 10) if intermediate else q.crf
    if hardware and q.hardware_ok:
        # Su escala de calidad rinde un poco menos que el CRF de x264: 2 puntos más fino.
        level = str(max(crf - 2, 10))
        cap_args: list[str] = []
        if q.max_bitrate_k:
            # Un tope de bitrate: sin él, su VBR («-b:v 0») puede disparar el peso del archivo
            # en escenas con mucho detalle o ruido. El intermedio se re-codifica después: con
            # menos techo alcanza (es solo de paso).
            cap = max(q.max_bitrate_k // 2, 1500) if intermediate else q.max_bitrate_k
            cap_args = ["-maxrate", f"{cap}k", "-bufsize", f"{cap * 2}k"]
        if hardware == "h264_nvenc":
            return [
                "-c:v", hardware, "-preset", "p4", "-rc", "vbr", "-cq", level,
                "-b:v", "0", *cap_args,
            ]  # fmt: skip
        return [
            "-c:v", hardware, "-preset", "medium", "-global_quality", level, *cap_args,
        ]  # fmt: skip
    preset = "veryfast" if intermediate else q.preset
    return ["-c:v", "libx264", "-preset", preset, "-crf", str(crf)]


def still_chain(effect: list[str], frames: int, soften: float = 0.0) -> list[str]:
    """Filtros de una foto: lo que no cambia con el tiempo (escalar la imagen original,
    suavizarla, el brillo difuso) se calcula una sola vez y el cuadro se repite con `loop`;
    después va el movimiento, ya en 4:2:0. Con `-loop 1` todo eso se recalculaba en cada
    cuadro y era lo más lento del render."""
    cover_step, rest = effect[0], effect[1:]
    still = [cover_step]
    if soften:
        # Look: las fotos, más nítidas que los videos de stock, se suavizan un poco.
        still.append(f"gblur=sigma={soften:g}")
    if GLOW in rest:  # el brillo de una foto quieta: igual antes que después del zoom
        rest.remove(GLOW)
        still.append(GLOW)
    still += [
        "scale=out_range=tv", "format=yuv420p",
        f"loop=loop={frames - 1}:size=1:start=0", f"settb=1/{FPS}", "setpts=N",
    ]  # fmt: skip
    return still + rest


@dataclass
class AudioClip:
    path: Path
    start: float
    duration: float
    loop: bool = False  # se repite hasta cubrir `duration` (audio de fondo)
    volume: float | None = None  # None: el de su pista (música 0,35; SFX 0,9)
    fade_in: float = 0.0  # entrada y salida suaves (SFX de las pistas manuales)
    fade_out: float = 0.0


def audio_filter(
    voice: AudioClip | None, sfx: list[AudioClip], music: list[AudioClip], first_input: int
) -> tuple[str, list[AudioClip]]:
    """Mezcla: voz + SFX en su tiempo + música a volumen fijo (sin ducking).
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
        if clip.loop and clip.duration > 4:  # fondo en bucle: entra y sale con suavidad
            chain.append("afade=t=in:st=0:d=1.5")
            chain.append(f"afade=t=out:st={clip.duration - 2:.3f}:d=2")
        elif fade and clip.duration > 2:
            chain.append(f"afade=t=out:st={clip.duration - 1:.3f}:d=1")
        if clip.fade_in > 0:
            chain.append(f"afade=t=in:st=0:d={min(clip.fade_in, clip.duration):.3f}")
        if clip.fade_out > 0:
            d = min(clip.fade_out, clip.duration)
            chain.append(f"afade=t=out:st={clip.duration - d:.3f}:d={d:.3f}")
        level = clip.volume if clip.volume is not None else volume
        chain += [f"volume={round(level, 3)}", f"adelay={ms}|{ms}[{label}]"]
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
        # Sin ducking: la música queda a su volumen fijo también mientras habla la voz.
        if voice_label:
            labels.append(voice_label)
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
