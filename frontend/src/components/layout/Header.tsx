import { Settings } from "lucide-react";

type Props = {
  title?: string;
  courseSummary: string;
  goalSummary: string;
  connected: boolean;
  onModelSettings: () => void;
};

export function Header({ title = "知阶 Agent", courseSummary, goalSummary, connected, onModelSettings }: Props) {
  return (
    <header className="workspace-header">
      <div className="workspace-brand">
        <div>
          <h1>{title}</h1>
          <p>{courseSummary}</p>
        </div>
        <span>{goalSummary}</span>
      </div>
      <div className="workspace-header-actions">
        <span className={connected ? "connection-label ok" : "connection-label"}>{connected ? "Connected" : "Mock"}</span>
        <button className="secondary-button small" onClick={onModelSettings}>
          <Settings size={14} />
          模型设置
        </button>
      </div>
    </header>
  );
}
