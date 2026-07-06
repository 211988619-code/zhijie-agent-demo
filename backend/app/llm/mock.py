import json
from uuid import uuid4

from app.schemas.chat import AgentChatResponse, TraceStep


def mock_response(reason: str, fallback_reason: str = "provider_error") -> AgentChatResponse:
    # The answer follows the frontend's existing structured Agent JSON contract.
    answer = json.dumps(
        {
            "taskType": "course_qa",
            "detectedConcepts": [],
            "newConceptCandidates": [],
            "agentTrace": [],
            "answerMarkdown": "模型服务当前不可用，已启用 mock fallback。你仍可继续体验本地演示功能。",
            "knowledgeCards": [],
            "reviewSuggestions": [],
        },
        ensure_ascii=False,
    )
    return AgentChatResponse(
        mode="mock",
        answer=answer,
        raw={},
        trace=[
            TraceStep(
                id=f"mock_{uuid4().hex}",
                title="Backend mock fallback",
                type="llm_call",
                status="success",
                detail=reason,
            )
        ],
        warning=reason,
        fallbackReason=fallback_reason,
    )
