import type { CourseChunk, KnowledgeConcept, LLMConfig, MasteryRecord, QuestionType, QuizAnswer, QuizDifficulty, QuizQuestion } from "../types";
import { builtInQuizBank } from "../data/demoCourse";
import { callQuizLLM } from "./llmClient";

const defaultQuestionTypes: QuestionType[] = ["single_choice", "multiple_choice", "true_false"];
const allowedTypes = new Set<QuestionType>(defaultQuestionTypes);
const optionIds = ["A", "B", "C", "D"] as const;

function normalizeConceptName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeExtraConcepts(value: unknown): QuizQuestion["extraConcepts"] {
  if (!Array.isArray(value)) return [];
  return (value as Array<Record<string, unknown>>)
    .map((concept) => ({
      name: String(concept.name ?? "").trim(),
      category: String(concept.category ?? "待分类"),
      reason: String(concept.reason ?? ""),
      source: "quiz_explanation" as const
    }))
    .filter((concept) => concept.name);
}

export function questionMatchesSelectedConcepts(question: QuizQuestion, selectedConcepts: string[]) {
  if (selectedConcepts.length === 0) return true;
  const selected = new Set(selectedConcepts.map(normalizeConceptName));
  return question.conceptNames.some((name) => selected.has(normalizeConceptName(name)));
}

export function getBuiltInQuiz(conceptNames: string[], difficulty: string, selectedQuestionTypes: QuestionType[] = defaultQuestionTypes): QuizQuestion[] {
  const typeSet = new Set(selectedQuestionTypes.length > 0 ? selectedQuestionTypes : defaultQuestionTypes);
  const filtered = builtInQuizBank.filter((question) => {
    const conceptHit = conceptNames.length === 0 || question.conceptNames.some((name) => conceptNames.includes(name));
    const difficultyHit = difficulty === "all" || question.difficulty === difficulty;
    return conceptHit && difficultyHit && typeSet.has(question.type);
  });
  const fallback = builtInQuizBank.filter((question) => typeSet.has(question.type));
  return filtered.length > 0 ? filtered.slice(0, 5) : fallback.slice(0, 5);
}

export function normalizeQuizQuestion(raw: unknown, index = 0, selectedQuestionTypes: QuestionType[] = defaultQuestionTypes): QuizQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const type = String(item.type ?? "") as QuestionType;
  if (!allowedTypes.has(type)) return null;
  if (!new Set(selectedQuestionTypes.length > 0 ? selectedQuestionTypes : defaultQuestionTypes).has(type)) return null;

  const questionMarkdown = String(item.questionMarkdown ?? "").trim();
  if (!questionMarkdown) return null;

  const rawOptions = Array.isArray(item.options) ? item.options : [];
  let options = rawOptions
    .map((option): { id: string; textMarkdown: string } | null => {
      if (!option || typeof option !== "object") return null;
      const opt = option as Record<string, unknown>;
      return { id: String(opt.id ?? "").trim().toUpperCase(), textMarkdown: String(opt.textMarkdown ?? "").trim() };
    })
    .filter((option): option is { id: string; textMarkdown: string } => Boolean(option?.id && option.textMarkdown));

  if (type === "true_false") {
    options = [
      { id: "A", textMarkdown: options.find((option) => option.id === "A")?.textMarkdown || "正确" },
      { id: "B", textMarkdown: options.find((option) => option.id === "B")?.textMarkdown || "错误" }
    ];
  }

  if (type === "single_choice" || type === "multiple_choice") {
    if (options.length < 4) return null;
    options = optionIds.map((id, optionIndex) => ({
      id,
      textMarkdown: options.find((option) => option.id === id)?.textMarkdown || options[optionIndex]?.textMarkdown || ""
    }));
    if (options.some((option) => !option.textMarkdown)) return null;
  }

  const answer = item.answer;
  const parsedDifficulty: QuizDifficulty = item.difficulty === "medium" || item.difficulty === "advanced" ? item.difficulty : "basic";
  const common = {
    id: String(item.id ?? `llm_quiz_${Date.now()}_${index}`),
    difficulty: parsedDifficulty,
    conceptNames: Array.isArray(item.conceptNames) ? item.conceptNames.map(String).filter(Boolean) : ["未分类概念"],
    extraConcepts: normalizeExtraConcepts(item.extraConcepts),
    questionMarkdown,
    options: options as QuizQuestion["options"],
    explanationMarkdown: String(item.explanationMarkdown ?? "暂无解析。"),
    source: "llm" as const
  };

  if (type === "multiple_choice") {
    if (!Array.isArray(answer)) return null;
    const normalizedAnswer = answer.map((value) => String(value).trim().toUpperCase()).filter((value) => optionIds.includes(value as "A" | "B" | "C" | "D"));
    if (normalizedAnswer.length === 0) return null;
    return { ...common, type, answer: normalizedAnswer };
  }

  const normalizedAnswer = String(answer ?? "").trim().toUpperCase();
  const validAnswer = type === "true_false" ? normalizedAnswer === "A" || normalizedAnswer === "B" : optionIds.includes(normalizedAnswer as "A" | "B" | "C" | "D");
  if (!validAnswer) return null;
  return { ...common, type, answer: normalizedAnswer };
}

export function normalizeQuizPayload(raw: unknown, selectedQuestionTypes: QuestionType[] = defaultQuestionTypes): { questions: QuizQuestion[]; skipped: number } {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const items = Array.isArray(data.questions) ? data.questions : Array.isArray(raw) ? raw : [];
  const normalized = items.map((item, index) => normalizeQuizQuestion(item, index, selectedQuestionTypes));
  return {
    questions: normalized.filter((item): item is QuizQuestion => item !== null),
    skipped: normalized.filter((item) => item === null).length
  };
}

export function checkQuizAnswer(question: QuizQuestion, answer: QuizAnswer | undefined): boolean {
  if (answer === undefined) return false;
  if (Array.isArray(question.answer)) {
    const expected = [...question.answer].sort().join(",");
    const actual = Array.isArray(answer) ? [...answer].sort().join(",") : String(answer);
    return expected === actual;
  }
  return String(answer).toUpperCase() === String(question.answer).toUpperCase();
}

function fallbackGeneratedQuiz(concepts: KnowledgeConcept[], difficulty: "basic" | "medium" | "advanced", selectedQuestionTypes: QuestionType[]): QuizQuestion[] {
  const target = concepts[0]?.name ?? "链式法则";
  const type = (selectedQuestionTypes.length > 0 ? selectedQuestionTypes : defaultQuestionTypes)[0] ?? "single_choice";
  const base = {
    id: `fallback_${Date.now()}_1`,
    type,
    difficulty,
    conceptNames: [target],
    questionMarkdown: `关于 **${target}**，下列说法哪一项最准确？`,
    options: [
      { id: "A", textMarkdown: "它只是一个术语，不影响模型训练。" },
      { id: "B", textMarkdown: "它是理解当前课程内容的重要概念，需要结合定义、公式和例子掌握。" },
      { id: "C", textMarkdown: "它只能用于图像识别。" },
      { id: "D", textMarkdown: "它与数学表达无关。" }
    ] as QuizQuestion["options"],
    explanationMarkdown: `该题由 fallback 题库生成。建议回到课程资料中查找 **${target}** 的定义、公式和应用场景。`,
    source: "fallback" as const
  };
  if (type === "multiple_choice") return [{ ...base, answer: ["B"] }];
  if (type === "true_false") {
    return [
      {
        ...base,
        options: [
          { id: "A", textMarkdown: `**${target}** 是当前课程中的一个有效学习概念。` },
          { id: "B", textMarkdown: `**${target}** 与当前课程完全无关。` }
        ] as QuizQuestion["options"],
        answer: "A"
      }
    ];
  }
  return [{ ...base, answer: "B" }];
}

export async function generateQuiz(
  config: LLMConfig,
  concepts: KnowledgeConcept[],
  chunks: CourseChunk[],
  mastery: MasteryRecord[],
  difficulty: "basic" | "medium" | "advanced",
  useLLM: boolean,
  selectedConceptNames: string[] = concepts.map((concept) => concept.name),
  selectedQuestionTypes: QuestionType[] = defaultQuestionTypes
): Promise<{ questions: QuizQuestion[]; warning?: string }> {
  const scopeNames = selectedConceptNames.length > 0 ? selectedConceptNames : concepts.map((concept) => concept.name);
  const allowedQuestionTypes = selectedQuestionTypes.length > 0 ? selectedQuestionTypes : defaultQuestionTypes;

  if (!useLLM || !config.apiKey.trim()) {
    const builtIn = getBuiltInQuiz(scopeNames, difficulty, allowedQuestionTypes).filter((question) => questionMatchesSelectedConcepts(question, scopeNames));
    return { questions: builtIn.length > 0 ? builtIn : fallbackGeneratedQuiz(concepts, difficulty, allowedQuestionTypes) };
  }

  try {
    const payload = await callQuizLLM(config, concepts, chunks, mastery, difficulty, scopeNames, allowedQuestionTypes);
    const { questions, skipped } = normalizeQuizPayload(payload, allowedQuestionTypes);
    const matched = questions.filter((question) => questionMatchesSelectedConcepts(question, scopeNames));
    const outOfScope = questions.length - matched.length;
    if (matched.length > 0) {
      const warnings = [];
      if (skipped > 0) warnings.push(`部分题目格式或题型不符合要求，已跳过 ${skipped} 道。`);
      if (outOfScope > 0) warnings.push(`部分题目不符合所选知识点范围，已跳过 ${outOfScope} 道。`);
      return { questions: matched, warning: warnings.join(" ") || undefined };
    }
    const builtIn = getBuiltInQuiz(scopeNames, difficulty, allowedQuestionTypes).filter((question) => questionMatchesSelectedConcepts(question, scopeNames));
    return {
      questions: builtIn.length > 0 ? builtIn : fallbackGeneratedQuiz(concepts, difficulty, allowedQuestionTypes),
      warning: "模型生成题目未命中所选知识点或题型范围，已使用对应范围的 fallback 题。"
    };
  } catch {
    return { questions: fallbackGeneratedQuiz(concepts, difficulty, allowedQuestionTypes), warning: "题目生成失败，已使用 fallback 题。" };
  }
}
