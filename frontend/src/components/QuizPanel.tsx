import { ChevronDown, ClipboardCheck, Loader2, Plus, Wand2 } from "lucide-react";
import { useState } from "react";
import type { KnowledgeConcept, QuestionType, QuizAnswer, QuizQuestion, QuizResultChange } from "../types";
import { checkQuizAnswer } from "../services/quizService";
import { MarkdownRenderer } from "./MarkdownRenderer";

type Props = {
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
  onOpenCard: (conceptId: string, question?: QuizQuestion) => void;
  onToggleCollapsed: () => void;
};

function formatAnswer(answer: string | string[]) {
  return Array.isArray(answer) ? answer.join("、") : answer;
}

export function QuizPanel({
  concepts,
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
  highlight = false,
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
  onOpenCard,
  onToggleCollapsed
}: Props) {
  const [questionTypesOpen, setQuestionTypesOpen] = useState(false);
  const categories = ["全部", ...Array.from(new Set(concepts.map((concept) => concept.category)))];
  const visibleConcepts = concepts.filter((concept) => category === "全部" || concept.category === category);
  const answeredCount = Object.keys(selectedAnswers).length;
  const correctCount = submitted ? questions.filter((question) => checkQuizAnswer(question, selectedAnswers[question.id])).length : null;
  const scopeText =
    selectedConceptNames.length > 0
      ? `已选择 ${selectedConceptNames.length} 个知识点：${selectedConceptNames.slice(0, 4).join("、")}${selectedConceptNames.length > 4 ? " 等" : ""}`
      : "未指定知识点，将从全部知识库生成";
  const questionTypeOptions: Array<{ type: QuestionType; label: string }> = [
    { type: "single_choice", label: "单选题" },
    { type: "multiple_choice", label: "多选题" },
    { type: "true_false", label: "判断题" }
  ];
  const selectedTypeLabels =
    selectedQuestionTypes.length === questionTypeOptions.length
      ? "全部"
      : questionTypeOptions.filter((item) => selectedQuestionTypes.includes(item.type)).map((item) => item.label.replace("题", "")).join("、") || "未选择";

  return (
    <section className={`panel quiz-panel ${highlight ? "highlight" : ""} ${collapsed ? "collapsed" : ""}`}>
      <div className="panel-header collapsible-header">
        <div>
          <p className="eyebrow">诊断测验</p>
          <h2>题库 + 动态生成</h2>
          {collapsed && (
            <span className="collapse-summary">
              诊断测验：已生成 {questions.length} 题；{scopeText}
              {correctCount !== null ? `；最近得分：${correctCount}/${questions.length}` : ""}
            </span>
          )}
        </div>
        <button className="icon-button" onClick={onToggleCollapsed} aria-label="切换诊断测验">
          {collapsed ? <ClipboardCheck size={18} /> : <Plus size={18} />}
        </button>
      </div>

      {!collapsed && (
        <>
      <div className="quiz-toolbar">
        <select value={category} onChange={(event) => onCategory(event.target.value)}>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={difficulty} onChange={(event) => onDifficulty(event.target.value as "all" | "basic" | "medium" | "advanced")}>
          <option value="all">全部难度</option>
          <option value="basic">基础</option>
          <option value="medium">中等</option>
          <option value="advanced">提高</option>
        </select>
        <button className="secondary-button small" onClick={onGenerate} disabled={generating || selectedQuestionTypes.length === 0}>
          {generating ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
          生成新题
        </button>
      </div>

      <div className={`question-type-selector ${questionTypesOpen ? "open" : ""}`}>
        <div className="concept-selector-head">
          <button className="concept-selector-toggle" onClick={() => setQuestionTypesOpen((value) => !value)}>
            <ChevronDown size={15} />
            <strong>题型选择</strong>
          </button>
          <span>题型：{selectedTypeLabels}</span>
        </div>
        <div className="concept-selector-body">
          <div className="concept-selector-actions">
            <button className="secondary-button small" onClick={() => onQuestionTypes(questionTypeOptions.map((item) => item.type))}>
              全选
            </button>
            <button className="secondary-button small" onClick={() => onQuestionTypes([])}>
              清空
            </button>
          </div>
          <div className="concept-checks compact">
            {questionTypeOptions.map((item) => {
              const checked = selectedQuestionTypes.includes(item.type);
              return (
                <label className={`concept-check ${checked ? "active" : ""}`} key={item.type}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onQuestionTypes(checked ? selectedQuestionTypes.filter((type) => type !== item.type) : [...selectedQuestionTypes, item.type])}
                  />
                  <span>{item.label}</span>
                  <small>{item.type}</small>
                </label>
              );
            })}
          </div>
        </div>
        {selectedQuestionTypes.length === 0 && <div className="quiz-warning">请至少选择一种题型后再生成题目。</div>}
      </div>

      <div className={`concept-selector ${conceptSelectorOpen ? "open" : ""}`}>
        <div className="concept-selector-head">
          <button className="concept-selector-toggle" onClick={() => onConceptSelectorOpen(!conceptSelectorOpen)}>
            <ChevronDown size={15} />
            <strong>选择知识点</strong>
          </button>
          <span>{scopeText}</span>
        </div>
        <div className="concept-selector-body">
          <div className="concept-selector-actions">
            <button className="secondary-button small" onClick={() => onSelectedConcepts(visibleConcepts.map((concept) => concept.name))}>
              全选
            </button>
            <button className="secondary-button small" onClick={() => onSelectedConcepts([])}>
              清空
            </button>
          </div>
          <div className="concept-checks">
            {visibleConcepts.map((concept) => {
              const checked = selectedConceptNames.includes(concept.name);
              return (
                <label className={`concept-check ${checked ? "active" : ""}`} key={concept.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      onSelectedConcepts(
                        checked ? selectedConceptNames.filter((name) => name !== concept.name) : [...selectedConceptNames, concept.name]
                      )
                    }
                  />
                  <span>{concept.name}</span>
                  <small>{concept.category}</small>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="quiz-hint">生成题暂时只允许单选题、多选题、判断题。题干、选项和解析均支持 Markdown 与公式。</div>
      {difficultyHint && <div className="quiz-difficulty-hint">{difficultyHint}</div>}
      {warning && <div className="quiz-warning">{warning}</div>}

      <div className="quiz-list">
        {questions.map((question, questionIndex) => {
          const selected = selectedAnswers[question.id];
          const correct = submitted ? checkQuizAnswer(question, selected) : null;
          return (
            <article className={`quiz-item ${submitted ? (correct ? "is-correct" : "is-wrong") : ""}`} key={question.id}>
              <div className="quiz-tags">
                {question.conceptNames.map((name) => (
                  <button className="concept-link" key={name} onClick={() => onOpenCard(name)}>
                    {name}
                  </button>
                ))}
                <span className="source-chip">{question.source}</span>
                <span className="source-chip">{question.difficulty}</span>
                <span className="source-chip">
                  {question.type === "single_choice" ? "单选" : question.type === "multiple_choice" ? "多选" : "判断"}
                </span>
              </div>

              <div className="quiz-question-header">
                <span className="quiz-question-index">{questionIndex + 1}</span>
                <div className="quiz-question-title">
                  <MarkdownRenderer content={question.questionMarkdown} compact />
                </div>
              </div>

              <div className="quiz-options">
                {question.options.map((option) => {
                  const active = Array.isArray(selected) ? selected.includes(option.id) : selected === option.id;
                  const inputType = question.type === "multiple_choice" ? "checkbox" : "radio";
                  return (
                    <label className={`quiz-option ${active ? "active" : ""}`} key={option.id}>
                      <input
                        type={inputType}
                        name={question.id}
                        checked={active}
                        disabled={submitted}
                        onChange={() => {
                          if (submitted) return;
                          if (question.type === "multiple_choice") {
                            const current = Array.isArray(selected) ? selected : [];
                            onAnswer(question.id, current.includes(option.id) ? current.filter((item) => item !== option.id) : [...current, option.id]);
                          } else {
                            onAnswer(question.id, option.id);
                          }
                        }}
                      />
                      <span className="option-id">{option.id}</span>
                      <MarkdownRenderer content={option.textMarkdown} compact />
                    </label>
                  );
                })}
              </div>

              {submitted && (
                <div className={`quiz-result ${correct ? "correct-text" : "wrong-text"}`}>
                  <div className="quiz-answer-line">
                    <strong>{correct ? "回答正确" : "回答错误"}</strong>
                    <span>正确答案：{formatAnswer(question.answer)}</span>
                    <span>你的答案：{selected ? formatAnswer(selected) : "未作答"}</span>
                  </div>
                  <MarkdownRenderer content={question.explanationMarkdown} compact />
                  {question.extraConcepts && question.extraConcepts.length > 0 && (
                    <div className="extra-concepts">
                      <strong>解析中出现的新知识点</strong>
                      <div className="concept-tags">
                        {question.extraConcepts.map((concept) => (
                          <button className="tag-button muted" key={concept.name} onClick={() => onOpenCard(concept.name, question)}>
                            {concept.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {!correct && (
                    <button className="secondary-button small" disabled={isQuestionInMistakeBook ? isQuestionInMistakeBook(question) : mistakeIds.includes(question.id)} onClick={() => onAddMistake(question)}>
                      {(isQuestionInMistakeBook ? isQuestionInMistakeBook(question) : mistakeIds.includes(question.id)) ? "已收入错题本" : "收入错题本"}
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="quiz-actions">
        <button className="primary-button" disabled={submitted || answeredCount < questions.length} onClick={onSubmit}>
          {submitted ? "已提交 / 已计分" : "提交诊断"}
        </button>
        <button className="secondary-button" disabled={!submitted} onClick={onCollectMistakes}>
          收集全部错题
        </button>
      </div>
      {submitted && (
        <div className="diagnosis-done">
          <strong>画像更新：</strong>
          {changes.map((change) => (
            <span key={`${change.conceptName}-${change.oldScore}-${change.newScore}`}>
              {change.conceptName}：{change.oldScore.toFixed(2)} -&gt; {change.newScore.toFixed(2)}
              {change.note ? `（${change.note}）` : ""}；
            </span>
          ))}
        </div>
      )}
        </>
      )}
    </section>
  );
}
