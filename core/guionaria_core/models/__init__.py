"""Modelos SQLModel (sección 10 de SPEC.md).

La tabla virtual FTS5 `project_fts` se crea en la migración inicial con SQL directo.
"""

from .asset import Asset
from .cache import SearchCache
from .channel import Channel
from .idea import Idea
from .job import Job
from .log import OperationLog
from .project import Project
from .publication import Publication
from .scene import Scene, SceneAsset, SceneCandidate
from .script import ScriptVersion, Segment
from .voice import VoiceTrack

__all__ = [
    "Asset",
    "Channel",
    "Idea",
    "Job",
    "OperationLog",
    "Project",
    "Publication",
    "Scene",
    "SceneAsset",
    "SceneCandidate",
    "ScriptVersion",
    "SearchCache",
    "Segment",
    "VoiceTrack",
]
