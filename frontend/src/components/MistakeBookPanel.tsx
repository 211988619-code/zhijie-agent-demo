import { BookOpenCheck, FilterX, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { checkQuizAnswer } from "../services/quizService";
import type { ConceptId, MistakeItem, QuizAnswer } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

type PracticeState = {
  answer?: QuizAnswer;
  submitted?: boolean;
  correct?: boolean;
  resolved?: "understood" | "still_confused";
};

type Props = {
  mistakes: MistakeItem[];
  onOpenCard: (conceptId: ConceptId) => void;
  onPracticeSubmit: (mistake: MistakeItem, answer: QuizAnswer) => boolean;
  onResolveMistake: (mistakeId: string, resolution: "understood" | "still_confused") => void;
  onAddReview?: (conceptName: string, source: "knowledge_card" | "chat_suggestion" | "quiz") => void;
};

const ALL_FILTER = "全部";
const UNCATEGORIZED = "待分类";

function formatAnswer(answer?: string | string[]) {
  if (!answer) return "未作答";
  return Array.isArray(answer) ? answer.join("、") : answer;
}

function sourceLabel(source: MistakeItem["source"]) {
  if (source === "review") return "复习检测";
  if (source === "practice") return "错题练习";
  return "诊断测验";
}

export function MistakeBookPanel({ mistakes, onOpenCard, onPracticeSubmit, onResolveMistake, onAddReview }: Props) {
  const [category, setCategory] = useState(ALL_FILTER);
  const [difficulty, setDifficulty] = useState(ALL_FILTER);
  const [conceptName, setConceptName] = useState(ALL_FILTER);
  const [practiceByMistake, setPracticeByMistake] = useState<Record<string, PracticeState>>({});

  const activeMistakes = mistakes.filter((item) => item.status !== "mastered");
  const categories = useMemo(() => [ALL_FILTER, ...Array.from(new Set(activeMistakes.map((item) => item.category || UNCATEGORIZED)))], [activeMistakes]);
  const concepts = useMemo(() => [ALL_FILTER, ...Array.from(new Set(activeMistakes.flatMap((item) => item.conceptNames)))], [activeMistakes]);

  useEffect(() => {
    setCategory(ALL_FILTER);
    setDifficulty(ALL_FILTER);
    setConceptName(ALL_FILTER);
  }, [mistakes.length]);

  const visibleMistakes = activeMistakes.filter((item) => {
    const categoryHit = category === ALL_FILTER || (item.category || UNCATEGORIZED) === category;
    const difficultyHit = difficulty === ALL_FILTER || item.difficulty === difficulty;
    const conceptHit = conceptName === ALL_FILTER || item.conceptNames.includes(conceptName);
    return categoryHit && difficultyHit && conceptHit;
  });

  const updateAnswer = (mistake: MistakeItem, answer: QuizAnswer) => {
    setPracticeByMistake((current) => ({
      ...current,
      [mistake.id]: { ...current[mistake.id], answer }
    }));
  };

  const submitPractice = (mistake: MistakeItem) => {
    const current = practiceByMistake[mistake.id];
    if (!current?.answer || current.submitted) return;
    const correct = onPracticeSubmit(mistake, current.answer);
    setPracticeByMistake((state) => ({
      ...state,
      [mistake.id]: { ...state[mistake.id], submitted: true, correct }
    }));
  };

  const resolve = (mistake: MistakeItem, resolution: "understood" | "still_confused") => {
    const current = practiceByMistake[mistake.id];
    if (!current?.submitted || !current.correct || current.resolved) return;
    onResolveMistake(mistake.id, resolution);
    setPracticeByMistake((state) => ({
      ...state,
      [mistake.id]: { ...state[mistake.id], resolved: resolution }
    }));
  };

  return (
    <aside className="panel mistake-panel trace-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">错题本</p>
          <h2>诊断错题复盘</h2>
          <span className="collapse-summary">这里收集 Quiz 判题后的错题，用于订正和二次复习。</span>
        </div>
        <BookOpenCheck size={22} />
      </div>

      <div className="mistake-filters">
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
          <option value={ALL_FILTER}>全部难度</option>
          <option value="basic">基础</option>
          <option value="medium">中等</option>
          <option value="advanced">提高</option>
        </select>
        <select value={conceptName} onChange={(event) => setConceptName(event.target.value)}>
          {concepts.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button
          className="secondary-button small"
          onClick={() => {
            setCategory(ALL_FILTER);
            setDifficulty(ALL_FILTER);
            setConceptName(ALL_FILTER);
          }}
        >
          <FilterX size={14} />
          清空筛选
        </button>
      </div>

      {visibleMistakes.length === 0 ? (
        <div className="trace-empty">暂无错题。完成一次知识检测后，错误题目会出现在这里。</div>
      ) : (
        <div className="mistake-list">
          {visibleMistakes.map((mistake) => {
            const question = mistake.question;
            const practice = practiceByMistake[mistake.id] ?? {};
            const selected = practice.answer;
            const resultCorrect = practice.submitted ? checkQuizAnswer(question, selected) : null;

            return (
              <article className="mistake-card" key={mistake.id}>
                <div className="quiz-tags">
                  {mistake.conceptNames.map((name) => (
                    <button className="concept-link" key={name} onClick={() => onOpenCard(name)}>
                      {name}
                    </button>
                  ))}
                  <span className="source-chip">{mistake.difficulty}</span>
                  <span className="source-chip">{sourceLabel(mistake.source)}</span>
                  <span className="source-chip">做错 {mistake.wrongCount} 次</span>
                </div>

                <MarkdownRenderer content={question.questionMarkdown} compact />

                <div className="mistake-explanation">
                  <div className="mistake-meta">
                    <span>我的答案：{formatAnswer(mistake.lastUserAnswer)}</span>
                    <span>正确答案：{formatAnswer(question.answer)}</span>
                    <span>{new Date(mistake.updatedAt || mistake.createdAt).toLocaleString()}</span>
                  </div>
                  <MarkdownRenderer content={question.explanationMarkdown} compact />
                </div>

                <div className="quiz-options">
                  {question.options.map((option) => {
                    const active = Array.isArray(selected) ? selected.includes(option.id) : selected === option.id;
                    return (
                      <label className={`quiz-option ${active ? "active" : ""}`} key={option.id}>
                        <input
                          type={question.type === "multiple_choice" ? "checkbox" : "radio"}
                          name={`mistake_${mistake.id}`}
                          checked={active}
                          disabled={practice.submitted}
                          onChange={() => {
                            if (practice.submitted) return;
                            if (question.type === "multiple_choice") {
                              const current = Array.isArray(selected) ? selected : [];
                              updateAnswer(mistake, current.includes(option.id) ? current.filter((item) => item !== option.id) : [...current, option.id]);
                            } else {
                              updateAnswer(mistake, option.id);
                            }
                          }}
                        />
                        <span className="option-id">{option.id}</span>
                        <MarkdownRenderer content={option.textMarkdown} compact />
                      </label>
                    );
                  })}
                </div>

                {!practice.submitted ? (
                  <div className="mistake-actions">
                    <button className="secondary-button small" disabled={!practice.answer} onClick={() => submitPractice(mistake)}>
                      <RotateCcw size={14} />
                      重新练习
                    </button>
                    {onAddReview && (
                      <button className="secondary-button small" onClick={() => onAddReview(mistake.conceptNames[0] ?? "待分类", "quiz")}>
                        加入今日复习
                      </button>
                    )}
                  </div>
                ) : (
                  <div className={`quiz-result ${resultCorrect ? "correct-text" : "wrong-text"}`}>
                    <strong>{resultCorrect ? "本次答对" : "本次答错"}</strong>
                    {resultCorrect ? (
                      <div className="feedback-bar">
                        <button disabled={Boolean(practice.resolved)} onClick={() => resolve(mistake, "understood")}>
                          我懂了
                        </button>
                        <button disabled={Boolean(practice.resolved)} onClick={() => resolve(mistake, "still_confused")}>
                          还是不懂
                        </button>
                      </div>
                    ) : (
                      <p>错题已保留在错题本中。</p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </aside>
  );
}
