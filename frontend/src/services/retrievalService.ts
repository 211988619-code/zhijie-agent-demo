import type { CourseChunk } from "../types";

export type RetrievalResult = {
  chunk: CourseChunk;
  score: number;
  matchedTerms: string[];
  fallback?: boolean;
};

const stopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "what",
  "why",
  "how",
  "please",
  "根据",
  "资料",
  "一下",
  "什么",
  "为什么",
  "如何",
  "请问",
  "解释",
  "说明",
  "一个"
]);

function chunkText(chunk: CourseChunk) {
  return chunk.text ?? chunk.content ?? "";
}

function chunkTitle(chunk: CourseChunk) {
  return chunk.sourceTitle ?? chunk.source?.document ?? "current document";
}

function tokenize(value: string) {
  const normalized = value.toLowerCase();
  const english = normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];
  const chinese = normalized.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  const mixed = normalized.match(/[\u4e00-\u9fa5a-z0-9_-]{2,}/g) ?? [];
  return Array.from(new Set([...english, ...chinese, ...mixed])).filter((term) => !stopWords.has(term) && term.length >= 2);
}

function trimToBudget(results: RetrievalResult[], maxTotalChars: number) {
  const selected: RetrievalResult[] = [];
  let total = 0;
  for (const result of results) {
    const length = chunkText(result.chunk).length;
    if (selected.length > 0 && total + length > maxTotalChars) continue;
    selected.push(result);
    total += length;
    if (total >= maxTotalChars) break;
  }
  return selected;
}

export function retrieveRelevantChunks(
  query: string,
  chunks: CourseChunk[],
  options: {
    topK?: number;
    maxTotalChars?: number;
    conceptNames?: string[];
  } = {}
): RetrievalResult[] {
  const topK = options.topK ?? 3;
  const maxTotalChars = options.maxTotalChars ?? 4000;
  if (!query.trim() || chunks.length === 0) return [];

  const terms = tokenize(query);
  const conceptTerms = (options.conceptNames ?? []).filter((name) => name.length >= 2 && query.includes(name));
  const scored = chunks
    .map((chunk) => {
      const text = chunkText(chunk).toLowerCase();
      const matchedTerms = new Set<string>();
      let score = 0;

      for (const term of terms) {
        if (text.includes(term.toLowerCase())) {
          matchedTerms.add(term);
          score += Math.min(6, Math.max(1, term.length / 2));
        }
      }

      for (const concept of conceptTerms) {
        if (text.includes(concept.toLowerCase())) {
          matchedTerms.add(concept);
          score += 10;
        }
      }

      if (chunk.concepts?.some((concept) => conceptTerms.includes(concept))) score += 5;
      return { chunk, score, matchedTerms: Array.from(matchedTerms) };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (scored.length > 0) return trimToBudget(scored, maxTotalChars);

  return trimToBudget(
    chunks.slice(0, Math.min(topK, 3)).map((chunk) => ({ chunk, score: 0, matchedTerms: [], fallback: true })),
    maxTotalChars
  );
}

export function describeRetrievalResult(result: RetrievalResult) {
  const index = result.chunk.index ?? 0;
  return `${chunkTitle(result.chunk)} #${index + 1} score=${result.score.toFixed(1)}${result.fallback ? " fallback" : ""}`;
}
