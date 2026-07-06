from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.llm.openai_compatible import LLMProviderError, request_chat_completion
from app.schemas.chat import AgentChatRequest, ChatMessage, ChatMetadata


router = APIRouter(tags=["health"])


@router.get("/health")
async def health(settings: Settings = Depends(get_settings)) -> dict[str, bool | str]:
    return {
        "status": "ok",
        "modelConfigured": settings.model_configured,
        "mockFallback": settings.llm_mock_fallback,
    }


@router.post("/health/model")
async def model_health(settings: Settings = Depends(get_settings)) -> dict[str, bool | str | None]:
    request = AgentChatRequest(
        messages=[ChatMessage(role="user", content="Reply with OK only.")],
        metadata=ChatMetadata(source="health_check", maxTokens=16, jsonMode=False, temperature=0),
    )
    try:
        await request_chat_completion(request, settings)
        return {
            "backendAlive": True,
            "modelConfigured": settings.model_configured,
            "modelReachable": True,
            "fallbackReason": None,
            "detail": "Model request succeeded.",
        }
    except LLMProviderError as exc:
        return {
            "backendAlive": True,
            "modelConfigured": settings.model_configured,
            "modelReachable": False,
            "fallbackReason": exc.reason,
            "detail": str(exc),
        }
