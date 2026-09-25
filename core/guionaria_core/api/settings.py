from fastapi import APIRouter

from ..config import AppSettings, load_settings, save_settings

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/settings", response_model=AppSettings)
def get_settings() -> AppSettings:
    return load_settings()


@router.put("/settings", response_model=AppSettings)
def put_settings(settings: AppSettings) -> AppSettings:
    save_settings(settings)
    return settings
