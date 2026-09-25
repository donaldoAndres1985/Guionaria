"""Integraciones con Claude: servidor MCP (sección 4.2)."""

from fastapi import APIRouter

from ..services import mcp_setup

router = APIRouter(tags=["integrations"])


@router.get("/api/integrations/mcp", response_model=mcp_setup.McpInfo)
def mcp_info() -> mcp_setup.McpInfo:
    return mcp_setup.mcp_info()


@router.post("/api/integrations/mcp:register-claude-code", response_model=mcp_setup.McpInfo)
def register_claude_code() -> mcp_setup.McpInfo:
    return mcp_setup.register_claude_code()
