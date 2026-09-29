"""«Look» del video (clip de ajuste): corrección de color común, viñeta, grano y LUT.

Se aplica en el paso final sobre el video ya unido, antes de escribir el texto en pantalla y
los subtítulos, así estos quedan fuera. Suavizar las fotos y el zoom lento en fotos se aplican
al codificar cada escena de foto.
"""

import re
import shutil
from pathlib import Path

from ...config import VideoLook, get_paths
from ..errors import DomainError, NotFound

# Estilos rápidos (los mismos en la app: previewMeta LOOK_PRESETS).
LOOK_PRESETS: dict[str, dict] = {
    "none": {},
    "crimen": {
        "saturation": 40, "contrast": 20, "brightness": -15, "blacks": 60, "temperature": -80,
        "vignette": 75, "grain": 40, "soften_photos": 30, "zoom_photos": True,
    },
    "documental": {
        "saturation": 75, "contrast": 10, "blacks": 30, "temperature": -20, "vignette": 40,
        "grain": 20, "soften_photos": 20, "zoom_photos": True,
    },
    "nostalgico": {
        "saturation": 80, "contrast": 5, "brightness": 5, "blacks": 20, "temperature": 60,
        "vignette": 50, "grain": 45, "soften_photos": 20, "zoom_photos": True,
    },
    "byn": {
        "saturation": 0, "contrast": 25, "brightness": -5, "blacks": 50, "vignette": 60,
        "grain": 50, "soften_photos": 20, "zoom_photos": True,
    },
    "vivo": {"saturation": 125, "contrast": 10, "brightness": 5, "temperature": 10},
    "celestial": {
        "saturation": 105, "contrast": 5, "brightness": 8, "temperature": 35, "vignette": 30,
        "grain": 10, "soften_photos": 25, "zoom_photos": True, "photo_effect": "zoom_divino",
        "motion": 160,
    },
}  # fmt: skip

LUT_EXT = ".cube"
LUT_NAME = "look.cube"  # copia local en la carpeta temporal del render (sin escapar rutas)


def preset(name: str) -> VideoLook:
    if name not in LOOK_PRESETS:
        raise DomainError(f"Estilo desconocido: {name}")
    return VideoLook(preset=name, **LOOK_PRESETS[name])


def _num(v: float) -> str:
    return f"{v:.3f}".rstrip("0").rstrip(".") or "0"


def look_filter(look: VideoLook, lut: str | None = None) -> str | None:
    """Filtros del clip de ajuste, o None si no cambia nada. `lut`: archivo .cube ya copiado
    junto al render (se mezcla con `lut_strength`)."""
    parts: list[str] = []
    if lut:
        if look.lut_strength >= 100:
            parts.append(f"lut3d=file={lut}")
        elif look.lut_strength > 0:
            mix = _num(look.lut_strength / 100)
            parts.append(f"split[lo][lb];[lb]lut3d=file={lut}[ll];[lo][ll]blend=all_opacity={mix}")
    eq = []
    if look.contrast:
        eq.append(f"contrast={_num(1 + look.contrast / 100)}")
    if look.saturation != 100:
        eq.append(f"saturation={_num(look.saturation / 100)}")
    if look.brightness:
        eq.append(f"gamma={_num(1 + look.brightness / 100)}")
    if eq:
        parts.append("eq=" + ":".join(eq))
    if look.blacks:
        low = _num(look.blacks / 1000)
        parts.append(f"colorlevels=rimin={low}:gimin={low}:bimin={low}")
    if look.temperature:
        k = abs(look.temperature) / 100
        if look.temperature < 0:  # frío: azul/verde en sombras y un poco en medios
            vals = {"rs": -0.15, "gs": 0.04, "bs": 0.18, "rm": -0.05, "gm": 0.01, "bm": 0.06}
        else:  # cálido
            vals = {"rs": 0.15, "gs": 0.05, "bs": -0.15, "rm": 0.06, "gm": 0.02, "bm": -0.06}
        parts.append("colorbalance=" + ":".join(f"{c}={_num(v * k)}" for c, v in vals.items()))
    if look.vignette:
        parts.append(f"vignette=angle={_num(0.25 + 0.009 * look.vignette)}")
    if look.grain:
        # Solo en la luminancia (grano de película, sin motas de color): en YUV el plano 0
        # es la luminancia; colorlevels deja la imagen en RGB, por eso se convierte antes.
        parts.append(f"format=yuv420p,noise=c0s={max(round(look.grain * 0.25), 1)}:c0f=t")
    return ",".join(parts) or None


def soften_sigma(look: VideoLook | None) -> float:
    """Desenfoque suave para las fotos (gblur sigma)."""
    return round((look.soften_photos if look else 0) / 100 * 1.5, 3)


def luts_dir() -> Path:
    return get_paths().home / "luts"


def list_luts() -> list[str]:
    folder = luts_dir()
    if not folder.exists():
        return []
    return sorted(p.name for p in folder.iterdir() if p.suffix.lower() == LUT_EXT)


def lut_path(name: str) -> Path:
    path = luts_dir() / Path(name).name
    if path.suffix.lower() != LUT_EXT or not path.exists():
        raise NotFound(f"No está el LUT {name}: impórtalo de nuevo")
    return path


def import_lut(source: Path, name: str) -> str:
    """Guarda un .cube en la carpeta luts/ (con un nombre simple) y devuelve su nombre."""
    if Path(name).suffix.lower() != LUT_EXT:
        raise DomainError("El LUT debe ser un archivo .cube")
    head = source.read_text(encoding="utf-8", errors="replace")[:4000]
    if "LUT_3D_SIZE" not in head:
        raise DomainError("El archivo no parece un LUT 3D (.cube) válido")
    stem = re.sub(r"[^\w\-]+", "_", Path(name).stem).strip("_") or "lut"
    folder = luts_dir()
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{stem}{LUT_EXT}"
    shutil.copyfile(source, target)
    return target.name
