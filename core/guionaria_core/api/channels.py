from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from ..db import get_session
from ..schemas.channel import ChannelCreate, ChannelRead, ChannelUpdate
from ..services import channels as svc

router = APIRouter(prefix="/api/channels", tags=["channels"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("", response_model=list[ChannelRead])
def list_channels(session: SessionDep) -> list[ChannelRead]:
    return svc.list_channels(session)


@router.post("", response_model=ChannelRead, status_code=status.HTTP_201_CREATED)
def create_channel(data: ChannelCreate, session: SessionDep) -> ChannelRead:
    return svc.create_channel(session, data)


@router.get("/{channel_id}", response_model=ChannelRead)
def get_channel(channel_id: int, session: SessionDep) -> ChannelRead:
    return svc.read_channel(session, channel_id)


@router.patch("/{channel_id}", response_model=ChannelRead)
def update_channel(channel_id: int, data: ChannelUpdate, session: SessionDep) -> ChannelRead:
    return svc.update_channel(session, channel_id, data)


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_channel(channel_id: int, session: SessionDep) -> None:
    svc.delete_channel(session, channel_id)
