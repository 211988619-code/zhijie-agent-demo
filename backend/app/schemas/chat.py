from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)


class ChatMetadata(BaseModel):
    sessionId: str | None = None
    source: str = "assistant"
    maxTokens: int | None = Field(default=None, ge=1, le=16000)
    jsonMode: bool = False
    temperature: float | None = Field(default=None, ge=0, le=2)


class AgentChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    metadata: ChatMetadata = Field(default_factory=ChatMetadata)


class TraceStep(BaseModel):
    id: str
    title: str
    type: str
    status: Literal["pending", "running", "success", "failed"]
    detail: str


class AgentChatResponse(BaseModel):
    mode: Literal["llm", "mock"]
    answer: str
    raw: dict[str, Any] = Field(default_factory=dict)
    trace: list[TraceStep] = Field(default_factory=list)
    warning: str | None = None
    fallbackReason: str | None = None
