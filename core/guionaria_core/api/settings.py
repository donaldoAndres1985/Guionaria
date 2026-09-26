from fastapi import APIRouter

from ..config import AppSettings, load_settings, save_settings
from ..services import api_keys

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/settings", response_model=AppSettings)
def get_settings() -> AppSettings:
    return load_settings()


@router.put("/settings", response_model=AppSettings)
def put_settings(settings: AppSettings) -> AppSettings:
    save_settings(settings)
    return settings


@router.post("/settings/keys/{provider}:test", response_model=api_keys.KeyTestResult)
async def test_key(provider: str, data: api_keys.KeyTestRequest) -> api_keys.KeyTestResult:
    """Prueba una clave (o la URL de SearXNG) sin guardarla; sin valor usa la guardada."""
    return await api_keys.test_key(provider, data.value)
