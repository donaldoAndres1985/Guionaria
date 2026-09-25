"""Convención de nombres de archivos (sección 9 de SPEC.md).

Aprobados: {escena:03d}_{inicio_mmss}_{tipo}_{slug}[_{variante}].{ext}
Candidatos: candidates/{escena:03d}_{proveedor}_{id}.{ext}
"""

from ...models import Scene
from ...schemas.scene import TIPO_FROM_KIND
from ...util.slug import slugify


def mmss_compact(seconds: float | None) -> str:
    s = int(seconds or 0)
    return f"{s // 60:02d}{s % 60:02d}"


def scene_slug(scene: Scene) -> str:
    source = scene.query_real if scene.media_kind == "real" else scene.query_en
    return slugify(source or scene.visual_description or f"escena-{scene.position}")


def approved_name(scene: Scene, ext: str, alt_index: int | None = None) -> str:
    variant = f"_alt{alt_index}" if alt_index else ""
    tipo = TIPO_FROM_KIND.get(scene.media_kind, scene.media_kind)
    start = mmss_compact(scene.start_s)
    return f"{scene.position:03d}_{start}_{tipo}_{scene_slug(scene)}{variant}{ext}"


def candidate_name(scene: Scene, provider: str, provider_id: str, ext: str) -> str:
    return f"{scene.position:03d}_{provider}_{provider_id}{ext}"
