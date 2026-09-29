"""Look del video (clip de ajuste): filtros, estilos rápidos, LUT y suavizado de fotos."""

import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from guionaria_core.config import VideoLook
from guionaria_core.services.render import look as looks
from guionaria_core.services.render import plan
from guionaria_core.services.render.service import _effect

HAS_FFMPEG = shutil.which("ffmpeg") is not None


def identity_cube(path: Path, size: int = 2) -> Path:
    rows = [
        f"{r / (size - 1)} {g / (size - 1)} {b / (size - 1)}"
        for b in range(size)
        for g in range(size)
        for r in range(size)
    ]
    path.write_text(f"LUT_3D_SIZE {size}\n" + "\n".join(rows) + "\n", encoding="utf-8")
    return path


def test_neutral_look_changes_nothing():
    assert looks.look_filter(VideoLook()) is None
    assert looks.soften_sigma(VideoLook()) == 0


def test_crimen_preset_filters():
    crimen = looks.preset("crimen")
    assert (crimen.preset, crimen.saturation, crimen.zoom_photos) == ("crimen", 40, True)
    chain = looks.look_filter(crimen)
    assert chain == (
        "eq=contrast=1.2:saturation=0.4:gamma=0.85,"
        "colorlevels=rimin=0.06:gimin=0.06:bimin=0.06,"
        "colorbalance=rs=-0.12:gs=0.032:bs=0.144:rm=-0.04:gm=0.008:bm=0.048,"
        "vignette=angle=0.925,format=yuv420p,noise=c0s=10:c0f=t"
    )
    assert looks.soften_sigma(crimen) == 0.45
    warm = looks.look_filter(VideoLook(temperature=50))
    assert warm == "colorbalance=rs=0.075:gs=0.025:bs=-0.075:rm=0.03:gm=0.01:bm=-0.03"
    with pytest.raises(looks.DomainError):
        looks.preset("marciano")


def test_lut_full_or_mixed():
    assert looks.look_filter(VideoLook(lut="a.cube"), "look.cube") == "lut3d=file=look.cube"
    mixed = looks.look_filter(VideoLook(lut="a.cube", lut_strength=40, saturation=50), "look.cube")
    assert mixed.startswith(
        "split[lo][lb];[lb]lut3d=file=look.cube[ll];[lo][ll]blend=all_opacity=0.4"
    )
    assert mixed.endswith(",eq=saturation=0.5")


def test_photos_are_softened_and_zoomed():
    q = plan.quality(1080, 1920, "standard")
    img = plan.Segment(1, 2.0, "image", Path("a.jpg"), 0, None, None)
    vf = plan.segment_command(img, q, Path("s.mp4"), None, None, soften=0.45)
    assert f"{plan.cover(q)},gblur=sigma=0.45" in vf[vf.index("-vf") + 1]
    vid = plan.Segment(2, 2.0, "video", Path("b.mp4"), 0, None, None)
    vf = plan.segment_command(vid, q, Path("s.mp4"), None, None, soften=0.45)
    assert "gblur" not in vf[vf.index("-vf") + 1]  # los videos no
    zoom = VideoLook(zoom_photos=True)
    assert _effect(None, "image", zoom) == "zoom_lento_in"
    assert _effect("ninguno", "image", zoom) == "zoom_lento_in"
    assert _effect("ken_burns", "image", zoom) == "ken_burns"  # el elegido se respeta
    assert _effect(None, "video", zoom) is None
    assert _effect(None, "image", VideoLook()) is None


def test_import_and_list_luts(client, tmp_path):
    good = identity_cube(tmp_path / "Mi LUT (frío).cube")
    with good.open("rb") as fh:
        resp = client.post("/api/looks/luts:upload", files={"file": ("Mi LUT (frío).cube", fh)})
    assert resp.json() == {"luts": ["Mi_LUT_frío.cube"], "imported": "Mi_LUT_frío.cube"}
    bad = tmp_path / "x.cube"
    bad.write_text("no soy un lut", encoding="utf-8")
    with bad.open("rb") as fh:
        resp = client.post("/api/looks/luts:upload", files={"file": ("x.cube", fh)})
    assert resp.status_code == 400 and "LUT 3D" in resp.json()["detail"]
    with bad.open("rb") as fh:
        resp = client.post("/api/looks/luts:upload", files={"file": ("x.png", fh)})
    assert ".cube" in resp.json()["detail"]
    assert client.get("/api/looks/luts").json()["luts"] == ["Mi_LUT_frío.cube"]


@pytest.mark.skipif(not HAS_FFMPEG, reason="requiere FFmpeg")
def test_filters_run_in_ffmpeg(tmp_path):
    identity_cube(tmp_path / "look.cube")
    Image.new("RGB", (64, 64), (200, 40, 40)).save(tmp_path / "in.png")

    def run(look: VideoLook) -> tuple[int, int, int]:
        chain = looks.look_filter(look, "look.cube" if look.lut else None)
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", "in.png", "-vf", chain, "out.png"],
            cwd=tmp_path,
            check=True,
        )
        return Image.open(tmp_path / "out.png").convert("RGB").getpixel((32, 32))

    run(looks.preset("crimen"))
    r, g, b = run(looks.preset("byn"))
    assert abs(r - g) < 12 and abs(g - b) < 12  # blanco y negro: el rojo queda gris
    # LUT identidad al 50 %: el color casi no cambia.
    r, g, b = run(VideoLook(lut="x.cube", lut_strength=50))
    assert abs(r - 200) < 8 and abs(g - 40) < 8


def test_presets_match_the_app():
    """Los estilos rápidos de la vista previa (previewMeta.ts) usan los mismos valores."""
    import re

    ts = (
        Path(__file__).resolve().parents[2] / "apps/desktop/src/features/timeline/previewMeta.ts"
    ).read_text(encoding="utf-8")
    block = ts[ts.index("export const LOOK_PRESETS") : ts.index("export const presetLook")]
    for name, values in looks.LOOK_PRESETS.items():
        m = re.search(rf'id: "{name}",.*?look: \{{(.*?)\}}', block, re.S)
        assert m, name
        found = dict(re.findall(r'(\w+): (-?\d+|true|false|"[^"]*")', m.group(1)))
        expected = {
            k: f'"{v}"' if isinstance(v, str) else str(v).lower() for k, v in values.items()
        }
        assert found == expected, name
