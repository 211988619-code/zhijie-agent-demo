import type { ReactNode } from "react";

export type FeatureStatus = "available" | "mock" | "wip" | "planned";

type Props = {
  title: string;
  description: string;
  status: FeatureStatus;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
};

const statusText: Record<FeatureStatus, string> = {
  available: "可用",
  mock: "Mock",
  wip: "开发中",
  planned: "规划中"
};

export function FeatureCard({ title, description, status, actionLabel, onAction, children }: Props) {
  return (
    <article className="feature-card">
      <div className="feature-card-head">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className={`feature-status ${status}`}>{statusText[status]}</span>
      </div>
      {children && <div className="feature-card-body">{children}</div>}
      {actionLabel && (
        <button className="secondary-button small" onClick={onAction} disabled={!onAction}>
          {actionLabel}
        </button>
      )}
    </article>
  );
}
