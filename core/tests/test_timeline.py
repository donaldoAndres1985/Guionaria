import xml.etree.ElementTree as ET
from pathlib import Path

import opentimelineio as otio

from guionaria_core.services.timeline.model import Clip, Marker, SceneSpan, TimelineModel
from guionaria_core.services.timeline.writers import timecode, to_edl, to_fcpxml, to_otio
from tests.conftest import wait_job
from tests.media_support import downloaded, status_of
from tests.test_voice import engines_fake  # noqa: F401  (fixture)


def turl(pid, suffix=""):
    return f"/api/projects/{pid}/timeline{suffix}"


def approve_all_media(client, media_project):
    video, image, real, _text = media_project["scenes"]
    for scene in (video, image, real):
        [asset, *_] = downloaded(client, scene)
        client.post(f"/api/scenes/{scene}/assets/{asset['id']}:approve")
    assert client.post(f"/api/projects/{media_project['id']}/media:approve").status_code == 200


def generate_voice(client, pid):
    job = client.post(f"/api/projects/{pid}/voice:generate", json={}).json()
    assert wait_job(client, job["id"])["status"] == "done"


def timeline_dir(home):
    [folder] = (home / "channels" / "casos-reales" / "projects").iterdir()
    return folder / "timeline"


def test_export_requires_approved_media(client, media_project, web):
    pid = media_project["id"]
    state = client.get(turl(pid)).json()
    assert state["can_export"] is False
    assert state["reason"] == "Aprueba los medios antes de exportar el timeline"
    assert len(state["scenes"]) == 4  # la vista previa funciona igual
    resp = client.post(turl(pid, ":export"), json={})
    assert resp.status_code == 409


def test_export_without_voice_warns_and_keeps_status(client, media_project, web, home):
    pid = media_project["id"]
    approve_all_media(client, media_project)
    result = client.post(turl(pid, ":export"), json={}).json()
    assert result["files"] == ["proyecto.otio", "proyecto.fcpxml", "proyecto.edl"]
    assert any("no tiene voz" in w for w in result["warnings"])
    assert status_of(client, pid) == "MEDIOS_APROBADOS"
    for name in result["files"]:
        assert (timeline_dir(home) / name).exists()
    assert [e["format"] for e in result["state"]["exports"]] == ["otio", "fcpxml", "edl"]

    only = client.post(turl(pid, ":export"), json={"formats": ["edl"]}).json()
    assert only["files"] == ["proyecto.edl"]
    assert client.post(turl(pid, ":export"), json={"formats": ["mp4"]}).status_code == 422


def test_timeline_with_voice(client, media_project, web, engines_fake, home):  # noqa: F811
    pid = media_project["id"]
    approve_all_media(client, media_project)
    generate_voice(client, pid)
    assert status_of(client, pid) == "VOZ_LISTA"

    state = client.get(turl(pid)).json()
    assert state["can_export"] is True
    assert (state["width"], state["height"], state["fps"]) == (1080, 1920, 30)
    assert state["has_voice"] is True
    assert state["duration_s"] == 4.9  # 4 segmentos de 1 s + 3 pausas de 0,3 s
    # Continuo: cada escena dura hasta el inicio de la siguiente (las pausas no dejan negro).
    assert [(s["start_s"], s["duration_s"]) for s in state["scenes"]] == [
        (0.0, 1.3),
        (1.3, 1.3),
        (2.6, 1.3),
        (3.9, 1.0),
    ]
    assert [s["kind"] for s in state["scenes"]] == ["video", "image", "real", "text"]
    assert state["scenes"][3]["file_name"] is None  # el texto se arma en el editor
    assert state["scenes"][1]["thumb_url"].startswith("/api/assets/")
    assert state["markers"][3]["name"] == "Escena 4 · texto"
    assert state["markers"][3]["note"] == "Texto: «SIN RESPUESTA»"
    assert state["markers"][3]["color"] == "BLUE"

    result = client.post(turl(pid, ":export"), json={}).json()
    assert status_of(client, pid) == "TIMELINE_LISTO"
    folder = timeline_dir(home)

    # OTIO: se vuelve a leer con la librería oficial.
    tl = otio.adapters.read_from_file(str(folder / "proyecto.otio"))
    video, voice = tl.tracks
    assert (video.name, voice.name) == ("Video", "Voz")
    clips = list(video.find_clips())
    assert len(clips) == 3
    assert video.duration().to_frames() == 147  # 4,9 s a 30 cuadros/s
    assert [c.range_in_parent().start_time.to_frames() for c in clips] == [0, 39, 78]
    assert clips[0].media_reference.target_url.startswith("file:///")
    assert len(video.markers) == 4
    [voz] = voice.find_clips()
    assert voz.duration().to_frames() == 147

    # FCPXML: la línea principal suma la duración de la secuencia.
    root = ET.parse(folder / "proyecto.fcpxml").getroot()
    assert root.get("version") == "1.9"
    fmt = root.find("resources/format")
    assert (fmt.get("width"), fmt.get("height"), fmt.get("frameDuration")) == (
        "1080",
        "1920",
        "1/30s",
    )
    sequence = root.find("library/event/project/sequence")
    assert sequence.get("duration") == "147/30s"
    spine = list(sequence.find("spine"))
    assert [el.tag for el in spine] == ["asset-clip", "video", "video", "gap"]
    frames = lambda v: 0 if v == "0s" else int(v.split("/")[0])  # noqa: E731
    assert sum(frames(el.get("duration")) for el in spine) == 147
    voice_el = spine[0].find("asset-clip")
    assert (voice_el.get("lane"), voice_el.get("name")) == ("-1", "Voz")
    assert len(root.findall(".//marker")) == 4
    assert spine[3].find("marker").get("note") == "Texto: «SIN RESPUESTA»"
    srcs = [r.get("src") for r in root.findall("resources/asset/media-rep")]
    assert all(s.startswith("file:///") for s in srcs) and len(srcs) == 4

    # EDL: negro en la escena de texto y la voz al final.
    edl = (folder / "proyecto.edl").read_text(encoding="utf-8")
    assert edl.startswith("TITLE: EL SECUESTRO\nFCM: NON-DROP FRAME")
    assert "004  BL       V     C        00:00:00:00 00:00:01:00 00:00:03:27 00:00:04:27" in edl
    assert "005  AX       A     C        00:00:00:00 00:00:04:27 00:00:00:00 00:00:04:27" in edl
    assert edl.count("* LOC:") == 4

    leeme = (folder.parent / "LEEME.txt").read_text(encoding="utf-8")
    assert "Escenas (tiempos reales de la voz):" in leeme
    assert "Archivo → Importar → Timeline" in leeme
    assert result["warnings"] == []


def test_voice_stale_after_timeline_keeps_export_possible(client, media_project, web, engines_fake):  # noqa: F811
    pid = media_project["id"]
    approve_all_media(client, media_project)
    generate_voice(client, pid)
    client.post(turl(pid, ":export"), json={})
    generate_voice(client, pid)  # regenerar la voz no rompe el estado
    assert status_of(client, pid) == "TIMELINE_LISTO"
    assert client.post(turl(pid, ":export"), json={}).status_code == 200


# --- escritores con un modelo armado a mano ---


def model(tmp: Path) -> TimelineModel:
    img = Clip("a.jpg", tmp / "a.jpg", "image", 0, 60, scene_position=1)
    vid = Clip(
        "b.mp4", tmp / "b.mp4", "video", 60, 45, source_in=15, media_duration=60, scene_position=2
    )
    voice = Clip("Voz", tmp / "voz.wav", "audio", 0, 150, 0, 150)
    return TimelineModel(
        title="Caso ñandú",
        fps=30,
        width=1920,
        height=1080,
        duration=150,
        scenes=[
            SceneSpan(1, "image", 0, 60, img, None, 1),
            SceneSpan(2, "video", 60, 60, vid, None, 2),  # el video se queda corto
            SceneSpan(3, "black", 120, 30, None, None, None),
        ],
        voice=voice,
        markers=[
            Marker(0, "Escena 1 · imagen", "Efecto: zoom_lento_in", "ORANGE"),
            Marker(60, "Escena 2 · video", "", "GREEN"),
            Marker(120, "Escena 3 · negro", "", "GREEN"),
        ],
    )


def test_writers_fill_short_clips_with_gaps(tmp_path):
    m = model(tmp_path)
    tl = otio.adapters.read_from_string(to_otio(m), "otio_json")
    video = tl.tracks[0]
    assert [type(i).__name__ for i in video] == ["Clip", "Clip", "Gap"]
    assert video[1].source_range.start_time.to_frames() == 15  # tramo del clip
    assert video[2].source_range.duration.to_frames() == 45  # 15 del video corto + 30 de negro
    assert video.markers[0].comment == "Efecto: zoom_lento_in"
    assert tl.name == "Caso ñandú"

    root = ET.fromstring(to_fcpxml(m).split("\n", 2)[2])
    spine = list(root.find("library/event/project/sequence/spine"))
    assert [(el.tag, el.get("offset"), el.get("duration")) for el in spine] == [
        ("video", "0s", "60/30s"),
        ("asset-clip", "60/30s", "45/30s"),
        ("gap", "105/30s", "45/30s"),
    ]
    assert spine[1].get("start") == "15/30s"
    # Marcadores en tiempo local de su elemento: el del video empieza en su punto de entrada.
    assert spine[1].find("marker").get("start") == "15/30s"
    assert spine[2].find("marker").get("start") == "15/30s"
    assert spine[0].find("asset-clip").get("offset") == "0s"

    edl = to_edl(m)
    assert "TITLE: CASO AND" in edl  # sin caracteres fuera de ASCII
    assert "002  AX       V     C        00:00:00:15 00:00:02:00 00:00:02:00 00:00:03:15" in edl
    assert "003  BL       V     C        00:00:00:00 00:00:01:15 00:00:03:15 00:00:05:00" in edl


def test_timecode():
    assert timecode(0, 30) == "00:00:00:00"
    assert timecode(30 * 3661 + 7, 30) == "01:01:01:07"
