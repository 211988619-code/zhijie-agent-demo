import logging
from typing import Any

import httpx

from app.config import Settings
from app.schemas.chat import AgentChatRequest


logger = logging.getLogger(__name__)


class LLMProviderError(RuntimeError):
    def __init__(self, message: str, reason: str = "provider_error") -> None:
        super().__init__(message)
        self.reason = reason


def _safe_summary(value: object, limit: int = 240) -> str:
    return " ".join(str(value).split())[:limit]


def _chat_completions_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


async def request_chat_completion(request: AgentChatRequest, settings: Settings) -> tuple[str, dict[str, Any]]:
    if not settings.model_configured:
        raise LLMProviderError("LLM is not configured on the backend.", "not_configured")

    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": [message.model_dump() for message in request.messages],
        "stream": False,
    }
    if request.metadata.maxTokens:
        payload["max_tokens"] = request.metadata.maxTokens
    if request.metadata.jsonMode:
        payload["response_format"] = {"type": "json_object"}
    if request.metadata.temperature is not None:
        payload["temperature"] = request.metadata.temperature

    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }
    final_url = _chat_completions_url(settings.llm_base_url)
    logger.info(
        "LLM request url=%s model=%s key_present=%s key_length=%d messages=%d json_mode=%s",
        final_url,
        settings.llm_model,
        bool(settings.llm_api_key),
        len(settings.llm_api_key),
        len(request.messages),
        request.metadata.jsonMode,
    )
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(final_url, headers=headers, json=payload)
            if (
                request.metadata.jsonMode
                and not response.is_success
                and response.status_code in {400, 404, 422}
            ):
                # Some OpenAI-compatible providers do not implement response_format.
                payload.pop("response_format", None)
                response = await client.post(final_url, headers=headers, json=payload)
    except httpx.RequestError as exc:
        logger.warning("LLM network failure url=%s error=%s", final_url, _safe_summary(exc))
        raise LLMProviderError(f"Model network request failed: {_safe_summary(exc)}", "network_error") from exc

    try:
        raw = response.json()
    except ValueError as exc:
        logger.warning("LLM non-JSON response status=%d", response.status_code)
        raise LLMProviderError(f"Model returned non-JSON data (HTTP {response.status_code}).", "invalid_response") from exc

    if not response.is_success:
        error = raw.get("error", {}) if isinstance(raw, dict) else {}
        message = error.get("message") if isinstance(error, dict) else None
        summary = _safe_summary(message or "request failed")
        reason = {
            401: "authentication_error",
            403: "permission_error",
            404: "model_or_endpoint_not_found",
            429: "rate_limit_error",
        }.get(response.status_code, "provider_http_error")
        logger.warning("LLM HTTP failure status=%d reason=%s detail=%s", response.status_code, reason, summary)
        raise LLMProviderError(f"Model HTTP {response.status_code}: {summary}", reason)

    try:
        content = raw["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMProviderError("Model response is missing choices[0].message.content.", "invalid_response") from exc
    if not isinstance(content, str) or not content.strip():
        raise LLMProviderError("Model response content is empty.", "empty_response")
    logger.info("LLM response status=%d model=%s", response.status_code, settings.llm_model)
    return content, raw
