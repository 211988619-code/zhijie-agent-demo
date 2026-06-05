import { Settings, TestTube2 } from "lucide-react";
import { useState } from "react";
import type { LLMConfig, LLMProvider, ModelConnectionStatus } from "../types";
import { getProviderDefaults, testLLMConnection } from "../services/llmClient";

type Props = {
  config: LLMConfig;
  connected: boolean;
  status?: ModelConnectionStatus;
  lastError?: string;
  onChange: (config: LLMConfig) => void;
  onStatusChange?: (status: ModelConnectionStatus, error?: string) => void;
};

const providers: Array<{ value: LLMProvider; label: string }> = [
  { value: "dashscope", label: "DashScope Compatible" },
  { value: "openai-compatible", label: "OpenAI-Compatible / Custom" },
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "zhipu", label: "Zhipu GLM" }
];

const statusText: Record<ModelConnectionStatus, string> = {
  "missing-key": "Missing API Key",
  mock: "Mock Fallback Enabled",
  ready: "Real API Ready",
  error: "API Error",
  testing: "Testing"
};

export function ModelSettings({ config, connected, status = connected ? "ready" : "missing-key", lastError, onChange, onStatusChange = () => undefined }: Props) {
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");

  const deriveStatus = (next: LLMConfig): ModelConnectionStatus => {
    if (!next.apiKey.trim()) return next.useMockFallback ? "mock" : "missing-key";
    return "mock";
  };

  const update = (patch: Partial<LLMConfig>) => {
    const next = { ...config, ...patch };
    onChange(next);
    onStatusChange(deriveStatus(next));
  };

  const handleProvider = (provider: LLMProvider) => {
    const defaults = getProviderDefaults(provider);
    const next = { ...config, provider, baseUrl: defaults.baseUrl || config.baseUrl, model: defaults.model || config.model };
    onChange(next);
    onStatusChange(deriveStatus(next));
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage("");
    onStatusChange("testing");
    try {
      const result = await testLLMConnection(config);
      setMessage(result);
      onStatusChange("ready");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Connection test failed";
      setMessage(reason);
      onStatusChange("error", reason);
    } finally {
      setTesting(false);
    }
  };

  return (
    <aside className="panel trace-panel model-config-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">模型连接</p>
          <h2>LLM Provider 设置</h2>
        </div>
        <Settings size={22} />
      </div>
      <div className="settings-form">
        <label>
          Provider
          <select value={config.provider} onChange={(event) => handleProvider(event.target.value as LLMProvider)}>
            {providers.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          API Key
          <input type="password" value={config.apiKey} onChange={(event) => update({ apiKey: event.target.value })} placeholder="只保存在本机 localStorage，生产环境请改后端代理" />
        </label>
        <label>
          Base URL
          <input value={config.baseUrl ?? ""} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
        </label>
        <label>
          Model Name
          <input value={config.model} onChange={(event) => update({ model: event.target.value })} placeholder="GLM-5" />
        </label>
        <label>
          Temperature
          <input type="number" min="0" max="2" step="0.1" value={config.temperature ?? 0.3} onChange={(event) => update({ temperature: Number(event.target.value) })} />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={config.useMockFallback} onChange={(event) => update({ useMockFallback: event.target.checked })} />
          启用 mock fallback：真实 API 失败时仍保持 Demo 可用
        </label>
        <div className="settings-actions">
          <button className="primary-button" onClick={handleTest} disabled={testing}>
            <TestTube2 size={16} />
            {testing ? "测试中..." : "测试连接"}
          </button>
          <span className={`connection-label ${connected || status === "ready" ? "ok" : ""}`}>{statusText[status]}</span>
        </div>
        {message && <div className={status === "ready" ? "settings-message ok" : "settings-message"}>{message}</div>}
        {lastError && status === "error" && <div className="settings-message">{lastError}</div>}
        <p className="settings-note">Demo 阶段会把模型配置保存到 localStorage。生产环境不应在前端保存 API Key，建议改为 FastAPI/Node 后端代理。</p>
      </div>
    </aside>
  );
}
