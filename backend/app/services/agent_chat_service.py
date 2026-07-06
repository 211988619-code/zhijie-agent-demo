from uuid import uuid4

from app.config import Settings
from app.llm.mock import mock_response
from app.llm.openai_compatible import LLMProviderError, request_chat_completion
from app.schemas.chat import AgentChatRequest, AgentChatResponse, TraceStep


async def run_agent_chat(request: AgentChatRequest, settings: Settings) -> AgentChatResponse:
    try:
        answer, raw = await request_chat_completion(request, settings)
        return AgentChatResponse(
            mode="llm",
            answer=answer,
            raw=raw,
            trace=[
                TraceStep(
                    id=f"llm_{uuid4().hex}",
                    title="Backend LLM proxy",
                    type="llm_call",
                    status="success",
                    detail=f"OpenAI-compatible request completed with model {settings.llm_model}.",
                )
            ],
        )
    except LLMProviderError as exc:
        if settings.llm_mock_fallback:
            return mock_response(str(exc), exc.reason)
        raise
