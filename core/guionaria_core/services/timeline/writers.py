"""Escritores del timeline: OpenTimelineIO (.otio), FCPXML 1.9 y EDL CMX 3600.

- OTIO con la librería oficial: DaVinci Resolve lo importa directo (Archivo → Importar → Timeline).
- FCPXML se escribe a mano (el adaptador de OTIO genera un XML que Resolve interpreta mal):
  medios en la línea principal, la voz como clip conectado debajo y un marcador por escena.
- EDL como respaldo: una pista de video (negro donde no hay medio) y la voz.
"""

import xml.etree.ElementTree as ET

import opentimelineio as otio

from .model import Clip, TimelineModel

# --- OTIO ---


def to_otio(m: TimelineModel) -> str:
    def rt(f: int) -> otio.opentime.RationalTime:
        return otio.opentime.RationalTime(f, m.fps)

    def tr(start: int, duration: int) -> otio.opentime.TimeRange:
        return otio.opentime.TimeRange(rt(start), rt(duration))

    def clip(c: Clip) -> otio.schema.Clip:
        available = tr(0, c.media_duration) if c.media_duration else None
        ref = otio.schema.ExternalReference(target_url=c.path.as_uri(), available_range=available)
        out = otio.schema.Clip(
            name=c.name, media_reference=ref, source_range=tr(c.source_in, c.duration)
        )
        if c.scene_position is not None:
            out.metadata["guionaria"] = {"scene": c.scene_position}
        return out

    timeline = otio.schema.Timeline(name=m.title, global_start_time=rt(0))
    timeline.metadata["guionaria"] = {"width": m.width, "height": m.height, "fps": m.fps}
    video = otio.schema.Track(name="Video", kind=otio.schema.TrackKind.Video)
    for _start, duration, c in m.video_items():
        video.append(clip(c) if c else otio.schema.Gap(source_range=tr(0, duration)))
    for mk in m.markers:
        video.markers.append(
            otio.schema.Marker(
                name=mk.name, marked_range=tr(mk.frame, 0), color=mk.color, comment=mk.note
            )
        )
    timeline.tracks.append(video)
    if m.voice:
        audio = otio.schema.Track(name="Voz", kind=otio.schema.TrackKind.Audio)
        audio.append(clip(m.voice))
        timeline.tracks.append(audio)
    for name, clips in (("SFX", m.sfx), ("Música", m.music)):
        if not clips:
            continue
        track = otio.schema.Track(name=name, kind=otio.schema.TrackKind.Audio)
        cursor = 0
        for c in clips:
            if c.start > cursor:
                track.append(otio.schema.Gap(source_range=tr(0, c.start - cursor)))
            track.append(clip(c))
            cursor = c.start + c.duration
        timeline.tracks.append(track)
    return otio.adapters.write_to_string(timeline, "otio_json")


# --- FCPXML ---


def _t(f: int, fps: int) -> str:
    return "0s" if f == 0 else f"{f}/{fps}s"


def to_fcpxml(m: TimelineModel) -> str:
    t = lambda f: _t(f, m.fps)  # noqa: E731
    root = ET.Element("fcpxml", version="1.9")
    resources = ET.SubElement(root, "resources")
    ET.SubElement(
        resources,
        "format",
        id="r1",
        frameDuration=f"1/{m.fps}s",
        width=str(m.width),
        height=str(m.height),
    )
    refs: dict[str, str] = {}

    def asset(c: Clip) -> str:
        key = str(c.path)
        if key not in refs:
            refs[key] = f"r{len(refs) + 2}"
            el = ET.SubElement(
                resources,
                "asset",
                id=refs[key],
                name=c.path.name,
                start="0s",
                duration=t(c.media_duration or 0),
                hasVideo="0" if c.kind == "audio" else "1",
                hasAudio="1" if c.kind == "audio" else "0",
            )
            if c.kind != "audio":
                el.set("format", "r1")
            else:
                el.set("audioSources", "1")
            ET.SubElement(el, "media-rep", kind="original-media", src=c.path.as_uri())
        return refs[key]

    library = ET.SubElement(root, "library")
    event = ET.SubElement(library, "event", name="Guionaria")
    project = ET.SubElement(event, "project", name=m.title)
    sequence = ET.SubElement(
        project,
        "sequence",
        format="r1",
        duration=t(m.duration),
        tcStart="0s",
        tcFormat="NDF",
        audioLayout="stereo",
        audioRate="48k",
    )
    spine = ET.SubElement(sequence, "spine")

    # Cada elemento de la línea principal: (xml, cuadro de inicio en el timeline, inicio local).
    items: list[tuple[ET.Element, int, int]] = []

    for start, duration, c in m.video_items():
        if c is None:
            el = ET.SubElement(spine, "gap", name="Hueco", offset=t(start), duration=t(duration))
            items.append((el, start, 0))
        else:
            ref = asset(c)
            if c.kind == "image":
                el = ET.SubElement(
                    spine, "video", ref=ref, name=c.name, offset=t(c.start), duration=t(c.duration)
                )
            else:
                el = ET.SubElement(
                    spine,
                    "asset-clip",
                    ref=ref,
                    name=c.name,
                    offset=t(c.start),
                    start=t(c.source_in),
                    duration=t(c.duration),
                    format="r1",
                )
            items.append((el, c.start, c.source_in))

    # La voz va conectada al primer elemento, debajo de la línea principal.
    if m.voice and items:
        first, _, local = items[0]
        ET.SubElement(
            first,
            "asset-clip",
            ref=asset(m.voice),
            name="Voz",
            lane="-1",
            offset=t(local),
            start="0s",
            duration=t(m.voice.duration),
            audioRole="dialogue",
        )

    # SFX y música: clips conectados debajo de la voz (carriles -2 y -3).
    if items:
        first, first_start, local = items[0]
        for lane, role, clips in (("-2", "effects", m.sfx), ("-3", "music", m.music)):
            for c in clips:
                ET.SubElement(
                    first,
                    "asset-clip",
                    ref=asset(c),
                    name=c.name,
                    lane=lane,
                    offset=t(local + c.start - first_start),
                    start="0s",
                    duration=t(c.duration),
                    audioRole=role,
                )

    # Los marcadores van dentro del elemento que cubre su instante, en tiempo local.
    for mk in m.markers:
        for el, start, local in reversed(items):
            if start <= mk.frame:
                attrs = {"start": t(local + mk.frame - start), "duration": t(1), "value": mk.name}
                if mk.note:
                    attrs["note"] = mk.note
                ET.SubElement(el, "marker", attrs)
                break

    ET.indent(root, space="  ")
    body = ET.tostring(root, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n' + body + "\n"


# --- EDL ---


def timecode(f: int, fps: int) -> str:
    s, ff = divmod(f, fps)
    m, ss = divmod(s, 60)
    h, mm = divmod(m, 60)
    return f"{h:02d}:{mm:02d}:{ss:02d}:{ff:02d}"


def to_edl(m: TimelineModel) -> str:
    tc = lambda f: timecode(f, m.fps)  # noqa: E731
    title = "".join(ch for ch in m.title.upper() if ch.isascii())[:70] or "GUIONARIA"
    lines = [f"TITLE: {title}", "FCM: NON-DROP FRAME", ""]
    events: list[
        tuple[str, str, int, int, int, list[str]]
    ] = []  # reel, pista, src, rec, dur, notas

    for start, duration, c in m.video_items():
        if c is None:
            events.append(("BL", "V", 0, start, duration, []))
        else:
            notes = [f"* FROM CLIP NAME: {c.name}", f"* SOURCE FILE: {c.path}"]
            events.append(("AX", "V", c.source_in, c.start, c.duration, notes))

    for mk in m.markers:
        for ev in reversed(events):
            if ev[3] <= mk.frame:
                text = mk.name + (f" · {mk.note}" if mk.note else "")
                ev[5].append(f"* LOC: {tc(mk.frame)} {mk.color:<7} {text}")
                break

    # CMX 3600 no tiene más pistas de audio útiles: los SFX quedan como notas en su evento.
    for c in m.sfx:
        for ev in reversed(events):
            if ev[3] <= c.start:
                ev[5].append(f"* SFX: {tc(c.start)} {c.name}")
                break

    if m.voice:
        v = m.voice
        notes = [f"* FROM CLIP NAME: {v.path.name}", f"* SOURCE FILE: {v.path}"]
        events.append(("AX", "A", 0, 0, v.duration, notes))
    for c in m.music:
        notes = [f"* FROM CLIP NAME: {c.name}", f"* SOURCE FILE: {c.path}", "* MÚSICA"]
        events.append(("AX", "A2", 0, c.start, c.duration, notes))

    for n, (reel, track, src, rec, dur, notes) in enumerate(events, start=1):
        lines.append(
            f"{n:03d}  {reel:<8} {track:<5} C        "
            f"{tc(src)} {tc(src + dur)} {tc(rec)} {tc(rec + dur)}"
        )
        lines += notes
        lines.append("")
    return "\n".join(lines)
