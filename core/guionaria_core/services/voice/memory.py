"""Memoria de voces: los ajustes de cada voz de ElevenLabs y la voz de cada canal.

Se guarda en config/voces.json (aparte de settings.json para que guardar Ajustes no la pise):
- voices: por voice_id, el modelo, la estabilidad, la similitud, el estilo y la velocidad con
  que se usó (o se ajustó) esa voz por última vez.
- channels: por canal, el motor y la voz de la última voz generada.
"""

import json
from typing import Literal

from pydantic import BaseModel, Field

from ...config import ElevenLabsPrefs, ensure_home, get_paths, load_settings

FILE = "voces.json"


class ChannelVoice(BaseModel):
    engine: Literal["piper", "elevenlabs"] = "piper"
    piper_voice: str = ""
    elevenlabs: ElevenLabsPrefs | None = None


class VoiceMemory(BaseModel):
    voices: dict[str, ElevenLabsPrefs] = Field(default_factory=dict)
    channels: dict[str, ChannelVoice] = Field(default_factory=dict)


def load() -> VoiceMemory:
    path = get_paths().config_dir / FILE
    if not path.exists():
        return VoiceMemory()
    try:
        return VoiceMemory.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except ValueError:
        return VoiceMemory()  # archivo dañado: se empieza de cero


def save(memory: VoiceMemory) -> None:
    path = ensure_home().config_dir / FILE
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(memory.model_dump_json(indent=2), encoding="utf-8")
    tmp.replace(path)


def with_preset(prefs: ElevenLabsPrefs, memory: VoiceMemory | None = None) -> ElevenLabsPrefs:
    """Los ajustes guardados de esa voz, si los hay (el nombre se conserva si falta)."""
    memory = memory or load()
    preset = memory.voices.get(prefs.voice_id) if prefs.voice_id else None
    if not preset:
        return prefs
    return preset.model_copy(update={"voice_name": preset.voice_name or prefs.voice_name})


def channel_voice(channel_id: int) -> ChannelVoice | None:
    return load().channels.get(str(channel_id))


def elevenlabs_for_channel(channel_id: int) -> ElevenLabsPrefs:
    """Voz de ElevenLabs que se propone en un canal: la última usada en él o, si nunca se usó,
    la última usada en general; siempre con los ajustes guardados de esa voz."""
    memory = load()
    remembered = memory.channels.get(str(channel_id))
    prefs = (
        remembered.elevenlabs
        if remembered and remembered.elevenlabs
        else load_settings().elevenlabs
    )
    return with_preset(prefs, memory)


def remember_preset(prefs: ElevenLabsPrefs) -> dict[str, ElevenLabsPrefs]:
    """Guarda los ajustes de una voz (se usan cada vez que se vuelva a elegir)."""
    if not prefs.voice_id:
        return load().voices
    memory = load()
    old = memory.voices.get(prefs.voice_id)
    name = prefs.voice_name or (old.voice_name if old else "")
    memory.voices[prefs.voice_id] = prefs.model_copy(update={"voice_name": name})
    save(memory)
    return memory.voices


def remember_generation(
    channel_id: int, engine: str, voice_id: str, eleven: ElevenLabsPrefs | None
) -> None:
    """Tras generar una voz: queda como la del canal y, en ElevenLabs, con sus ajustes."""
    memory = load()
    key = str(channel_id)
    current = memory.channels.get(key) or ChannelVoice()
    if engine == "elevenlabs" and eleven:
        old = memory.voices.get(eleven.voice_id)
        if not eleven.voice_name and old:
            eleven = eleven.model_copy(update={"voice_name": old.voice_name})
        memory.voices[eleven.voice_id] = eleven
        memory.channels[key] = current.model_copy(
            update={"engine": "elevenlabs", "elevenlabs": eleven}
        )
    else:
        memory.channels[key] = current.model_copy(
            update={"engine": "piper", "piper_voice": voice_id}
        )
    save(memory)
