"""Ficha de «Investigar con fuentes»: lo que Claude devuelve (en español, como el resto de
prompts) y lo que guarda la app."""

from typing import Literal

from pydantic import BaseModel, Field

Certeza = Literal["confirmado", "una_fuente", "en_disputa"]
TipoFuente = Literal["oficial", "judicial", "prensa", "academica", "libro", "otra"]


class FuenteClaude(BaseModel):
    id: int = Field(description="Número de la fuente, empezando en 1")
    titulo: str
    medio: str | None = Field(default=None, description="Medio, institución o autor")
    url: str = Field(description="Dirección exacta de la página consultada")
    fecha: str | None = Field(default=None, description="Fecha de publicación, si se conoce")
    tipo: TipoFuente


class DatoClaude(BaseModel):
    afirmacion: str = Field(description="Un hecho concreto, en una frase")
    certeza: Certeza = Field(
        description="confirmado: dos o más fuentes fiables coinciden; una_fuente: solo una lo "
        "respalda; en_disputa: las fuentes no coinciden"
    )
    fuentes: list[int] = Field(min_length=1, description="ids de las fuentes que lo respaldan")
    nota: str | None = Field(default=None, description="Matiz o discrepancia, si la hay")


class InvestigacionClaude(BaseModel):
    resumen: str = Field(description="El caso en 3 a 5 frases, solo con hechos verificados")
    datos: list[DatoClaude] = Field(min_length=3)
    fuentes: list[FuenteClaude] = Field(min_length=1)
    contradicciones: list[str] = Field(default_factory=list)
    incognitas: list[str] = Field(
        default_factory=list, description="Lo que sigue sin saberse o no se pudo verificar"
    )
    cuidados: list[str] = Field(
        default_factory=list,
        description="Advertencias éticas o legales para contar el caso (víctimas, menores, "
        "personas no condenadas)",
    )
    ganchos: list[str] = Field(
        default_factory=list, description="2 o 3 ganchos posibles, basados en datos verificados"
    )


class ResearchRead(BaseModel):
    created_at: str
    dossier: InvestigacionClaude
    stats: dict[str, int]  # datos por certeza y número de fuentes
