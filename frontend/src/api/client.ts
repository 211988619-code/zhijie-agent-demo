export type BackendHealth = {
  status: string;
  modelConfigured: boolean;
  mockFallback: boolean;
};

export type ModelHealth = {
  backendAlive: boolean;
  modelConfigured: boolean;
  modelReachable: boolean;
  fallbackReason: string | null;
  detail: string;
};

export type AgentChatRequest = {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  metadata?: {
    sessionId?: string;
    source?: string;
    maxTokens?: number;
    jsonMode?: boolean;
    temperature?: number;
  };
};

export type AgentChatResponse = {
  mode: "llm" | "mock";
  answer: string;
  raw: Record<string, unknown>;
  trace: Array<{ id: string; title: string; type: string; status: "pending" | "running" | "success" | "failed"; detail: string }>;
  warning: string | null;
  fallbackReason: string | null;
};

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Backend returned non-JSON data (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const detail = data && typeof data === "object" && "detail" in data ? String((data as { detail: unknown }).detail) : text;
    throw new Error(`Backend HTTP ${response.status}: ${detail}`);
  }
  return data as T;
}

export async function getBackendHealth(): Promise<BackendHealth> {
  const response = await fetch(`${API_BASE_URL}/health`, { headers: { Accept: "application/json" } });
  return readJson<BackendHealth>(response);
}

export async function getModelHealth(): Promise<ModelHealth> {
  const response = await fetch(`${API_BASE_URL}/health/model`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  return readJson<ModelHealth>(response);
}

export async function postAgentChat(request: AgentChatRequest): Promise<AgentChatResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, metadata: { source: "assistant", ...request.metadata } })
    });
    return await readJson<AgentChatResponse>(response);
  } catch (error) {
    const warning = `FastAPI backend unavailable: ${error instanceof Error ? error.message : "unknown error"}`;
    return {
      mode: "mock",
      answer: "",
      raw: {},
      trace: [{ id: `frontend_proxy_fallback_${Date.now()}`, title: "Frontend proxy fallback", type: "llm_call", status: "failed", detail: warning }],
      warning,
      fallbackReason: "backend_unreachable"
    };
  }
}
