import { BookOpenCheck, ClipboardCheck, FileUp, GitBranch, ListChecks, MessageCircle } from "lucide-react";
import type { MasteryRecord, ParsedDocument, ReviewTask } from "../../types";
import type { WorkspaceTab } from "../layout/Sidebar";

type Props = {
  document: ParsedDocument;
  mastery: MasteryRecord[];
  reviewTasks: ReviewTask[];
  onNavigate: (tab: WorkspaceTab) => void;
};

function progressText(reviewTasks: ReviewTask[]) {
  if (reviewTasks.length === 0) return "尚未生成学习计划";
  const done = reviewTasks.filter((task) => task.status === "done").length;
  return `${done}/${reviewTasks.length} 项已完成`;
}

function nextSuggestion(mastery: MasteryRecord[], reviewTasks: ReviewTask[]) {
  const pending = reviewTasks.filter((task) => task.status === "pending");
  if (pending.length > 0) return "先完成今日复习任务，之后用测验验证是否真正掌握。";
  const weak = [...mastery].sort((a, b) => a.score - b.score)[0];
  if (weak && weak.score < 0.4) return `建议把「${weak.conceptName}」加入本轮复习，并生成一次针对性测验。`;
  return "建议从资料页补充课程材料，再让 Agent 根据知识点生成诊断路径。";
}

export function DashboardPage({ document, mastery, reviewTasks, onNavigate }: Props) {
  const weakConcepts = [...mastery].sort((a, b) => a.score - b.score).slice(0, 3);
  const pendingTasks = reviewTasks.filter((task) => task.status === "pending").slice(0, 4);

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">学习 Agent 工作台</p>
          <h2>机器学习基础 · 反向传播与链式法则复习</h2>
          <span>当前资料：{document.fileName} · 已解析 {document.chunks.length} 个片段 · 导入 {document.concepts.length} 个知识点</span>
        </div>
        <div className="quick-actions">
          <button className="primary-button" onClick={() => onNavigate("materials")}>
            <FileUp size={16} />
            上传资料
          </button>
          <button className="secondary-button" onClick={() => onNavigate("assistant")}>
            <MessageCircle size={16} />
            问 AI Agent
          </button>
          <button className="secondary-button" onClick={() => onNavigate("quiz")}>
            <ClipboardCheck size={16} />
            开始测验
          </button>
          <button className="secondary-button" onClick={() => onNavigate("trace")}>
            <GitBranch size={16} />
            查看执行过程
          </button>
          <button className="secondary-button" onClick={() => onNavigate("review")}>
            <BookOpenCheck size={16} />
            查看复习任务
          </button>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="summary-card">
          <div className="summary-card-title">
            <ListChecks size={16} />
            <h3>今日任务</h3>
          </div>
          {pendingTasks.length === 0 ? (
            <p className="summary-muted">暂无待完成任务。可以先从能力评估或资料上传开始。</p>
          ) : (
            <div className="summary-list">
              {pendingTasks.map((task) => (
                <div key={task.id} className="summary-row">
                  <span>{task.conceptName}</span>
                  <strong>{task.status === "done" ? "完成" : "待完成"}</strong>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="summary-card">
          <div className="summary-card-title">
            <ClipboardCheck size={16} />
            <h3>学习进度</h3>
          </div>
          <p>{progressText(reviewTasks)}</p>
          <p className="summary-muted">第一轮先复用复习任务作为计划进度，后续接入 DDL 计划生成。</p>
        </article>

        <article className="summary-card">
          <div className="summary-card-title">
            <BookOpenCheck size={16} />
            <h3>薄弱知识点</h3>
          </div>
          <div className="summary-list">
            {weakConcepts.map((item) => (
              <div key={item.conceptId} className="summary-row">
                <span>{item.conceptName}</span>
                <strong>{item.score.toFixed(2)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="summary-card accent">
          <div className="summary-card-title">
            <GitBranch size={16} />
            <h3>Agent 下一步建议</h3>
          </div>
          <p>{nextSuggestion(mastery, reviewTasks)}</p>
        </article>
      </section>
    </div>
  );
}
