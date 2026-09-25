from fastapi import APIRouter
from pydantic import BaseModel

from ..services import prompts as svc

router = APIRouter(prefix="/api/prompts", tags=["prompts"])


class PromptUpdate(BaseModel):
    content: str


@router.get("", response_model=list[svc.PromptRead])
def list_prompts() -> list[svc.PromptRead]:
    return svc.list_prompts()


@router.put("/{name}", response_model=svc.PromptRead)
def save_prompt(name: str, data: PromptUpdate) -> svc.PromptRead:
    return svc.save_prompt(name, data.content)


@router.post("/{name}:reset", response_model=svc.PromptRead)
def reset_prompt(name: str) -> svc.PromptRead:
    return svc.reset_prompt(name)
