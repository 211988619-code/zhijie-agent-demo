import type { CandidateConcept, ConceptExtractionSource, ExtractedConceptCandidate, KnowledgeConcept } from "../types";
import { canonicalizeConceptName, normalizeConceptKey, resolveKnownConcept } from "./conceptIdentity";

export type ConceptExtractionInput = {
  sourceType: ConceptExtractionSource;
  sourceId?: string;
  rawText: string;
  contextText?: string;
  knownConcepts: KnowledgeConcept[];
  pendingCandidates: CandidateConcept[];
  courseName?: string;
  learningSpaceName?: string;
  llmCandidates?: Array<{
    name: string;
    category?: string;
    reason?: string;
    confidence?: number;
    shouldAddToCourse?: boolean;
    status?: "existing" | "candidate";
    contextRole?: CandidateConcept["contextRole"];
    candidateType?: CandidateConcept["candidateType"];
    educationalValue?: number;
    noiseRisk?: number;
    granularity?: CandidateConcept["granularity"];
  }>;
};

type Threshold = { educationalValue: number; noiseRisk: number };

const thresholds: Record<ConceptExtractionSource, Threshold> = {
  chat: { educationalValue: 0.72, noiseRisk: 0.28 },
  quiz: { educationalValue: 0.68, noiseRisk: 0.32 },
  quiz_explanation: { educationalValue: 0.68, noiseRisk: 0.32 },
  related_concept: { educationalValue: 0.65, noiseRisk: 0.35 },
  document: { educationalValue: 0.58, noiseRisk: 0.4 }
};

const hardRejectTerms = [
  "\u4f60\u597d",
  "\u8c22\u8c22",
  "\u518d\u89c1",
  "\u597d\u7684",
  "\u55ef",
  "\u5e2e\u6211",
  "\u89e3\u91ca\u4e00\u4e0b",
  "\u8fd9\u4e2a",
  "\u90a3\u4e2a",
  "\u5b83",
  "\u4ed6\u4eec",
  "\u95ee\u9898",
  "\u7b54\u6848",
  "\u4f8b\u5b50",
  "\u6b65\u9aa4",
  "\u6587\u4ef6",
  "\u9875\u9762",
  "\u7ae0\u8282",
  "\u5185\u5bb9"
];

const tooBroadTerms = [
  "\u6570\u5b66",
  "\u7269\u7406",
  "\u4ee3\u7801",
  "\u6a21\u578b",
  "\u7b97\u6cd5",
  "\u4eba\u5de5\u667a\u80fd",
  "\u673a\u5668\u5b66\u4e60",
  "\u6df1\u5ea6\u5b66\u4e60",
  "\u77e5\u8bc6\u70b9",
  "\u8bfe\u7a0b",
  "\u5b66\u4e60"
];

const stableTerms = [
  "CNN",
  "RNN",
  "LSTM",
  "GRU",
  "PCA",
  "SVM",
  "GAN",
  "BERT",
  "GPT",
  "ResNet",
  "Transformer",
  "MDP",
  "DQN",
  "PPO",
  "A2C",
  "Q-learning",
  "YOLO",
  "ViT",
  "\u94fe\u5f0f\u6cd5\u5219",
  "\u53cd\u5411\u4f20\u64ad",
  "\u68af\u5ea6\u4e0b\u964d",
  "\u635f\u5931\u51fd\u6570",
  "\u5377\u79ef\u795e\u7ecf\u7f51\u7edc",
  "\u5faa\u73af\u795e\u7ecf\u7f51\u7edc",
  "\u6ce8\u610f\u529b\u673a\u5236",
  "\u652f\u6301\u5411\u91cf\u673a",
  "\u4e3b\u6210\u5206\u5206\u6790",
  "\u751f\u6210\u5bf9\u6297\u7f51\u7edc",
  "\u9a6c\u5c14\u53ef\u592b\u51b3\u7b56\u8fc7\u7a0b",
  "\u4ef7\u503c\u51fd\u6570",
  "\u7b56\u7565\u68af\u5ea6",
  "\u5377\u79ef\u5c42",
  "\u6c60\u5316\u5c42"
];

const acceptedRoles = new Set<CandidateConcept["contextRole"]>(["main_topic", "explicit_question", "key_prerequisite", "application"]);

function clampScore(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function textIncludes(text: string, term: string) {
  if (!term) return false;
  return text.toLowerCase().includes(term.toLowerCase());
}

function isHardReject(name: string) {
  const key = normalizeConceptKey(name);
  return hardRejectTerms.some((term) => normalizeConceptKey(term) === key);
}

function isTooBroad(name: string) {
  const key = normalizeConceptKey(name);
  return tooBroadTerms.some((term) => normalizeConceptKey(term) === key);
}

function mergeByKey(candidates: ExtractedConceptCandidate[]) {
  const byKey = new Map<string, ExtractedConceptCandidate>();
  candidates.forEach((candidate) => {
    const existing = byKey.get(candidate.normalizedKey);
    if (!existing) {
      byKey.set(candidate.normalizedKey, candidate);
      return;
    }
    byKey.set(candidate.normalizedKey, {
      ...existing,
      aliases: Array.from(new Set([...existing.aliases, ...candidate.aliases])),
      suggestedCategory: existing.suggestedCategory || candidate.suggestedCategory,
      educationalValue: Math.max(existing.educationalValue, candidate.educationalValue),
      noiseRisk: Math.min(existing.noiseRisk, candidate.noiseRisk),
      confidence: Math.max(existing.confidence, candidate.confidence),
      reason: existing.reason.length >= candidate.reason.length ? existing.reason : candidate.reason,
      decision: existing.decision === "link_existing" || candidate.decision === "link_existing" ? "link_existing" : existing.decision,
      matchedConceptId: existing.matchedConceptId || candidate.matchedConceptId
    });
  });
  return Array.from(byKey.values());
}

export function normalizeExtractedCandidate(
  candidate: Partial<ExtractedConceptCandidate> & { surfaceText: string },
  input: ConceptExtractionInput
): ExtractedConceptCandidate {
  const knownPool = [...input.knownConcepts, ...input.pendingCandidates];
  const canonical = canonicalizeConceptName(candidate.canonicalName || candidate.surfaceText, knownPool);
  const matchedKnown = resolveKnownConcept(canonical.canonicalName, input.knownConcepts);
  const broad = isTooBroad(canonical.canonicalName);
  const role = candidate.contextRole ?? "explicit_question";
  const granularity = candidate.granularity ?? (broad ? "too_broad" : "good");
  const educationalValue = clampScore(candidate.educationalValue, broad ? 0.45 : 0.76);
  const noiseRisk = clampScore(candidate.noiseRisk, broad ? 0.45 : 0.18);
  return {
    surfaceText: candidate.surfaceText,
    canonicalName: canonical.canonicalName,
    aliases: Array.from(new Set([...canonical.aliases, ...(candidate.aliases ?? [])])),
    normalizedKey: canonical.normalizedKey,
    suggestedCategory: candidate.suggestedCategory,
    candidateType: candidate.candidateType ?? "concept",
    contextRole: role,
    educationalValue,
    noiseRisk,
    granularity,
    shouldCreateOrLinkCard: candidate.shouldCreateOrLinkCard ?? true,
    matchedConceptId: candidate.matchedConceptId || (matchedKnown ? ("id" in matchedKnown ? matchedKnown.id : undefined) : undefined),
    decision: candidate.decision ?? (matchedKnown ? "link_existing" : "pending_review"),
    reason: candidate.reason || "rule_or_llm_candidate",
    confidence: clampScore(candidate.confidence, 0.72)
  };
}

export function extractConceptCandidatesByRules(input: ConceptExtractionInput): ExtractedConceptCandidate[] {
  const haystack = `${input.rawText || ""}\n${input.contextText || ""}`;
  const rawCandidates: Array<Partial<ExtractedConceptCandidate> & { surfaceText: string }> = [];

  input.knownConcepts.forEach((concept) => {
    const names = [concept.canonicalName || concept.name, concept.name, ...(concept.aliases ?? [])].filter(Boolean);
    if (names.some((name) => textIncludes(haystack, name))) {
      rawCandidates.push({
        surfaceText: concept.canonicalName || concept.name,
        suggestedCategory: concept.category,
        educationalValue: 0.86,
        noiseRisk: 0.08,
        contextRole: "explicit_question",
        decision: "link_existing",
        matchedConceptId: concept.id,
        reason: "matched_existing_concept",
        confidence: 0.88
      });
    }
  });

  stableTerms.forEach((term) => {
    if (textIncludes(haystack, term)) {
      rawCandidates.push({
        surfaceText: term,
        educationalValue: 0.78,
        noiseRisk: 0.16,
        contextRole: input.sourceType === "document" ? "main_topic" : "explicit_question",
        reason: "matched_stable_term",
        confidence: 0.78
      });
    }
  });

  return mergeByKey(rawCandidates.map((candidate) => normalizeExtractedCandidate(candidate, input)));
}

export function filterExtractedCandidates(candidates: ExtractedConceptCandidate[], sourceType: ConceptExtractionSource): ExtractedConceptCandidate[] {
  const threshold = thresholds[sourceType];
  return mergeByKey(candidates).filter((candidate) => {
    if (!candidate.surfaceText || !candidate.canonicalName) return false;
    if (isHardReject(candidate.surfaceText) || isHardReject(candidate.canonicalName)) return false;
    if (candidate.granularity === "invalid" || candidate.granularity === "too_narrow") return false;
    if (candidate.granularity === "too_broad" && candidate.educationalValue < 0.9) return false;
    if (!acceptedRoles.has(candidate.contextRole) && !(sourceType === "document" && candidate.educationalValue >= 0.75)) return false;
    return candidate.educationalValue >= threshold.educationalValue && candidate.noiseRisk <= threshold.noiseRisk;
  });
}

export function toPendingCandidateConcept(candidate: ExtractedConceptCandidate, sourceType: ConceptExtractionSource): CandidateConcept {
  return {
    id: `candidate_${candidate.normalizedKey}`,
    canonicalName: candidate.canonicalName,
    aliases: candidate.aliases,
    normalizedKey: candidate.normalizedKey,
    suggestedCategory: candidate.suggestedCategory,
    summary: candidate.reason,
    reason: candidate.reason,
    source: sourceType,
    status: "pending",
    createdAt: new Date().toISOString(),
    surfaceText: candidate.surfaceText,
    candidateType: candidate.candidateType,
    contextRole: candidate.contextRole,
    educationalValue: candidate.educationalValue,
    noiseRisk: candidate.noiseRisk,
    granularity: candidate.granularity,
    extractionConfidence: candidate.confidence,
    matchedConceptId: candidate.matchedConceptId,
    decision: candidate.decision,
    decisionReason: candidate.reason
  };
}

function candidatesFromLLM(input: ConceptExtractionInput): ExtractedConceptCandidate[] {
  return (input.llmCandidates ?? [])
    .filter((candidate) => candidate.name && candidate.shouldAddToCourse !== false)
    .map((candidate) =>
      normalizeExtractedCandidate(
        {
          surfaceText: candidate.name,
          suggestedCategory: candidate.category,
          candidateType: candidate.candidateType ?? "concept",
          contextRole: candidate.contextRole ?? (candidate.status === "existing" ? "explicit_question" : "main_topic"),
          educationalValue: candidate.educationalValue,
          noiseRisk: candidate.noiseRisk,
          granularity: candidate.granularity,
          reason: candidate.reason,
          confidence: candidate.confidence,
          decision: candidate.status === "existing" ? "link_existing" : "pending_review"
        },
        input
      )
    );
}

export function processConceptExtraction(input: ConceptExtractionInput): {
  acceptedCandidates: CandidateConcept[];
  linkedConceptKeys: string[];
  rejectedCandidates: ExtractedConceptCandidate[];
} {
  const allCandidates = mergeByKey([...candidatesFromLLM(input), ...extractConceptCandidatesByRules(input)]);
  const accepted = filterExtractedCandidates(allCandidates, input.sourceType);
  const acceptedKeys = new Set(accepted.map((candidate) => candidate.normalizedKey));
  const rejectedCandidates = allCandidates.filter((candidate) => !acceptedKeys.has(candidate.normalizedKey));
  const linkedConceptKeys = Array.from(
    new Set(
      accepted
        .filter((candidate) => candidate.decision === "link_existing" || resolveKnownConcept(candidate.canonicalName, input.knownConcepts))
        .map((candidate) => candidate.normalizedKey)
    )
  );
  const confirmedKeys = new Set(input.knownConcepts.map((concept) => concept.normalizedKey || normalizeConceptKey(concept.canonicalName || concept.name)));
  const acceptedCandidates = accepted
    .filter((candidate) => !confirmedKeys.has(candidate.normalizedKey))
    .map((candidate) => toPendingCandidateConcept({ ...candidate, decision: "pending_review" }, input.sourceType));
  return { acceptedCandidates, linkedConceptKeys, rejectedCandidates };
}
