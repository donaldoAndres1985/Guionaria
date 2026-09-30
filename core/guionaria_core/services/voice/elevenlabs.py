"""ElevenLabs (opcional): voz profesional en la nube con tiempos por carácter.

- La voz se pide segmento por segmento a `/text-to-speech/{voz}/with-timestamps` en PCM 24 kHz:
  se guarda como WAV y encaja con el resto de la etapa (unir, regenerar uno solo, render).
- La respuesta trae el instante de cada carácter: de ahí salen las palabras con sus tiempos y
  los subtítulos, sin pasar por Whisper.
- `previous_text` / `next_text` mantienen la entonación continua entre segmentos.

El plan gratuito de ElevenLabs exige atribución y no permite uso comercial (ver Ajustes).
"""

import base64
import wave
from pathlib import Path

import httpx
from pydantic import BaseModel, Field

from ...config import load_settings
from ..errors import DomainError
from ..media.http import http_client
from .align import Word

BASE_URL = "https://api.elevenlabs.io/v1"
SAMPLE_RATE = 24_000  # pcm_24000: disponible en todos los planes
OUTPUT_FORMAT = f"pcm_{SAMPLE_RATE}"


class ElevenModel(BaseModel):
    id: str
    label: str
    hint: str
    credits_per_char: float


MODELS = [
    ElevenModel(
        id="eleven_multilingual_v2",
        label="Multilingual v2",
        hint="Máxima calidad y naturalidad en español",
        credits_per_char=1.0,
    ),
    ElevenModel(
        id="eleven_turbo_v2_5",
        label="Turbo v2.5",
        hint="Rápido y con la mitad de créditos",
        credits_per_char=0.5,
    ),
    ElevenModel(
        id="eleven_flash_v2_5",
        label="Flash v2.5",
        hint="El más rápido; algo menos expresivo",
        credits_per_char=0.5,
    ),
]
DEFAULT_MODEL = MODELS[0].id


class ElevenVoice(BaseModel):
    voice_id: str
    name: str
    category: str | None = None
    description: str | None = None
    labels: dict[str, str] = Field(default_factory=dict)
    preview_url: str | None = None


class ElevenSettings(BaseModel):
    voice_id: str
    voice_name: str = ""  # solo para recordarla (no se envía a ElevenLabs)
    model_id: str = DEFAULT_MODEL
    stability: float = Field(0.5, ge=0, le=1)
    similarity_boost: float = Field(0.75, ge=0, le=1)
    style: float = Field(0.0, ge=0, le=1)
    speed: float = Field(1.0, ge=0.7, le=1.2)
    use_speaker_boost: bool = True


class ElevenAccount(BaseModel):
    tier: str | None = None
    used: int | None = None
    limit: int | None = None
    remaining: int | None = None
    resets_at: int | None = None  # unix
    can_read: bool = True  # la clave puede no tener permiso para ver la suscripción


def api_key() -> str:
    key = load_settings().api_keys.elevenlabs
    if not key:
        raise DomainError("Falta la clave de ElevenLabs: agrégala en Ajustes → Claves de API")
    return key


def _headers(key: str) -> dict[str, str]:
    return {"xi-api-key": key, "Accept": "application/json"}


def _error(resp: httpx.Response) -> DomainError:
    try:
        body = resp.json().get("detail")
    except (ValueError, AttributeError):
        body = resp.text[:200]
    if isinstance(body, dict):
        detail = body.get("message") or body.get("status") or ""
        text = f"{body.get('status', '')} {body.get('message', '')}".lower()
    else:
        detail = str(body or "")
        text = detail.lower()
    # «Sin créditos» también llega como 401: se mira antes que la clave inválida.
    if "quota" in text or resp.status_code == 402:
        return DomainError(
            "No quedan créditos de ElevenLabs este mes: espera a la renovación, cambia de plan "
            "o usa Piper"
        )
    if resp.status_code == 401 and "permission" not in text:
        return DomainError("ElevenLabs rechazó la clave: revísala en Ajustes → Claves de API")
    if resp.status_code == 401:
        return DomainError(f"La clave de ElevenLabs no tiene el permiso necesario: {detail}")
    if resp.status_code == 429:
        return DomainError(
            "ElevenLabs está recibiendo demasiadas peticiones: intenta en un momento"
        )
    if "voice_not_found" in text or resp.status_code == 404:
        return DomainError("La voz elegida ya no existe en tu cuenta de ElevenLabs: elige otra")
    return DomainError(f"ElevenLabs respondió con error {resp.status_code}: {detail}".strip(": "))


async def list_voices() -> list[ElevenVoice]:
    key = api_key()
    async with http_client() as client:
        try:
            resp = await client.get(f"{BASE_URL}/voices", headers=_headers(key))
        except httpx.HTTPError as exc:
            raise DomainError(f"ElevenLabs no responde ({type(exc).__name__})") from exc
    if not resp.is_success:
        raise _error(resp)
    voices = [ElevenVoice.model_validate(v) for v in resp.json().get("voices", [])]
    # Primero las propias/clonadas, después las de la biblioteca; por nombre.
    return sorted(voices, key=lambda v: (v.category == "premade", v.name.lower()))


def parse_account(data: dict) -> ElevenAccount:
    used, limit = data.get("character_count"), data.get("character_limit")
    return ElevenAccount(
        tier=data.get("tier"),
        used=used,
        limit=limit,
        remaining=max(limit - used, 0) if used is not None and limit is not None else None,
        resets_at=data.get("next_character_count_reset_unix"),
    )


async def account() -> ElevenAccount:
    key = api_key()
    async with http_client() as client:
        try:
            resp = await client.get(f"{BASE_URL}/user/subscription", headers=_headers(key))
        except httpx.HTTPError as exc:
            raise DomainError(f"ElevenLabs no responde ({type(exc).__name__})") from exc
    if resp.status_code == 401 and "permission" in resp.text.lower():
        return ElevenAccount(can_read=False)
    if not resp.is_success:
        raise _error(resp)
    return parse_account(resp.json())


def words_from_alignment(alignment: dict | None, offset: float = 0.0) -> list[Word]:
    """Agrupa los caracteres con tiempo en palabras (separadas por espacios)."""
    if not alignment:
        return []
    chars = alignment.get("characters") or []
    starts = alignment.get("character_start_times_seconds") or []
    ends = alignment.get("character_end_times_seconds") or []
    words: list[Word] = []
    text, start, end = "", None, None
    for ch, s, e in zip(chars, starts, ends, strict=False):
        if ch.isspace():
            if text:
                words.append(Word(text, round(start + offset, 3), round(end + offset, 3)))
            text, start, end = "", None, None
            continue
        if start is None:
            start = s
        text += ch
        end = e
    if text:
        words.append(Word(text, round(start + offset, 3), round(end + offset, 3)))
    return words


def write_pcm_wav(pcm: bytes, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm)


async def synthesize(
    client: httpx.AsyncClient,
    key: str,
    text: str,
    settings: ElevenSettings,
    out_path: Path,
    previous_text: str | None = None,
    next_text: str | None = None,
) -> list[Word]:
    """Genera un segmento como WAV y devuelve sus palabras con tiempos relativos al segmento."""
    body = {
        "text": text,
        "model_id": settings.model_id,
        "voice_settings": {
            "stability": settings.stability,
            "similarity_boost": settings.similarity_boost,
            "style": settings.style,
            "use_speaker_boost": settings.use_speaker_boost,
            "speed": settings.speed,
        },
    }
    if previous_text:
        body["previous_text"] = previous_text
    if next_text:
        body["next_text"] = next_text
    try:
        resp = await client.post(
            f"{BASE_URL}/text-to-speech/{settings.voice_id}/with-timestamps",
            params={"output_format": OUTPUT_FORMAT},
            headers=_headers(key),
            json=body,
            timeout=120,
        )
    except httpx.HTTPError as exc:
        raise DomainError(f"ElevenLabs no responde ({type(exc).__name__})") from exc
    if not resp.is_success:
        raise _error(resp)
    data = resp.json()
    write_pcm_wav(base64.b64decode(data["audio_base64"]), out_path)
    # La alineación del texto original: los subtítulos muestran «1971», no «mil novecientos…».
    return words_from_alignment(data.get("alignment") or data.get("normalized_alignment"))
