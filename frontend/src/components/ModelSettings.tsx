import { Settings, TestTube2 } from "lucide-react";
import { useState } from "react";
import type { LLMConfig, ModelConnectionStatus } from "../types";
import { testLLMConnection } from "../services/llmClient";

type Props = {
  config: LLMConfig;
  connected: boolean;
  status?: ModelConnectionStatus;
  lastError?: string;
  onChange: (config: LLMConfig) => void;
  onStatusChange?: (status: ModelConnectionStatus, error?: string) => void;
};

const statusText: Record<ModelConnectionStatus, string> = {
  "missing-key": "Backend Not Checked",
  mock: "Mock Fallback Available",
  ready: "Backend Ready",
  error: "Backend Error",
  testing: "Checking Backend"
};

export function ModelSettings({ config, connected, status = connected ? "ready" : "mock", lastError, onStatusChange = () => undefined }: Props) {
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");

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
        <div className="settings-message ok">模型 Provider、Base URL、Model 与 API Key 均由 FastAPI 后端环境变量管理。</div>
        <div className="settings-actions">
          <button className="primary-button" onClick={handleTest} disabled={testing}>
            <TestTube2 size={16} />
            {testing ? "测试中..." : "测试连接"}
          </button>
          <span className={`connection-label ${connected || status === "ready" ? "ok" : ""}`}>{statusText[status]}</span>
        </div>
        {message && <div className={status === "ready" ? "settings-message ok" : "settings-message"}>{message}</div>}
        {lastError && status === "error" && <div className="settings-message">{lastError}</div>}
        <p className="settings-note">浏览器不会读取、保存或发送第三方模型 API Key。此按钮只检查本地 FastAPI 的 /health 接口。</p>
      </div>
    </aside>
  );
}
