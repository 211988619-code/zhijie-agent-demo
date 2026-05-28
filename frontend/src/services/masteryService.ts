import type { MasteryRecord, QuizDifficulty, QuizResultChange } from "../types";

export function conceptIdFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\u4e00-\u9fa5a-z0-9_/-]/g, "");
}

export function clampScore(score: number): number {
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

export function getMasteryLevel(score: number): string {
  if (score < 0.2) return "未接触";
  if (score < 0.4) return "听过但不稳";
  if (score < 0.6) return "基本理解";
  if (score < 0.8) return "能做基础题";
  return "熟练掌握";
}

export function getMasteryColor(score: number): string {
  if (score < 0.2) return "level-red";
  if (score < 0.4) return "level-orange";
  if (score < 0.6) return "level-yellow";
  if (score < 0.8) return "level-blue";
  return "level-green";
}

export function upsertMastery(mastery: MasteryRecord[], conceptName: string, score = 0.15, event = "新增候选知识点"): MasteryRecord[] {
  const id = conceptIdFromName(conceptName);
  if (mastery.some((item) => item.conceptId === id || item.conceptName === conceptName)) return mastery;
  return [...mastery, { conceptId: id, conceptName, score: clampScore(score), lastEvent: event }];
}

export function updateConceptMastery(mastery: MasteryRecord[], conceptName: string, delta: number, event: string): MasteryRecord[] {
  const id = conceptIdFromName(conceptName);
  const existing = mastery.find((record) => record.conceptId === id || record.conceptName === conceptName);
  if (!existing) {
    return [...mastery, { conceptId: id, conceptName, score: clampScore(0.15 + delta), lastEvent: event }];
  }
  return mastery.map((record) =>
    record.conceptId === existing.conceptId ? { ...record, score: clampScore(record.score + delta), lastEvent: event } : record
  );
}

function roundDelta(delta: number): number {
  return Number(delta.toFixed(3));
}

export function getQuizPositiveDelta(score: number, difficulty: QuizDifficulty): number {
  if (difficulty === "basic") {
    if (score >= 0.55) return 0;
    return roundDelta(0.08 * (1 - score));
  }
  if (difficulty === "medium") {
    if (score >= 0.75) return 0;
    return roundDelta(0.1 * (1 - score));
  }
  return roundDelta(0.12 * (1 - score));
}

export function getQuizNegativeDelta(_score: number, difficulty: QuizDifficulty): number {
  if (difficulty === "advanced") return -0.08;
  if (difficulty === "medium") return -0.06;
  return -0.04;
}

export function getChatFeedbackDelta(score: number, feedback: "understood" | "confused"): number {
  if (feedback === "confused") return -0.04;
  if (score >= 0.7) return 0;
  return roundDelta(0.04 * (1 - score));
}

export function getReviewDelta(score: number): number {
  if (score >= 0.6) return 0;
  return roundDelta(0.03 * (1 - score));
}

export function getQuizDelta(score: number, difficulty: QuizDifficulty, correct: boolean): number {
  return correct ? getQuizPositiveDelta(score, difficulty) : getQuizNegativeDelta(score, difficulty);
}

export function applyQuizResult(
  mastery: MasteryRecord[],
  conceptNames: string[],
  difficulty: QuizDifficulty,
  correct: boolean
): { mastery: MasteryRecord[]; changes: QuizResultChange[] } {
  let next = mastery;
  const changes: QuizResultChange[] = [];
  conceptNames.forEach((conceptName) => {
    const before = next.find((record) => record.conceptName === conceptName || record.conceptId === conceptIdFromName(conceptName))?.score ?? 0.15;
    const delta = getQuizDelta(before, difficulty, correct);
    const note =
      delta === 0 && correct
        ? difficulty === "basic"
          ? "基础题已不再提升该掌握分，请尝试更高难度题目"
          : "当前难度已不再提升该掌握分，请尝试提高题"
        : undefined;
    next = updateConceptMastery(next, conceptName, delta, correct ? `测验答对：${difficulty}` : `测验答错：${difficulty}`);
    const after = next.find((record) => record.conceptName === conceptName || record.conceptId === conceptIdFromName(conceptName))?.score ?? before;
    changes.push({ conceptName, oldScore: before, newScore: after, correct, delta, note });
  });
  return { mastery: next, changes };
}
