import { CheckCircle2, CircleDot, Plus, Wrench } from "lucide-react";
import { useState } from "react";
import { normalizeTraceSteps } from "../services/traceLabels";
import type { AgentTraceStep } from "../types";

type Props = {
  trace: AgentTraceStep[];
};

export function AgentTracePanel({ trace }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const normalizedTrace = normalizeTraceSteps(trace);
  const latest = normalizedTrace[normalizedTrace.length - 1];

  return (
    <aside className="panel trace-panel">
      <div className="panel-header collapsible-header">
        <div>
          <p className="eyebrow">Agent 执行过程</p>
          <h2>Trace Timeline</h2>
          {collapsed && (
            <span className="collapse-summary">
              {normalizedTrace.length === 0
                ? "暂无执行步骤"
                : `最近任务：${latest?.type ?? "unknown"}；步骤 ${normalizedTrace.length} 个；状态 ${latest?.status ?? "unknown"}`}
            </span>
          )}
        </div>
        <button className="icon-button" onClick={() => setCollapsed((value) => !value)} aria-label="切换 Agent Trace">
          {collapsed ? <Wrench size={18} /> : <Plus size={18} />}
        </button>
      </div>

      {!collapsed &&
        (normalizedTrace.length === 0 ? (
          <div className="trace-empty">输入课程问题后，这里会展示任务识别、知识点识别、画像查询、资料检索、策略选择和工具调用。</div>
        ) : (
          <div className="trace-list">
            {normalizedTrace.map((step, index) => (
              <article className="trace-step" key={step.id}>
                <div className="trace-marker">{step.status === "success" ? <CheckCircle2 size={17} /> : <CircleDot size={17} />}</div>
                <div className="trace-body">
                  <div className="trace-topline">
                    <strong>
                      {index + 1}. {step.title}
                    </strong>
                    {step.tool && <span>{step.tool}</span>}
                  </div>
                  <p>{step.detail}</p>
                  {step.data && (
                    <ul>
                      {step.data.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            ))}
          </div>
        ))}
    </aside>
  );
}
