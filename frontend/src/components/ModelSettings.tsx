import { Settings, TestTube2 } from "lucide-react";
import { useState } from "react";
import type { LLMConfig, LLMProvider } from "../types";
import { getProviderDefaults, testLLMConnection } from "../services/llmClient";

type Props = {
  config: LLMConfig;
  connected: boolean;
  onChange: (config: LLMConfig) => void;
};

const providers: Array<{ value: LLMProvider; label: string }> = [
  { value: "openai-compatible", label: "OpenAI-Compatible" },
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "dashscope", label: "通义千问/DashScope" },
  { value: "zhipu", label: "智谱 GLM" }
];

export function ModelSettings({ config, connected, onChange }: Props) {
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");

  const update = (patch: Partial<LLMConfig>) => onChange({ ...config, ...patch });

  const handleProvider = (provider: LLMProvider) => {
    const defaults = getProviderDefaults(provider);
    onChange({ ...config, provider, baseUrl: defaults.baseUrl || config.baseUrl, model: defaults.model || config.model });
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage("");
    try {
      const result = await testLLMConnection(config);
      setMessage(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "连接测试失败");
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
          <input
            type="password"
            value={config.apiKey}
            onChange={(event) => update({ apiKey: event.target.value })}
            placeholder="仅保存在当前页面状态，不写入代码"
          />
        </label>
        <label>
          Base URL
          <input value={config.baseUrl ?? ""} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" />
        </label>
        <label>
          Model Name
          <input value={config.model} onChange={(event) => update({ model: event.target.value })} placeholder="gpt-4o-mini / deepseek-chat" />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={config.useMockFallback} onChange={(event) => update({ useMockFallback: event.target.checked })} />
          启用 mock fallback：模型失败时仍保持 Demo 可用
        </label>
        <div className="settings-actions">
          <button className="primary-button" onClick={handleTest} disabled={testing}>
            <TestTube2 size={16} />
            {testing ? "测试中..." : "测试连接"}
          </button>
          <span className={`connection-label ${connected ? "ok" : ""}`}>{connected ? "已连接" : "未连接或未测试"}</span>
        </div>
        {message && <div className={message.includes("成功") ? "settings-message ok" : "settings-message"}>{message}</div>}
        <p className="settings-note">API Key 只保存在当前页面状态中，不会打印、不会硬编码到仓库。</p>
      </div>
    </aside>
  );
}
