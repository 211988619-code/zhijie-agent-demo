from fastapi import APIRouter, Depends, HTTPException

from app.config import Settings, get_settings
from app.llm.openai_compatible import LLMProviderError
from app.schemas.chat import AgentChatRequest, AgentChatResponse
from app.services.agent_chat_service import run_agent_chat


router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/chat", response_model=AgentChatResponse)
async def agent_chat(
    request: AgentChatRequest,
    settings: Settings = Depends(get_settings),
) -> AgentChatResponse:
    try:
        return await run_agent_chat(request, settings)
    except LLMProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
