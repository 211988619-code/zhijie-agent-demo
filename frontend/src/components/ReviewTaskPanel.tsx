import { CalendarCheck, CheckCircle2 } from "lucide-react";
import type { ConceptId, ReviewTask } from "../types";

type Props = {
  reviewTasks: ReviewTask[];
  onOpenCard: (conceptId: ConceptId) => void;
  onStartReviewCheck: (taskId: string) => void;
};

export function ReviewTaskPanel({ reviewTasks, onOpenCard, onStartReviewCheck }: Props) {
  const pendingCount = reviewTasks.filter((task) => task.status === "pending").length;

  return (
    <aside className="panel trace-panel review-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">复习任务</p>
          <h2>今日复习任务</h2>
          <span className="collapse-summary">待检测 {pendingCount} 项 / 共 {reviewTasks.length} 项</span>
        </div>
        <CalendarCheck size={22} />
      </div>

      {reviewTasks.length === 0 ? (
        <div className="trace-empty">点击知识卡片或回答下方的“加入复习”后，会在这里生成今日复习任务。</div>
      ) : (
        <div className="review-panel-list">
          {reviewTasks.map((task) => (
            <article className={`review-task ${task.status}`} key={task.id}>
              <button className="review-task-title" onClick={() => onOpenCard(task.conceptName)}>
                <strong>{task.conceptName}</strong>
                <span>
                  {task.category || "未分类"} · {task.dueDate}
                  {task.completedAt ? ` · 完成于 ${task.completedAt.slice(11, 16)}` : ""}
                  {task.lastCheckPassed === false ? " · 上次检测未通过" : ""}
                </span>
              </button>
              <span className={`source-chip ${task.status === "done" ? "done" : ""}`}>{task.status === "done" ? "已完成" : "待复习"}</span>
              <button className="secondary-button small" disabled={task.status === "done"} onClick={() => onStartReviewCheck(task.id)}>
                <CheckCircle2 size={14} />
                {task.status === "done" ? "已完成" : "开始检测"}
              </button>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}
