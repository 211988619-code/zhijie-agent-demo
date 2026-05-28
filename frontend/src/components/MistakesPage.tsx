import { BookOpenCheck, CheckCircle2, FilterX, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { checkQuizAnswer } from "../services/quizService";
import type { ConceptId, LLMConfig, KnowledgeConcept, MistakeItem, QuestionType, QuizAnswer, QuizQuestion, QuizResultChange, ReviewTask } from "../types";
import { ModelSettings } from "./ModelSettings";
import { QuizPanel } from "./QuizPanel";
import { ReviewTaskPanel } from "./ReviewTaskPanel";
import { MarkdownRenderer } from "./MarkdownRenderer";

type PracticeState = {
  active: boolean;
  answer?: QuizAnswer;
  submitted?: boolean;
  correct?: boolean;
  resolved?: "understood" | "still_confused";
};

type Filters = {
  query: string;
  category: string;
  difficulty: string;
  concept: string;
  source: string;
  status: "active" | "mastered" | "all";
};

type Props = {
  mistakes: MistakeItem[];
  onOpenCard: (conceptId: ConceptId) => void;
  onPracticeSubmit: (mistake: MistakeItem, answer: QuizAnswer) => boolean;
  onResolveMistake: (mistakeId: string, resolution: "understood" | "still_confused") => void;
  onAddReview: (conceptName: string, source: "knowledge_card" | "chat_suggestion" | "quiz") => void;
  isInReview: (conceptName: string) => boolean;
  onNavigate: (page: "workbench" | "learningSpace" | "mistakes") => void;
  onToggleRightPanel: (mode: "review" | "diagnosis" | "modelConfig") => void;
  rightPanelMode: "none" | "review" | "diagnosis" | "modelConfig";
  reviewTasks: ReviewTask[];
  onStartReviewCheck: (taskId: string) => void;
  config: LLMConfig;
  connected: boolean;
  onConfigChange: (next: LLMConfig) => void;
  concepts: KnowledgeConcept[];
  questions: QuizQuestion[];
  selectedAnswers: Record<string, QuizAnswer>;
  submitted: boolean;
  difficulty: "all" | "basic" | "medium" | "advanced";
  category: string;
  selectedConceptNames: string[];
  selectedQuestionTypes: QuestionType[];
  generating: boolean;
  changes: QuizResultChange[];
  warning?: string;
  difficultyHint?: string;
  conceptSelectorOpen: boolean;
  highlight?: boolean;
  collapsed: boolean;
  onAnswer: (questionId: string, answer: QuizAnswer) => void;
  onSubmit: () => void;
  mistakeIds: string[];
  isQuestionInMistakeBook?: (question: QuizQuestion) => boolean;
  onAddMistake: (question: QuizQuestion) => void;
  onCollectMistakes: () => void;
  onGenerate: () => void;
  onDifficulty: (difficulty: "all" | "basic" | "medium" | "advanced") => void;
  onCategory: (category: string) => void;
  onConceptSelectorOpen: (open: boolean) => void;
  onSelectedConcepts: (conceptNames: string[]) => void;
  onQuestionTypes: (types: QuestionType[]) => void;
  onOpenCardWithQuestion: (conceptId: string, question?: QuizQuestion) => void;
  onToggleCollapsed: () => void;
};

const ALL = "全部";
const DEFAULT_FILTERS: Filters = {
  query: "",
  category: ALL,
  difficulty: ALL,
  concept: ALL,
  source: ALL,
  status: "active"
};

function formatAnswer(answer?: QuizAnswer) {
  if (!answer) return "未作答";
  return Array.isArray(answer) ? answer.join("、") : answer;
}

function difficultyLabel(value: string) {
  if (value === "basic") return "基础";
  if (value === "medium") return "中等";
  if (value === "advanced") return "提高";
  return value;
}

function sourceLabel(value: string) {
  if (value === "diagnosis") return "诊断";
  if (value === "review") return "复习";
  if (value === "practice") return "练习";
  return value;
}

function normalizeQuestionPreviewMarkdown(value: string) {
  return value
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, content) => String(content).trim())
    .replace(/`{1,3}([^`]+?)`{1,3}/g, (_, content) => String(content).trim())
    .replace(/<\/?code>/gi, "")
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, formula) => `$${String(formula).trim()}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, formula) => `$${String(formula).trim()}$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, formula) => `$${String(formula).trim()}$`)
    .replace(/\s+/g, " ")
    .trim();
}

export function MistakesPage({
  mistakes,
  onOpenCard,
  onPracticeSubmit,
  onResolveMistake,
  onAddReview,
  isInReview,
  onNavigate,
  onToggleRightPanel,
  rightPanelMode,
  reviewTasks,
  onStartReviewCheck,
  config,
  connected,
  onConfigChange,
  concepts: allConcepts,
  questions,
  selectedAnswers,
  submitted,
  difficulty,
  category,
  selectedConceptNames,
  selectedQuestionTypes,
  generating,
  changes,
  warning,
  difficultyHint,
  conceptSelectorOpen,
  highlight,
  collapsed,
  onAnswer,
  onSubmit,
  mistakeIds,
  isQuestionInMistakeBook,
  onAddMistake,
  onCollectMistakes,
  onGenerate,
  onDifficulty,
  onCategory,
  onConceptSelectorOpen,
  onSelectedConcepts,
  onQuestionTypes,
  onOpenCardWithQuestion,
  onToggleCollapsed
}: Props) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(mistakes.find((item) => item.status !== "mastered")?.id ?? mistakes[0]?.id ?? null);
  const [practiceById, setPracticeById] = useState<Record<string, PracticeState>>({});

  const categories = useMemo(() => [ALL, ...Array.from(new Set(mistakes.map((item) => item.category || "待分类")))], [mistakes]);
  const conceptOptions = useMemo(() => [ALL, ...Array.from(new Set(mistakes.flatMap((item) => item.conceptNames)))], [mistakes]);
  const sources = useMemo(() => [ALL, ...Array.from(new Set(mistakes.map((item) => item.source)))], [mistakes]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      total: mistakes.length,
      active: mistakes.filter((item) => item.status !== "mastered").length,
      today: mistakes.filter((item) => item.createdAt?.startsWith(today)).length,
      mastered: mistakes.filter((item) => item.status === "mastered").length
    };
  }, [mistakes]);

  const visibleMistakes = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return mistakes.filter((item) => {
      const statusHit = filters.status === "all" || (filters.status === "mastered" ? item.status === "mastered" : item.status !== "mastered");
      const categoryHit = filters.category === ALL || (item.category || "待分类") === filters.category;
      const difficultyHit = filters.difficulty === ALL || item.difficulty === filters.difficulty;
      const conceptHit = filters.concept === ALL || item.conceptNames.includes(filters.concept);
      const sourceHit = filters.source === ALL || item.source === filters.source;
      const queryHit =
        !query ||
        item.question.questionMarkdown.toLowerCase().includes(query) ||
        item.conceptNames.some((name) => name.toLowerCase().includes(query));
      return statusHit && categoryHit && difficultyHit && conceptHit && sourceHit && queryHit;
    });
  }, [filters, mistakes]);

  const selectedMistake = visibleMistakes.find((item) => item.id === selectedId) ?? visibleMistakes[0] ?? null;
  const selectedPractice = selectedMistake ? practiceById[selectedMistake.id] ?? { active: false } : { active: false };

  const analysis = useMemo(() => {
    const conceptCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();
    mistakes
      .filter((item) => item.status !== "mastered")
      .forEach((item) => {
        item.conceptNames.forEach((name) => conceptCounts.set(name, (conceptCounts.get(name) ?? 0) + 1));
        const category = item.category || "待分类";
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      });
    return {
      topConcepts: Array.from(conceptCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3),
      topCategory: Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1])[0],
      highWrongCount: mistakes.filter((item) => item.status !== "mastered" && item.wrongCount >= 3).length
    };
  }, [mistakes]);

  useEffect(() => {
    if (!selectedId || !visibleMistakes.some((item) => item.id === selectedId)) {
      setSelectedId(visibleMistakes[0]?.id ?? null);
    }
  }, [selectedId, visibleMistakes]);

  const updateAnswer = (mistake: MistakeItem, answer: QuizAnswer) => {
    setPracticeById((current) => ({
      ...current,
      [mistake.id]: { ...current[mistake.id], active: true, answer }
    }));
  };

  const startPractice = (mistake: MistakeItem) => {
    setPracticeById((current) => ({
      ...current,
      [mistake.id]: { active: true, answer: undefined, submitted: false }
    }));
  };

  const submitPractice = (mistake: MistakeItem) => {
    const current = practiceById[mistake.id];
    if (!current?.answer || current.submitted) return;
    const correct = onPracticeSubmit(mistake, current.answer);
    setPracticeById((state) => ({
      ...state,
      [mistake.id]: { ...state[mistake.id], active: true, submitted: true, correct }
    }));
  };

  const resolvePractice = (mistake: MistakeItem, resolution: "understood" | "still_confused") => {
    const current = practiceById[mistake.id];
    if (!current?.submitted || !current.correct || current.resolved) return;
    onResolveMistake(mistake.id, resolution);
    setPracticeById((state) => ({
      ...state,
      [mistake.id]: { ...state[mistake.id], resolved: resolution }
    }));
  };

  return (
    <main className={`mistakes-page ${rightPanelMode !== "none" ? "has-right-panel" : ""}`}>
      <div className="mistakes-main">
      <section className="mistakes-page-header">
        <div>
          <p className="eyebrow">错题处理中心</p>
          <h2>错题本</h2>
          <span>集中处理诊断、复习和练习中的错题</span>
        </div>
      </section>

      <section className="mistakes-stat-grid">
        <div>
          <span>全部错题</span>
          <strong>{stats.total}</strong>
        </div>
        <div>
          <span>待复习</span>
          <strong>{stats.active}</strong>
        </div>
        <div>
          <span>今日新增</span>
          <strong>{stats.today}</strong>
        </div>
        <div>
          <span>已掌握</span>
          <strong>{stats.mastered}</strong>
        </div>
      </section>

      <section className="mistakes-analysis">
        <div>
          <strong>薄弱知识点 Top 3</strong>
          <div className="mistakes-chip-row">
            {analysis.topConcepts.length === 0 ? <span className="source-chip">暂无</span> : analysis.topConcepts.map(([name, count]) => <button className="concept-link" key={name} onClick={() => onOpenCard(name)}>{name} · {count}</button>)}
          </div>
        </div>
        <div>
          <strong>高频分类</strong>
          <span className="source-chip">{analysis.topCategory ? `${analysis.topCategory[0]} · ${analysis.topCategory[1]}` : "暂无"}</span>
        </div>
        <div>
          <strong>高错误次数</strong>
          <span className="source-chip">{analysis.highWrongCount} 题</span>
        </div>
      </section>

      <section className="mistakes-filter-bar">
        <label className="mistakes-search">
          <Search size={15} />
          <input value={filters.query} placeholder="搜索题干 / 知识点" onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} />
        </label>
        <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={filters.difficulty} onChange={(event) => setFilters((current) => ({ ...current, difficulty: event.target.value }))}>
          <option value={ALL}>全部难度</option>
          <option value="basic">基础</option>
          <option value="medium">中等</option>
          <option value="advanced">提高</option>
        </select>
        <select value={filters.concept} onChange={(event) => setFilters((current) => ({ ...current, concept: event.target.value }))}>
          {conceptOptions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}>
          {sources.map((item) => <option key={item} value={item}>{item === ALL ? "全部来源" : sourceLabel(item)}</option>)}
        </select>
        <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as Filters["status"] }))}>
          <option value="active">待处理</option>
          <option value="mastered">已掌握</option>
          <option value="all">全部状态</option>
        </select>
        <button className="secondary-button small" onClick={() => setFilters(DEFAULT_FILTERS)}>
          <FilterX size={14} />
          清空筛选
        </button>
      </section>

      {mistakes.length === 0 ? (
        <section className="panel mistakes-empty">
          <BookOpenCheck size={28} />
          <h3>暂无错题</h3>
          <p>可以通过诊断测验或复习检测收集错题。</p>
          <button className="primary-button small" onClick={() => onNavigate("workbench")}>去学习工作区</button>
        </section>
      ) : visibleMistakes.length === 0 ? (
        <section className="panel mistakes-empty">
          <FilterX size={28} />
          <h3>当前筛选下没有错题</h3>
          <p>调整筛选条件，或清空筛选后查看全部待处理错题。</p>
          <button className="secondary-button small" onClick={() => setFilters(DEFAULT_FILTERS)}>清空筛选</button>
        </section>
      ) : (
        <section className="mistakes-workspace">
          <div className="mistakes-list-panel">
            {visibleMistakes.map((mistake) => (
              <button className={`mistakes-list-card ${selectedMistake?.id === mistake.id ? "active" : ""}`} key={mistake.id} onClick={() => setSelectedId(mistake.id)}>
                <div className="mistakes-list-card-top">
                  <div className="mistakes-list-title one-line-markdown">
                    <MarkdownRenderer
                      className="markdown-body mistake-title-preview"
                      content={normalizeQuestionPreviewMarkdown(mistake.question.questionMarkdown)}
                      compact
                      renderCodeAsText
                    />
                  </div>
                  <span className={`status-pill ${mistake.status === "mastered" ? "success" : "warning"}`}>{mistake.status === "mastered" ? "已掌握" : "待处理"}</span>
                </div>
                <div className="mistakes-card-tags">
                  {mistake.conceptNames.slice(0, 3).map((name) => <span key={name}>{name}</span>)}
                </div>
                <div className="mistakes-card-meta">
                  <span>{difficultyLabel(mistake.difficulty)}</span>
                  <span>{sourceLabel(mistake.source)}</span>
                  <span>做错 {mistake.wrongCount} 次</span>
                  <span>{mistake.updatedAt?.slice(0, 10)}</span>
                </div>
              </button>
            ))}
          </div>

          {selectedMistake && (
            <article className="panel mistakes-detail">
              <div className="mistakes-detail-head">
                <div>
                  <p className="eyebrow">错题详情</p>
                  <h3>{selectedMistake.status === "mastered" ? "已掌握错题" : "待处理错题"}</h3>
                </div>
                <span className="source-chip">做错 {selectedMistake.wrongCount} 次</span>
              </div>

              <div className="quiz-tags">
                {selectedMistake.conceptNames.map((name) => <button className="concept-link" key={name} onClick={() => onOpenCard(name)}>{name}</button>)}
                <span className="source-chip">{difficultyLabel(selectedMistake.difficulty)}</span>
                <span className="source-chip">{sourceLabel(selectedMistake.source)}</span>
                <span className="source-chip">{selectedMistake.category || "待分类"}</span>
              </div>

              <section className="mistakes-detail-section">
                <h4>题干</h4>
                <MarkdownRenderer content={selectedMistake.question.questionMarkdown} compact />
              </section>

              {(selectedPractice.active || selectedPractice.submitted) && (
                <section className="mistakes-detail-section">
                  <h4>重新作答</h4>
                  <div className="quiz-options">
                    {selectedMistake.question.options.map((option) => {
                      const selected = selectedPractice.answer;
                      const active = Array.isArray(selected) ? selected.includes(option.id) : selected === option.id;
                      return (
                        <label className={`quiz-option ${active ? "active" : ""}`} key={option.id}>
                          <input
                            type={selectedMistake.question.type === "multiple_choice" ? "checkbox" : "radio"}
                            name={`mistake_page_${selectedMistake.id}`}
                            checked={active}
                            disabled={selectedPractice.submitted}
                            onChange={() => {
                              if (selectedPractice.submitted) return;
                              if (selectedMistake.question.type === "multiple_choice") {
                                const current = Array.isArray(selected) ? selected : [];
                                updateAnswer(selectedMistake, current.includes(option.id) ? current.filter((item) => item !== option.id) : [...current, option.id]);
                              } else {
                                updateAnswer(selectedMistake, option.id);
                              }
                            }}
                          />
                          <span className="option-id">{option.id}</span>
                          <MarkdownRenderer content={option.textMarkdown} compact />
                        </label>
                      );
                    })}
                  </div>
                </section>
              )}

              {selectedPractice.submitted && (
                <section className={`mistakes-result ${selectedPractice.correct ? "success" : "failed"}`}>
                  <div>
                    <strong>{selectedPractice.correct ? "本次答对" : "本次答错"}</strong>
                    <span>本次作答：{formatAnswer(selectedPractice.answer)} · 正确答案：{formatAnswer(selectedMistake.question.answer)}</span>
                  </div>
                  <MarkdownRenderer content={selectedMistake.question.explanationMarkdown} compact />
                  {selectedPractice.correct ? (
                    <div className="feedback-bar">
                      <button disabled={Boolean(selectedPractice.resolved)} onClick={() => resolvePractice(selectedMistake, "understood")}>
                        <CheckCircle2 size={15} />
                        我懂了
                      </button>
                      <button disabled={Boolean(selectedPractice.resolved)} onClick={() => resolvePractice(selectedMistake, "still_confused")}>还是不懂</button>
                    </div>
                  ) : (
                    <p>错题已保留在错题本中，做错次数已更新。</p>
                  )}
                </section>
              )}

              <div className="mistakes-detail-actions">
                {!selectedPractice.active && !selectedPractice.submitted && (
                  <button className="primary-button small" onClick={() => startPractice(selectedMistake)}>
                    <RotateCcw size={14} />
                    再做一次
                  </button>
                )}
                {selectedPractice.active && !selectedPractice.submitted && (
                  <button className="primary-button small" disabled={!selectedPractice.answer} onClick={() => submitPractice(selectedMistake)}>
                    提交答案
                  </button>
                )}
                {selectedMistake.conceptNames[0] && (
                  <button
                    className={`secondary-button small ${isInReview(selectedMistake.conceptNames[0]) ? "done" : ""}`}
                    onClick={() => onAddReview(selectedMistake.conceptNames[0], "quiz")}
                    disabled={isInReview(selectedMistake.conceptNames[0])}
                  >
                    {isInReview(selectedMistake.conceptNames[0]) ? "已加入今日复习" : "加入今日复习"}
                  </button>
                )}
              </div>
            </article>
          )}
        </section>
      )}

      </div>

      {rightPanelMode !== "none" && (
        <aside className={`mistakes-side-panel mistakes-side-panel--${rightPanelMode}`}>
          {rightPanelMode === "review" ? (
            <ReviewTaskPanel reviewTasks={reviewTasks} onOpenCard={onOpenCard} onStartReviewCheck={onStartReviewCheck} />
          ) : rightPanelMode === "diagnosis" ? (
            <QuizPanel
              concepts={allConcepts}
              questions={questions}
              selectedAnswers={selectedAnswers}
              submitted={submitted}
              difficulty={difficulty}
              category={category}
              selectedConceptNames={selectedConceptNames}
              selectedQuestionTypes={selectedQuestionTypes}
              generating={generating}
              changes={changes}
              warning={warning}
              difficultyHint={difficultyHint}
              conceptSelectorOpen={conceptSelectorOpen}
              highlight={highlight}
              collapsed={collapsed}
              onAnswer={onAnswer}
              onSubmit={onSubmit}
              mistakeIds={mistakeIds}
              isQuestionInMistakeBook={isQuestionInMistakeBook}
              onAddMistake={onAddMistake}
              onCollectMistakes={onCollectMistakes}
              onGenerate={onGenerate}
              onDifficulty={onDifficulty}
              onCategory={onCategory}
              onConceptSelectorOpen={onConceptSelectorOpen}
              onSelectedConcepts={onSelectedConcepts}
              onQuestionTypes={onQuestionTypes}
              onOpenCard={onOpenCardWithQuestion}
              onToggleCollapsed={onToggleCollapsed}
            />
          ) : (
            <ModelSettings config={config} connected={connected} onChange={onConfigChange} />
          )}
        </aside>
      )}
    </main>
  );
}
