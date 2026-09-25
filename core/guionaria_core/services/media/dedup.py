"""Deduplicado por hash (sección 5.11): archivos idénticos comparten los mismos datos en disco.

Cada medio tiene su propia fila y su propia ruta en la carpeta del proyecto, pero si el
contenido ya existe en la biblioteca el archivo pasa a ser un enlace duro (hardlink) al que ya
estaba: no ocupa espacio de nuevo. Si el sistema de archivos no admite enlaces duros (otra
unidad, FAT, red), se deja la copia normal.
"""

import hashlib
import os
import shutil
from pathlib import Path

from sqlmodel import Session, select

from ...config import get_paths
from ...models import Asset

CHUNK = 1024 * 1024


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def link_or_copy(src: Path, dst: Path) -> bool:
    """Enlace duro si se puede; si no, copia. Devuelve True si quedó enlazado."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    try:
        os.link(src, dst)
        return True
    except OSError:
        shutil.copy2(src, dst)
        return False


def same_file(a: Path, b: Path) -> bool:
    try:
        return os.path.samefile(a, b)
    except OSError:
        return False


def dedupe(session: Session, path: Path, sha256: str) -> int:
    """Si otro medio tiene el mismo contenido, `path` pasa a enlazar su archivo.
    Devuelve los bytes ahorrados (0 si no había duplicado o no se pudo enlazar)."""
    home = get_paths().home
    for other in session.exec(select(Asset).where(Asset.sha256 == sha256)).all():
        source = home / other.file_path
        if not source.exists() or source == path:
            continue
        if same_file(source, path):
            return 0
        size = path.stat().st_size
        tmp = path.with_name(f".dedup-{path.name}")
        try:
            os.link(source, tmp)
        except OSError:
            return 0
        os.replace(tmp, path)
        return size
    return 0
