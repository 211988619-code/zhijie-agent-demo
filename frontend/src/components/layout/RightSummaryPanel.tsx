import { Activity, Bot, CalendarCheck, TrendingDown } from "lucide-react";
import { normalizeTraceStep } from "../../services/traceLabels";
import type { AgentTraceStep, MasteryRecord, ReviewTask } from "../../types";

type Props = {
  mastery: MasteryRecord[];
  reviewTasks: ReviewTask[];
  trace: AgentTraceStep[];
  connected: boolean;
  onOpenReview: () => void;
  onOpenTrace: () => void;
};

function nextSuggestion(mastery: MasteryRecord[], reviewTasks: ReviewTask[], trace: AgentTraceStep[]) {
  const pending = reviewTasks.filter((task) => task.status === "pending");
  if (pending.length > 0) return "优先完成今日复习任务，再通过检测更新掌握画像。";
  const weak = [...mastery].sort((a, b) => a.score - b.score)[0];
  if (weak && weak.score < 0.4) return `建议围绕「${weak.conceptName}」先看知识卡片，再做一次针对性测验。`;
  if (trace.length === 0) return "建议先上传或查看课程资料，再让 Agent 生成一次学习诊断。";
  return "当前闭环可继续推进：选择一个薄弱概念，进入能力评估或复习任务。";
}

export function RightSummaryPanel({ mastery, reviewTasks, trace, connected, onOpenReview, onOpenTrace }: Props) {
  const weakConcepts = [...mastery].sort((a, b) => a.score - b.score).slice(0, 3);
  const pendingTasks = reviewTasks.filter((task) => task.status === "pending").slice(0, 3);
  const latestTrace = trace[trace.length - 1] ? normalizeTraceStep(trace[trace.length - 1]) : undefined;

  return (
    <div className="right-summary-stack">
      <section className="summary-card">
        <div className="summary-card-title">
          <TrendingDown size={16} />
          <h3>薄弱知识点 Top 3</h3>
        </div>
        <div className="summary-list">
          {weakConcepts.map((item) => (
            <div key={item.conceptId} className="summary-row">
              <span>{item.conceptName}</span>
              <strong>{item.score.toFixed(2)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="summary-card">
        <div className="summary-card-title">
          <CalendarCheck size={16} />
          <h3>今日复习</h3>
        </div>
        {pendingTasks.length === 0 ? (
          <p className="summary-muted">暂无待完成复习任务。</p>
        ) : (
          <div className="summary-list">
            {pendingTasks.map((task) => (
              <button key={task.id} className="summary-row action" onClick={onOpenReview}>
                <span>{task.conceptName}</span>
                <strong>{task.dueDate}</strong>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="summary-card">
        <div className="summary-card-title">
          <Bot size={16} />
          <h3>Agent 状态</h3>
        </div>
        <p className="summary-muted">{connected ? "真实模型已配置：success" : "当前使用 mock fallback 演示"}</p>
        <button className="summary-trace-button" onClick={onOpenTrace}>
          <Activity size={14} />
          {latestTrace ? `${latestTrace.title}：${latestTrace.status}` : "暂无执行记录"}
        </button>
      </section>

      <section className="summary-card accent">
        <div className="summary-card-title">
          <Activity size={16} />
          <h3>下一步建议</h3>
        </div>
        <p>{nextSuggestion(mastery, reviewTasks, trace)}</p>
      </section>
    </div>
  );
}
