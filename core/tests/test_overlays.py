"""Edición del timeline como en CapCut: pistas manuales (textos con formato y SFX), efecto de
cada escena y duración de la transición de cada corte."""

import shutil
import subprocess

import pytest
from PIL import Image
from sqlmodel import Session

from guionaria_core.config import SubtitleStyle
from guionaria_core.db import get_engine
from guionaria_core.models import Project, Sound
from guionaria_core.schemas.overlay import TextOverlayStyle
from guionaria_core.schemas.scene import EFFECTS
from guionaria_core.services.render import captions, plan
from guionaria_core.services.timeline.model import OverlayText
from tests.conftest import wait_job
from tests.media_support import downloaded
from tests.test_sounds import import_sound
from tests.test_voice import engines_fake  # noqa: F401  (fixture)

HAS_FFMPEG = shutil.which("ffmpeg") is not None


def tracks_url(pid):
    return f"/api/projects/{pid}/overlay-tracks"


def add_item(client, track_id, **body):
    return client.post(f"/api/overlay-tracks/{track_id}/items", json=body)


def set_status(pid, status):
    with Session(get_engine()) as s:
        s.get(Project, pid).status = status
        s.commit()


# --- pistas y textos ---


def test_text_tracks_items_and_preview(client, media_project):
    pid = media_project["id"]
    t1 = client.post(tracks_url(pid), json={"kind": "text"}).json()
    assert (t1["name"], t1["kind"], t1["items"]) == ("Texto 1", "text", [])
    t2 = client.post(tracks_url(pid), json={"kind": "text"}).json()
    assert t2["name"] == "Texto 2" and t2["position"] > t1["position"]
    renamed = client.patch(f"/api/overlay-tracks/{t2['id']}", json={"name": "Títulos"}).json()
    assert renamed["name"] == "Títulos"

    empty = add_item(client, t1["id"], start_s=0, duration_s=2, text="   ")
    assert empty.status_code == 400 and "Escribe el texto" in empty.json()["detail"]
    bad = add_item(client, t1["id"], start_s=0, duration_s=2, text="x", style={"color": "rojo"})
    assert bad.status_code == 422
    item = add_item(
        client,
        t1["id"],
        start_s=0.5,
        duration_s=2,
        text="Caso Priscila",
        style={"color": "#FF0000", "size": 90, "animation_in": "pop", "shadow": True},
    ).json()
    assert item["style"]["color"] == "#FF0000" and item["style"]["font"] == "Montserrat"
    assert item["style"]["animation_out"] == "fade"  # lo no enviado queda por defecto

    moved = client.patch(
        f"/api/overlay-items/{item['id']}",
        json={"start_s": 1.0, "duration_s": 1.5, "track_id": t2["id"]},
    ).json()
    assert (moved["start_s"], moved["duration_s"], moved["track_id"]) == (1.0, 1.5, t2["id"])
    assert client.patch(f"/api/overlay-items/{item['id']}", json={}).status_code == 422
    dup = client.post(f"/api/overlay-items/{item['id']}:duplicate").json()
    assert (dup["start_s"], dup["text"], dup["track_id"]) == (2.5, "Caso Priscila", t2["id"])
    add_item(client, t1["id"], start_s=0, duration_s=1, text="Arriba")
    add_item(client, t1["id"], start_s=500, duration_s=1, text="Después del final")

    state = client.get(f"/api/projects/{pid}/timeline").json()
    assert state["editable"] is True
    assert [t["name"] for t in state["overlay_tracks"]] == ["Texto 1", "Títulos"]
    assert [i["text"] for i in state["overlay_tracks"][1]["items"]] == ["Caso Priscila"] * 2
    preview = client.get(f"/api/projects/{pid}/timeline/preview").json()
    # Lo que empieza después del final del video no se muestra; la pista de arriba va encima.
    shown = {(o["text"], o["layer"]) for o in preview["overlays"]}
    assert shown == {("Arriba", 2), ("Caso Priscila", 1)}
    assert len(preview["overlays"]) == 3
    assert preview["overlays"][0]["style"]["animation_in"] in ("pop", "fade")

    assert client.delete(f"/api/overlay-items/{dup['id']}").status_code == 204
    assert client.delete(f"/api/overlay-tracks/{t2['id']}").status_code == 204
    assert [t["id"] for t in client.get(tracks_url(pid)).json()] == [t1["id"]]
    assert client.patch(f"/api/overlay-items/{item['id']}", json={"start_s": 1}).status_code == 404


def test_sfx_items_volume_fades_credits_and_sound_guard(client, media_project, tmp_path):
    pid = media_project["id"]
    hit = import_sound(client, tmp_path, "golpe seco", "sfx", 0.8)
    with Session(get_engine()) as s:
        sound = s.get(Sound, hit["id"])
        sound.author, sound.license = "Autora Sonido", "CC0"
        s.commit()
    track = client.post(tracks_url(pid), json={"kind": "sfx"}).json()
    assert track["name"] == "Efectos 1"
    missing = add_item(client, track["id"], start_s=1, duration_s=1)
    assert missing.status_code == 400 and "efecto de sonido" in missing.json()["detail"]
    item = add_item(
        client,
        track["id"],
        start_s=1,
        duration_s=5,
        sound_id=hit["id"],
        volume=150,
        fade_in_s=0.1,
        fade_out_s=0.2,
    ).json()
    assert item["duration_s"] == 0.8  # el sonido no se repite: dura lo que el archivo
    assert (item["sound_title"], item["sound_duration_s"]) == ("golpe seco", 0.8)

    text_track = client.post(tracks_url(pid), json={"kind": "text"}).json()
    text = add_item(client, text_track["id"], start_s=0, duration_s=1, text="hola").json()
    wrong = client.patch(f"/api/overlay-items/{text['id']}", json={"track_id": track["id"]})
    assert wrong.status_code == 400 and "mismo tipo" in wrong.json()["detail"]

    state = client.get(f"/api/projects/{pid}/timeline").json()
    assert state["sfx"] == []  # la pista de SFX de las escenas no cambia
    preview = client.get(f"/api/projects/{pid}/timeline/preview").json()
    [sfx] = preview["sfx"]
    assert (sfx["start_s"], sfx["duration_s"], sfx["volume"]) == (1.0, 0.8, 1.35)
    assert (sfx["fade_in_s"], sfx["fade_out_s"]) == (0.1, 0.2)

    credits = client.get(f"/api/projects/{pid}/rights").json()["credits"]
    assert "«golpe seco» — Autora Sonido — CC0" in credits
    blocked = client.delete(f"/api/sounds/{hit['id']}")
    assert blocked.status_code == 409 and "pista del timeline" in blocked.json()["detail"]


def test_scene_effect_and_cut_duration_from_timeline(client, media_project):
    pid = media_project["id"]
    video, *_ = media_project["scenes"]
    assert client.put(f"/api/scenes/{video}/effect", json={"effect": "temblor"}).json() == {
        "scene_id": video,
        "effect": "temblor",
    }
    bad = client.put(f"/api/scenes/{video}/effect", json={"effect": "inventado"})
    assert bad.status_code == 400
    assert client.get(f"/api/projects/{pid}/timeline").json()["scenes"][0]["effect"] == "temblor"
    preview = client.get(f"/api/projects/{pid}/timeline/preview").json()
    assert preview["scenes"][0]["effect"] == "temblor"

    client.put(f"/api/projects/{pid}/transitions", json={"default": "fade", "duration": 0.3})
    cut = client.put(f"/api/scenes/{video}/transition", json={"duration_s": 0.6}).json()["cuts"][0]
    assert (cut["chosen"], cut["chosen_s"], cut["duration_s"]) == (None, 0.6, 0.6)
    cut = client.put(f"/api/scenes/{video}/transition", json={"transition": "wipeleft"}).json()
    assert (cut["cuts"][0]["chosen"], cut["cuts"][0]["chosen_s"]) == ("wipeleft", 0.6)
    reset = client.put(f"/api/projects/{pid}/transitions", json={"reset_cuts": True}).json()
    assert (reset["cuts"][0]["chosen"], reset["cuts"][0]["chosen_s"]) == (None, None)


def test_timeline_edits_blocked_once_scheduled(client, media_project):
    pid = media_project["id"]
    track = client.post(tracks_url(pid), json={"kind": "text"}).json()
    set_status(pid, "PROGRAMADO")
    assert client.post(tracks_url(pid), json={"kind": "text"}).status_code == 409
    assert add_item(client, track["id"], start_s=0, duration_s=1, text="x").status_code == 409
    effect = client.put(f"/api/scenes/{media_project['scenes'][0]}/effect", json={"effect": "vhs"})
    assert effect.status_code == 409
    assert client.get(f"/api/projects/{pid}/timeline").json()["editable"] is False


def test_track_limit(client, media_project):
    pid = media_project["id"]
    for _ in range(12):
        assert client.post(tracks_url(pid), json={"kind": "sfx"}).status_code == 200
    too_many = client.post(tracks_url(pid), json={"kind": "text"})
    assert too_many.status_code == 400 and "12 pistas" in too_many.json()["detail"]


# --- texto en el ASS del render (sin FFmpeg) ---


def overlay(start, end, text, layer=0, **style):
    return OverlayText(start, end, text, TextOverlayStyle(**style).model_dump(), layer)


def dialogues(ass):
    return [line for line in ass.splitlines() if line.startswith("Dialogue")]


def test_overlay_wrapping_like_the_preview():
    assert captions.wrap_overlay("uno dos tres cuatro", 9) == ["uno dos", "tres", "cuatro"]
    assert captions.wrap_overlay("línea uno\n\nlínea dos\n", 40) == ["línea uno", "", "línea dos"]
    assert captions.overlay_chars(1080, 72, 90, 0) == 24
    assert captions.overlay_chars(1080, 72, 90, 10) == 19


def test_overlay_ass_layers_animations_and_anchor():
    o = overlay(
        1.0,
        3.0,
        "Hola mundo",
        layer=2,
        shadow=True,
        rotation=10,
        animation_in="slide_up",
        animation_out="zoom",
        animation_s=0.5,
        align="left",
        x=0.1,
        y=0.2,
    )
    ass = captions.build_ass([], SubtitleStyle(), 1080, 1920, overlays=[o])
    assert "Style: Overlay," in ass and "Style: OverlayBox," in ass
    lines = dialogues(ass)
    assert len(lines) == 6  # entrada, quieto y salida; cada una con sombra y texto
    assert {line.split(",")[0] for line in lines} == {"Dialogue: 16", "Dialogue: 17"}
    shadow, text = lines[0], lines[1]
    assert r"\1a&HFE&" in shadow and r"\shad4" in shadow and r"\blur2" in shadow
    assert r"\1c&H0000FF&" not in text and r"\shad0" in text
    assert r"\an4" in text and r"\frz-10" in text and r"\q2" in text
    # Entra desde abajo (8 % del alto) hasta su sitio y sale encogiéndose.
    assert r"\move(108,538,108,384,0,500)" in text
    assert r"\t(0,500,2,\fscx20\fscy20)\fad(0,500)" in lines[5]
    assert "0:00:01.00,0:00:01.50" in lines[0] and "0:00:02.50,0:00:03.00" in lines[4]


def test_overlay_box_typewriter_and_scale():
    boxed = overlay(0, 2, "Caja", background=True, background_color="#FFCC00")
    lines = dialogues(captions.build_ass([], SubtitleStyle(), 1080, 1920, overlays=[boxed]))
    assert all(",OverlayBox," in line for line in lines) and len(lines) == 3
    assert r"\3c&H00CCFF&" in lines[0]
    typed = overlay(0, 4, "Letra a letra", animation_in="typewriter", animation_out="none")
    lines = dialogues(captions.build_ass([], SubtitleStyle(), 1080, 1920, overlays=[typed]))
    assert len(lines) == 13 + 1  # 13 pasos (uno por carácter) y el resto quieto
    assert r"{\alpha&HFF&}" in lines[0]
    # En el borrador (720 de ancho) todo se escala: tamaño, borde y posición.
    draft = [overlay(0, 2, "x", size=90)]
    small = dialogues(
        captions.build_ass([], SubtitleStyle(), 720, 1280, overlays=draft, overlay_scale=720 / 1080)
    )[0]
    assert r"\pos(360,640)" in small and r"\bord2.7" in small


# --- efectos nuevos ---


def test_new_effect_filters_and_speed():
    q = plan.quality(1080, 1920, False)
    fx = lambda name: ",".join(plan.effect_filter(name, q, 60, 2.0))  # noqa: E731
    assert "hue=s=0" in fx("blanco_negro")
    assert "fade=t=in:st=0:d=0.50:color=white" in fx("destello")
    assert "fade=t=in:st=0:d=0.60" in fx("fundido_entrada")
    assert fx("cinematico").count("drawbox") == 2
    assert "sin(in*0.7)" in fx("temblor")
    assert "x0='W*(0.07407*(1-in/59))'" in fx("paneo_izquierda")
    assert "y0='H*(0.07407*(1-in/59))'" in fx("paneo_vertical")
    assert "min(in/12,1)" in fx("zoom_rapido")
    slow = plan.Segment(2, 1.5, "video", "b.mp4", 3.0, "camara_lenta", None)
    args = plan.segment_command(slow, q, "s.mp4", None, None)
    assert args[args.index("-t") + 1] == "0.750"  # se lee la mitad del metraje
    assert args[args.index("-vf") + 1].startswith("setpts=2*PTS,fps=30,")


@pytest.mark.skipif(not HAS_FFMPEG, reason="requiere ffmpeg")
@pytest.mark.parametrize("effect", EFFECTS)
def test_every_effect_renders_with_ffmpeg(tmp_path, effect):
    jpg = tmp_path / "f.jpg"
    Image.new("RGB", (320, 180), (120, 80, 40)).save(jpg)
    q = plan.quality(1080, 1920, "draft")
    out = tmp_path / "s.mp4"
    seg = plan.Segment(1, 0.5, "image", jpg, 0, effect, None)
    subprocess.run(plan.segment_command(seg, q, out, None, None, draft=True), check=True)
    assert out.stat().st_size > 0


# --- render completo con pistas manuales ---


def red_pixels(path):
    with Image.open(path) as im:
        pixels = im.convert("RGB").get_flattened_data()
        return sum(1 for r, g, b in pixels if r > 200 and g < 50 and b < 50)


@pytest.mark.skipif(not HAS_FFMPEG, reason="requiere ffmpeg")
def test_render_with_manual_text_and_sfx(client, media_project, web, engines_fake, tmp_path):  # noqa: F811
    pid = media_project["id"]
    video, image, real, _text = media_project["scenes"]
    clip = tmp_path / "negro.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=640x360:r=30",
         "-t", "3", "-pix_fmt", "yuv420p", str(clip)],
        check=True,
    )  # fmt: skip
    client.post(f"/api/scenes/{video}/assets:import", json={"path": str(clip)})
    for scene in (image, real):
        [a, *_] = downloaded(client, scene)
        client.post(f"/api/scenes/{scene}/assets/{a['id']}:approve")
    assert client.post(f"/api/projects/{pid}/media:approve").status_code == 200
    wait_job(client, client.post(f"/api/projects/{pid}/voice:generate", json={}).json()["id"])
    client.put(f"/api/scenes/{image}/effect", json={"effect": "cinematico"})

    text_track = client.post(tracks_url(pid), json={"kind": "text"}).json()
    add_item(
        client,
        text_track["id"],
        start_s=0.5,
        duration_s=2.0,
        text="ROJO",
        style={"color": "#FF0000", "size": 220, "outline": False, "animation_in": "none"},
    )
    hit = import_sound(client, tmp_path, "golpe", "sfx", 0.6)
    sfx_track = client.post(tracks_url(pid), json={"kind": "sfx"}).json()
    add_item(client, sfx_track["id"], start_s=1.0, duration_s=0.6, sound_id=hit["id"])

    job = wait_job(
        client,
        client.post(
            f"/api/projects/{pid}/render", json={"draft": True, "burn_subtitles": False}
        ).json()["id"],
        timeout=240,
    )
    assert job["status"] == "done", job["error"]
    files = {f["kind"]: f for f in client.get(f"/api/projects/{pid}/render").json()["files"]}
    out = tmp_path / "borrador.mp4"
    out.write_bytes(client.get(files["draft"]["url"]).content)
    frames = {}
    for t in (0.2, 1.5):
        frame = tmp_path / f"c{t}.png"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", str(out), "-frames:v", "1",
             str(frame)],
            check=True,
        )  # fmt: skip
        frames[t] = red_pixels(frame)
    assert frames[0.2] < 50 < frames[1.5]  # el texto rojo solo aparece en su tramo
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0",
         str(out)],
        capture_output=True, text=True, check=True,
    ).stdout.split()  # fmt: skip
    assert sorted(probe) == ["audio", "video"]
