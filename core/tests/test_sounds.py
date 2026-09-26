import xml.etree.ElementTree as ET

import httpx
import opentimelineio as otio

from guionaria_core.services.sounds import license_name, suggest_tags
from tests.conftest import wait_job
from tests.media_support import downloaded
from tests.test_mcp import Mcp
from tests.test_voice import engines_fake, write_wav  # noqa: F401  (fixture)

FREESOUND = {
    "count": 2,
    "next": "https://freesound.org/apiv2/search/text/?page=2",
    "results": [
        {
            "id": 101,
            "name": "whoosh_fast.wav",
            "tags": ["whoosh", "transition", "fast"],
            "duration": 1.2,
            "license": "http://creativecommons.org/licenses/by/4.0/",
            "username": "sonidista",
            "url": "https://freesound.org/people/sonidista/sounds/101/",
            "previews": {"preview-hq-mp3": "https://cdn.freesound.org/previews/101-hq.mp3"},
        },
        {"id": 102, "name": "sin preview", "previews": {}},
    ],
}


def set_freesound_key(client, key="clave-fs"):
    s = client.get("/api/settings").json()
    s["api_keys"]["freesound"] = key
    client.put("/api/settings", json=s)


def test_helpers():
    assert suggest_tags("golpe_seco_02") == ["impact"]
    assert suggest_tags("Whoosh + Latido del corazón") == ["whoosh", "heartbeat"]
    assert suggest_tags("ambiente") == []
    assert license_name("http://creativecommons.org/publicdomain/zero/1.0/") == "CC0"
    assert license_name("http://creativecommons.org/licenses/by/4.0/") == "CC BY 4.0"
    assert license_name("https://creativecommons.org/licenses/by-nc/3.0/") == "CC BY-NC 3.0"


def test_import_list_edit_and_dedup(client, tmp_path, home):
    pack = tmp_path / "pack"
    write_wav(pack / "golpe_seco.wav", 0.5)
    write_wav(pack / "sub" / "whoosh_largo.wav", 1.0)
    (pack / "leeme.txt").write_text("no es audio")
    added = client.post(
        "/api/sounds:import", json={"paths": [str(pack)], "kind": "sfx", "tags": ["pack"]}
    ).json()
    assert [s["title"] for s in added] == ["golpe seco", "whoosh largo"]
    assert added[0]["tags"] == ["impact", "pack"] and added[0]["duration_s"] == 0.5
    assert (home / "library" / "sfx" / "golpe-seco.wav").exists()

    # El mismo contenido otra vez no se duplica.
    again = client.post("/api/sounds:import", json={"paths": [str(pack / "golpe_seco.wav")]}).json()
    assert again[0]["id"] == added[0]["id"]
    assert len(client.get("/api/sounds").json()) == 2

    music = tmp_path / "tema.wav"
    write_wav(music, 3.0)
    [theme] = client.post(
        "/api/sounds:upload",
        files={"file": ("tema oscuro.wav", music.read_bytes())},
        data={"kind": "music"},
    ).json()
    assert (theme["kind"], theme["title"]) == ("music", "tema oscuro")
    edited = client.patch(
        f"/api/sounds/{theme['id']}",
        json={"tags": [" Tension ", "piano"], "mood": "misterio", "bpm": 90},
    ).json()
    assert (edited["tags"], edited["mood"], edited["bpm"]) == (["piano", "tension"], "misterio", 90)

    assert [s["title"] for s in client.get("/api/sounds?kind=sfx").json()] == [
        "whoosh largo",
        "golpe seco",
    ]
    assert [s["title"] for s in client.get("/api/sounds?q=golpe").json()] == ["golpe seco"]
    assert [s["title"] for s in client.get("/api/sounds?tag=impact").json()] == ["golpe seco"]
    assert [s["title"] for s in client.get("/api/sounds?mood=misterio").json()] == ["tema oscuro"]
    tags = {t["tag"]: t["count"] for t in client.get("/api/sounds/tags?kind=sfx").json()}
    assert tags == {"pack": 2, "impact": 1, "whoosh": 1}
    assert client.get(added[0]["file_url"]).status_code == 200

    bad = client.post("/api/sounds:upload", files={"file": ("x.txt", b"x")})
    assert bad.status_code == 400
    assert (
        client.post("/api/sounds:import", json={"paths": [str(tmp_path / "nada")]}).status_code
        == 404
    )
    assert client.delete(f"/api/sounds/{added[1]['id']}").status_code == 204
    assert not (home / "library" / "sfx" / "whoosh-largo.wav").exists()


def test_freesound_search_and_save(client, web, home):
    assert (
        "Falta la clave de Freesound"
        in client.get("/api/freesound/search?q=whoosh").json()["detail"]
    )
    set_freesound_key(client)
    web.respond("https://freesound.org/apiv2/search/text/", httpx.Response(200, json=FREESOUND))
    web.respond(
        "https://cdn.freesound.org/previews/101-hq.mp3",
        httpx.Response(200, content=b"ID3" + b"0" * 4000),
    )
    page = client.get("/api/freesound/search?q=whoosh&max_duration=5").json()
    assert page["has_more"] is True and len(page["results"]) == 1  # sin vista previa se omite
    r = page["results"][0]
    assert (r["title"], r["license"], r["author"], r["saved_sound_id"]) == (
        "whoosh_fast",
        "CC BY 4.0",
        "sonidista",
        None,
    )
    request = next(q for q in web.requests if q.url.host == "freesound.org")
    assert request.url.params["token"] == "clave-fs"
    assert request.url.params["filter"] == "duration:[0 TO 5.0]"

    saved = client.post("/api/freesound:save", json={"result": r, "kind": "sfx"}).json()
    assert (saved["provider"], saved["license"], saved["author"]) == (
        "freesound",
        "CC BY 4.0",
        "sonidista",
    )
    assert saved["tags"] == ["fast", "transition", "whoosh"]
    assert saved["source_url"].endswith("/sounds/101/")
    # Guardar otra vez devuelve el mismo; la búsqueda lo marca como guardado.
    assert client.post("/api/freesound:save", json={"result": r}).json()["id"] == saved["id"]
    web.respond("https://freesound.org/apiv2/search/text/", httpx.Response(200, json=FREESOUND))
    assert (
        client.get("/api/freesound/search?q=whoosh").json()["results"][0]["saved_sound_id"]
        == saved["id"]
    )

    web.respond("https://freesound.org/apiv2/search/text/", httpx.Response(401))
    assert "rechazó la clave" in client.get("/api/freesound/search?q=x").json()["detail"]


def import_sound(client, tmp_path, name, kind, seconds):
    f = tmp_path / f"{name}.wav"
    write_wav(f, seconds)
    return client.post("/api/sounds:import", json={"paths": [str(f)], "kind": kind}).json()[0]


def test_assign_suggest_and_block_delete(client, media_project, tmp_path):
    scene = media_project["scenes"][0]
    sfx = import_sound(client, tmp_path, "whoosh rapido", "sfx", 0.8)
    theme = import_sound(client, tmp_path, "suspenso grave", "music", 5)

    wrong = client.put(f"/api/scenes/{scene}/sounds", json={"role": "sfx", "sound_id": theme["id"]})
    assert wrong.status_code == 400 and "otro tipo" in wrong.json()["detail"]
    assigned = client.put(
        f"/api/scenes/{scene}/sounds", json={"role": "sfx", "sound_id": sfx["id"]}
    ).json()
    assert assigned["sfx"]["title"] == "whoosh rapido" and assigned["music"] is None
    scenes = client.get(f"/api/projects/{media_project['id']}/scenes").json()["scenes"]
    assert scenes[0]["sfx_sound_id"] == sfx["id"]
    assert client.get("/api/sounds?kind=sfx").json()[0]["used_in"] == 1
    assert client.delete(f"/api/sounds/{sfx['id']}").status_code == 409

    # Sugerencias según lo que pide la escena (columna SFX de la tabla).
    from sqlmodel import Session

    from guionaria_core.db import get_engine
    from guionaria_core.models import Scene

    with Session(get_engine()) as s:
        s.get(Scene, scene).sfx = "whoosh de transición"
        s.get(Scene, scene).music_cue = "suspenso"
        s.commit()
    assert [
        x["id"] for x in client.get(f"/api/scenes/{scene}/sounds/suggestions?role=sfx").json()
    ] == [sfx["id"]]
    assert [
        x["id"] for x in client.get(f"/api/scenes/{scene}/sounds/suggestions?role=music").json()
    ] == [theme["id"]]

    cleared = client.put(
        f"/api/scenes/{scene}/sounds", json={"role": "sfx", "sound_id": None}
    ).json()
    assert cleared["sfx"] is None


def test_timeline_with_sfx_and_music(client, media_project, web, engines_fake, tmp_path, home):  # noqa: F811
    pid = media_project["id"]
    video, image, real, text = media_project["scenes"]
    for scene in (video, image, real):
        [a, *_] = downloaded(client, scene)
        client.post(f"/api/scenes/{scene}/assets/{a['id']}:approve")
    client.post(f"/api/projects/{pid}/media:approve")
    job = client.post(f"/api/projects/{pid}/voice:generate", json={}).json()
    wait_job(client, job["id"])
    hit = import_sound(client, tmp_path, "impacto", "sfx", 0.5)
    theme = import_sound(client, tmp_path, "tema a", "music", 10)
    other = import_sound(client, tmp_path, "tema b", "music", 1)
    client.put(f"/api/scenes/{video}/sounds", json={"role": "sfx", "sound_id": hit["id"]})
    client.put(f"/api/scenes/{video}/sounds", json={"role": "music", "sound_id": theme["id"]})
    client.put(
        f"/api/scenes/{image}/sounds", json={"role": "music", "sound_id": theme["id"]}
    )  # sigue
    client.put(f"/api/scenes/{text}/sounds", json={"role": "music", "sound_id": other["id"]})

    state = client.get(f"/api/projects/{pid}/timeline").json()
    assert [(c["start_s"], c["duration_s"]) for c in state["sfx"]] == [(0.0, 0.5)]
    # Tema A desde la escena 1 hasta el cambio en la escena 4 (3.9 s); el B dura 1 s.
    assert [(c["start_s"], c["duration_s"]) for c in state["music"]] == [(0.0, 3.9), (3.9, 1.0)]

    result = client.post(f"/api/projects/{pid}/timeline:export", json={}).json()
    folder = result["folder"]
    tl = otio.adapters.read_from_file(folder + "/proyecto.otio")
    assert [t.name for t in tl.tracks] == ["Video", "Voz", "SFX", "Música"]
    assert len(list(tl.tracks[3].find_clips())) == 2

    root = ET.parse(folder + "/proyecto.fcpxml").getroot()
    first = root.find("library/event/project/sequence/spine")[0]
    lanes = sorted(el.get("lane") for el in first.findall("asset-clip"))
    assert lanes == ["-1", "-2", "-3", "-3"]
    music = [el for el in first.findall("asset-clip") if el.get("lane") == "-3"]
    assert [el.get("offset") for el in music] == ["0s", "117/30s"]

    with open(folder + "/proyecto.edl", encoding="utf-8") as fh:
        edl = fh.read()
    assert "* SFX: 00:00:00:00 impacto.wav" in edl
    assert edl.count("AX       A2") == 2

    credits = client.get(f"/api/projects/{pid}/rights").json()["credits"]
    assert "Sonidos:" in credits and "«impacto»" in credits and "«tema a»" in credits


def test_sounds_by_mcp(client, media_project, tmp_path):
    sfx = import_sound(client, tmp_path, "latido corazon", "sfx", 1)
    mcp = Mcp(client)
    found = mcp.call("search_sounds", query="latido")["sounds"]
    assert found[0]["sound_id"] == sfx["id"] and found[0]["tags"] == ["heartbeat"]
    out = mcp.call(
        "assign_sound", scene_id=media_project["scenes"][2], role="sfx", sound_id=sfx["id"]
    )
    assert out["sfx"] == "latido corazon"
