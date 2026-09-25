from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session

from .. import __version__
from ..config import get_paths
from ..db import get_session
from ..services.dependencies import DependencyStatus, check_dependencies

router = APIRouter(prefix="/api", tags=["health"])


class HealthResponse(BaseModel):
    status: str
    version: str
    home: str
    db_ok: bool
    dependencies: list[DependencyStatus]


@router.get("/health", response_model=HealthResponse)
async def health(
    session: Annotated[Session, Depends(get_session)], refresh: bool = False
) -> HealthResponse:
    try:
        session.exec(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return HealthResponse(
        status="ok" if db_ok else "degraded",
        version=__version__,
        home=str(get_paths().home),
        db_ok=db_ok,
        dependencies=await check_dependencies(refresh=refresh),
    )
