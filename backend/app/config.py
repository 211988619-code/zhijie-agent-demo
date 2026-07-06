import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"").strip("'")
        if key:
            os.environ.setdefault(key, value)


_load_env_file(Path(__file__).resolve().parents[1] / ".env")


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    llm_api_key: str
    llm_base_url: str
    llm_model: str
    llm_mock_fallback: bool

    @property
    def model_configured(self) -> bool:
        return bool(self.llm_api_key and self.llm_base_url and self.llm_model)


@lru_cache
def get_settings() -> Settings:
    return Settings(
        llm_api_key=os.getenv("LLM_API_KEY", "").strip(),
        llm_base_url=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1").strip(),
        llm_model=os.getenv("LLM_MODEL", "gpt-4o-mini").strip(),
        llm_mock_fallback=_as_bool(os.getenv("LLM_MOCK_FALLBACK"), True),
    )
