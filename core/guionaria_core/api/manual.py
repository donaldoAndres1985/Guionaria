"""Medios manuales, paquete del proyecto y acciones del sistema."""

import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Form, UploadFile, status
from pydantic import BaseModel, model_validator
from sqlmodel import Session

from ..db import get_session
from ..schemas.media import SceneMediaRead
from ..services import system
from ..services.errors import DomainError
from ..services.media import manual
from ..services.media import service as media
from ..services.package import PackageResult, export_package
from ..services.projects import get_project, project_dir

router = APIRouter(tags=["manual"])
SessionDep = Annotated[Session, Depends(get_session)]
MAX_UPLOAD = 1024 * 1024 * 1024  # 1 GB


class ImportRequest(BaseModel):
    path: str | None = None  # archivo local (arrastrado desde el explorador)
    url: str | None = None  # imagen, video o página web
    candidate_id: int | None = None  # soltado sobre un candidato que falló

    @model_validator(mode="after")
    def one_source(self) -> "ImportRequest":
        if bool(self.path) == bool(self.url):
            raise ValueError("Indica un archivo (path) o una dirección (url)")
        return self


class OpenUrlRequest(BaseModel):
    url: str


@router.post("/api/scenes/{scene_id}/assets:import", response_model=SceneMediaRead)
async def import_asset(scene_id: int, data: ImportRequest, session: SessionDep) -> SceneMediaRead:
    if data.path:
        return await manual.import_file(
            session, scene_id, Path(data.path), candidate_id=data.candidate_id
        )
    return await manual.import_url(session, scene_id, data.url, data.candidate_id)


@router.post("/api/scenes/{scene_id}/assets:upload", response_model=SceneMediaRead)
async def upload_asset(
    scene_id: int,
    file: UploadFile,
    session: SessionDep,
    candidate_id: Annotated[int | None, Form()] = None,
) -> SceneMediaRead:
    """Archivo pegado (Ctrl+V) o soltado desde el navegador."""
    name = Path(file.filename or "pegado.png").name
    manual.kind_for(Path(name))  # valida la extensión antes de guardar
    with tempfile.TemporaryDirectory(prefix="guionaria-") as tmp:
        target = Path(tmp) / name
        size = 0
        with target.open("wb") as fh:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise DomainError("El archivo supera 1 GB")
                fh.write(chunk)
        return await manual.import_file(
            session, scene_id, target, original_name=name, candidate_id=candidate_id, move=True
        )


@router.post("/api/projects/{project_id}:export-package", response_model=PackageResult)
def package(project_id: int, session: SessionDep) -> PackageResult:
    return export_package(session, project_id)


@router.post("/api/projects/{project_id}:reveal", status_code=status.HTTP_204_NO_CONTENT)
def reveal_project(project_id: int, session: SessionDep) -> None:
    system.reveal(project_dir(get_project(session, project_id)))


@router.post("/api/assets/{asset_id}:reveal", status_code=status.HTTP_204_NO_CONTENT)
def reveal_asset(asset_id: int, session: SessionDep) -> None:
    system.reveal(media.asset_file(session, asset_id))


@router.post("/api/system/open-url", status_code=status.HTTP_204_NO_CONTENT)
def open_url(data: OpenUrlRequest) -> None:
    system.open_url(data.url)
