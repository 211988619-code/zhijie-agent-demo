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

export type ConceptGranularityAssessment = {
  granularity: "good" | "too_broad" | "too_narrow" | "invalid";
  ambiguityRisk: number;
  needsContextExpansion: boolean;
  expandedName?: string;
  reason: string;
};

type Threshold = { educationalValue: number; noiseRisk: number };

const thresholds: Record<ConceptExtractionSource, Threshold> = {
  chat: { educationalValue: 0.72, noiseRisk: 0.28 },
  quiz: { educationalValue: 0.68, noiseRisk: 0.32 },
  quiz_explanation: { educationalValue: 0.68, noiseRisk: 0.32 },
  related_concept: { educationalValue: 0.65, noiseRisk: 0.35 },
  document: { educationalValue: 0.7, noiseRisk: 0.3 }
};

const hardRejectTerms = [
  "\u4f60\u597d",
  "\u60a8\u597d",
  "hello",
  "hi",
  "hey",
  "\u8c22\u8c22",
  "\u518d\u89c1",
  "\u597d\u7684",
  "\u55ef",
  "\u5e2e\u6211",
  "\u89e3\u91ca\u4e00\u4e0b",
  "\u80fd\u4e0d\u80fd",
  "\u4e3a\u4ec0\u4e48",
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

const instructionPhrases = [
  "\u5e2e\u6211",
  "\u89e3\u91ca\u4e00\u4e0b",
  "\u80fd\u4e0d\u80fd",
  "\u8bf7\u4f60",
  "\u544a\u8bc9\u6211",
  "\u600e\u4e48\u7406\u89e3",
  "\u662f\u4ec0\u4e48\u610f\u601d",
  "\u4ec0\u4e48\u610f\u601d"
];

const headingNoiseTerms = [
  "\u76ee\u5f55",
  "\u7eea\u8bba",
  "\u5f15\u8a00",
  "\u603b\u7ed3",
  "\u672c\u7ae0\u5c0f\u7ed3",
  "\u4e60\u9898",
  "\u7ec3\u4e60",
  "\u53c2\u8003\u6587\u732e",
  "\u5b66\u4e60\u76ee\u6807",
  "\u6559\u5b66\u76ee\u6807",
  "\u6848\u4f8b",
  "\u5b9e\u9a8c",
  "\u4f5c\u4e1a"
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

const genericAbstractTerms = [
  "\u72b6\u6001",
  "\u52a8\u4f5c",
  "\u5956\u52b1",
  "\u7b56\u7565",
  "\u95ee\u9898",
  "\u65b9\u6cd5",
  "\u8fc7\u7a0b",
  "\u7cfb\u7edf",
  "\u6846\u67b6",
  "\u76ee\u6807",
  "\u4efb\u52a1",
  "\u65b9\u7a0b",
  "\u6b65\u9aa4"
];

const ambiguousTermExpansionRules = [
  {
    terms: ["\u72b6\u6001"],
    contextKeywords: ["\u5f3a\u5316\u5b66\u4e60", "MDP", "\u9a6c\u5c14\u53ef\u592b\u51b3\u7b56\u8fc7\u7a0b", "\u8d1d\u5c14\u66fc\u65b9\u7a0b", "\u4ef7\u503c\u51fd\u6570"],
    expandedName: "\u72b6\u6001\u7a7a\u95f4"
  },
  {
    terms: ["\u52a8\u4f5c"],
    contextKeywords: ["\u5f3a\u5316\u5b66\u4e60", "MDP", "\u9a6c\u5c14\u53ef\u592b\u51b3\u7b56\u8fc7\u7a0b", "\u8d1d\u5c14\u66fc\u65b9\u7a0b", "\u7b56\u7565"],
    expandedName: "\u52a8\u4f5c\u7a7a\u95f4"
  },
  {
    terms: ["\u5956\u52b1"],
    contextKeywords: ["\u5f3a\u5316\u5b66\u4e60", "MDP", "\u9a6c\u5c14\u53ef\u592b\u51b3\u7b56\u8fc7\u7a0b", "\u8d1d\u5c14\u66fc\u65b9\u7a0b", "\u56de\u62a5"],
    expandedName: "\u5956\u52b1\u51fd\u6570"
  },
  {
    terms: ["\u7b56\u7565"],
    contextKeywords: ["\u5f3a\u5316\u5b66\u4e60", "MDP", "\u9a6c\u5c14\u53ef\u592b\u51b3\u7b56\u8fc7\u7a0b", "\u8d1d\u5c14\u66fc\u65b9\u7a0b", "\u52a8\u4f5c"],
    expandedName: "\u7b56\u7565\u51fd\u6570"
  },
  {
    terms: ["\u635f\u5931"],
    contextKeywords: ["\u673a\u5668\u5b66\u4e60", "\u6df1\u5ea6\u5b66\u4e60", "\u8bad\u7ec3", "\u4f18\u5316", "\u68af\u5ea6"],
    expandedName: "\u635f\u5931\u51fd\u6570"
  },
  {
    terms: ["\u68af\u5ea6"],
    contextKeywords: ["\u673a\u5668\u5b66\u4e60", "\u6df1\u5ea6\u5b66\u4e60", "\u8bad\u7ec3", "\u4f18\u5316", "\u53cd\u5411\u4f20\u64ad"],
    expandedName: "\u68af\u5ea6"
  }
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
  "\u8d1d\u5c14\u66fc\u65b9\u7a0b",
  "\u72b6\u6001\u7a7a\u95f4",
  "\u52a8\u4f5c\u7a7a\u95f4",
  "\u5956\u52b1\u51fd\u6570",
  "\u7b56\u7565\u51fd\u6570",
  "\u9a6c\u5c14\u53ef\u592b\u51b3\u7b56\u8fc7\u7a0b",
  "\u4ef7\u503c\u51fd\u6570",
  "\u7b56\u7565\u68af\u5ea6",
  "\u5377\u79ef\u5c42",
  "\u6c60\u5316\u5c42"
];

const acceptedRoles = new Set<CandidateConcept["contextRole"]>(["main_topic", "explicit_question", "key_prerequisite", "application"]);

export function stripHeadingNumber(value: string) {
  return String(value ?? "")
    .replace(/^#+\s*/, "")
    .replace(/^\s*\d+(\.\d+)*[\u3001.)\s-]*/, "")
    .replace(/^\s*\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\d]+[\u7ae0\u8282\u8bfe\u8bb2]\s*/, "")
    .trim();
}

export function normalizeCandidateSurface(value: string) {
  return stripHeadingNumber(value)
    .trim()
    .replace(/[\uff08]/g, "(")
    .replace(/[\uff09]/g, ")")
    .replace(/[\uff0c\u3002\uff01\uff1f\u3001\uff1b\uff1a,.!?;:"'\u201c\u201d\u2018\u2019\u300a\u300b\u3010\u3011\[\]{}]/g, "")
    .replace(/[*_`#>~|]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

export function isHeadingNoise(value: string) {
  const cleaned = stripHeadingNumber(value);
  const normalized = normalizeCandidateSurface(cleaned);
  if (!cleaned || !normalized) return true;
  if (cleaned.length > 24) return true;
  if (/^\d+(\.\d+)*$/.test(cleaned)) return true;
  if (cleaned.split(/[\u3001\uff0c,]/).length > 2) return true;
  return headingNoiseTerms.some((term) => normalizeCandidateSurface(term) === normalized);
}

function clampScore(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function textIncludes(text: string, term: string) {
  if (!term) return false;
  return text.toLowerCase().includes(term.toLowerCase());
}

function isInstructionPhrase(value: string) {
  const normalized = normalizeCandidateSurface(value);
  if (!normalized) return true;
  return instructionPhrases.some((phrase) => normalized.includes(normalizeCandidateSurface(phrase)));
}

function isHardReject(name: string) {
  const key = normalizeCandidateSurface(name);
  if (!key) return true;
  return (
    hardRejectTerms.some((term) => {
      const termKey = normalizeCandidateSurface(term);
      return key === termKey || (key.length <= 10 && key.includes(termKey));
    }) || isInstructionPhrase(name)
  );
}

function isTooBroad(name: string) {
  const key = normalizeCandidateSurface(name);
  return tooBroadTerms.some((term) => normalizeCandidateSurface(term) === key);
}

function isGenericAbstract(name: string) {
  const key = normalizeCandidateSurface(name);
  return genericAbstractTerms.some((term) => normalizeCandidateSurface(term) === key);
}

function hasContextKeyword(context: string, keywords: string[]) {
  const normalizedContext = normalizeCandidateSurface(context);
  return keywords.some((keyword) => normalizedContext.includes(normalizeCandidateSurface(keyword)));
}

export function assessConceptGranularity(candidate: string, context = ""): ConceptGranularityAssessment {
  const cleaned = stripHeadingNumber(candidate);
  const normalized = normalizeCandidateSurface(cleaned);
  if (!normalized) return { granularity: "invalid", ambiguityRisk: 1, needsContextExpansion: false, reason: "empty_candidate" };
  if (/^[\u4e00-\u9fa5]$/.test(cleaned)) return { granularity: "invalid", ambiguityRisk: 0.95, needsContextExpansion: false, reason: "single_cjk_character" };
  if (isHardReject(cleaned)) return { granularity: "invalid", ambiguityRisk: 1, needsContextExpansion: false, reason: "hard_reject_or_instruction_phrase" };
  if (isTooBroad(cleaned)) return { granularity: "too_broad", ambiguityRisk: 0.9, needsContextExpansion: false, reason: "domain_or_category_term" };

  const expansion = ambiguousTermExpansionRules.find((rule) => rule.terms.some((term) => normalizeCandidateSurface(term) === normalized));
  if (expansion) {
    if (hasContextKeyword(context, expansion.contextKeywords)) {
      return {
        granularity: "good",
        ambiguityRisk: 0.34,
        needsContextExpansion: true,
        expandedName: expansion.expandedName,
        reason: "ambiguous_term_expanded_by_context"
      };
    }
    return { granularity: "invalid", ambiguityRisk: 0.88, needsContextExpansion: true, reason: "ambiguous_term_without_supporting_context" };
  }

  if (isGenericAbstract(cleaned)) return { granularity: "invalid", ambiguityRisk: 0.82, needsContextExpansion: true, reason: "generic_abstract_term" };
  if (/^[\u4e00-\u9fa5]{2}$/.test(cleaned) && !stableTerms.some((term) => normalizeCandidateSurface(term) === normalized)) {
    return { granularity: "invalid", ambiguityRisk: 0.72, needsContextExpansion: true, reason: "short_cjk_term_requires_explicit_expansion" };
  }
  if (cleaned.length > 48) return { granularity: "too_narrow", ambiguityRisk: 0.45, needsContextExpansion: false, reason: "candidate_too_long" };
  return { granularity: "good", ambiguityRisk: 0.18, needsContextExpansion: false, reason: "stable_teachable_boundary" };
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
  const surfaceText = stripHeadingNumber(candidate.surfaceText);
  const context = `${input.rawText || ""}\n${input.contextText || ""}`;
  const initialName = stripHeadingNumber(candidate.canonicalName || surfaceText);
  const initialAssessment = assessConceptGranularity(initialName, context);
  const canonical = canonicalizeConceptName(initialAssessment.expandedName || initialName, knownPool);
  const matchedKnown = resolveKnownConcept(canonical.canonicalName, input.knownConcepts);
  const finalAssessment = matchedKnown ? { ...initialAssessment, granularity: "good" as const, reason: `${initialAssessment.reason}; matched_known_concept` } : assessConceptGranularity(canonical.canonicalName, context);
  const broad = isTooBroad(canonical.canonicalName) || finalAssessment.granularity === "too_broad";
  const role = candidate.contextRole ?? "unknown";
  const requestedGranularity = candidate.granularity && candidate.granularity !== "unknown" ? candidate.granularity : finalAssessment.granularity;
  const granularity = matchedKnown ? "good" : broad ? "too_broad" : requestedGranularity;
  const educationalFallback = matchedKnown ? 0.84 : broad || finalAssessment.granularity === "invalid" ? 0.42 : initialAssessment.expandedName ? 0.76 : 0.52;
  const noiseFallback = matchedKnown ? 0.18 : broad || finalAssessment.granularity === "invalid" ? 0.52 : initialAssessment.expandedName ? 0.22 : 0.42;
  return {
    surfaceText,
    canonicalName: canonical.canonicalName,
    aliases: Array.from(new Set([...canonical.aliases, ...(candidate.aliases ?? [])])),
    normalizedKey: canonical.normalizedKey,
    suggestedCategory: candidate.suggestedCategory,
    candidateType: candidate.candidateType ?? "unknown",
    contextRole: role,
    educationalValue: clampScore(candidate.educationalValue, educationalFallback),
    noiseRisk: clampScore(candidate.noiseRisk, noiseFallback),
    granularity,
    shouldCreateOrLinkCard: candidate.shouldCreateOrLinkCard ?? true,
    matchedConceptId: candidate.matchedConceptId || (matchedKnown ? ("id" in matchedKnown ? matchedKnown.id : undefined) : undefined),
    decision: candidate.decision ?? (matchedKnown ? "link_existing" : "pending_review"),
    reason: [candidate.reason || "rule_or_llm_candidate", finalAssessment.reason].filter(Boolean).join("; "),
    confidence: clampScore(candidate.confidence, matchedKnown ? 0.78 : initialAssessment.expandedName ? 0.72 : 0.52)
  };
}

export function extractConceptCandidatesByRules(input: ConceptExtractionInput): ExtractedConceptCandidate[] {
  const haystack = `${input.rawText || ""}\n${input.contextText || ""}`;
  const rawCandidates: Array<Partial<ExtractedConceptCandidate> & { surfaceText: string }> = [];

  input.knownConcepts.forEach((concept) => {
    const names = [concept.canonicalName || concept.name, concept.name, ...(concept.aliases ?? [])].filter((name): name is string => Boolean(name));
    if (names.some((name) => textIncludes(haystack, name))) {
      rawCandidates.push({
        surfaceText: concept.canonicalName || concept.name,
        suggestedCategory: concept.category,
        educationalValue: 0.86,
        noiseRisk: 0.08,
        contextRole: "explicit_question",
        candidateType: "concept",
        granularity: "good",
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
        candidateType: "concept",
        granularity: "good",
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
    if (isTooBroad(candidate.surfaceText) || isTooBroad(candidate.canonicalName)) return false;
    if (isGenericAbstract(candidate.surfaceText) || isGenericAbstract(candidate.canonicalName)) return false;
    if (isHeadingNoise(candidate.surfaceText) && sourceType === "document" && candidate.reason !== "matched_stable_term" && candidate.reason !== "matched_existing_concept") return false;
    if (candidate.granularity === "invalid" || candidate.granularity === "too_narrow" || candidate.granularity === "unknown") return false;
    if (candidate.granularity === "too_broad") return false;
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
    .filter((candidate) => candidate.name && (candidate.status === "existing" || candidate.shouldAddToCourse !== false))
    .map((candidate) => {
      const isExisting = candidate.status === "existing";
      const isDetectedCandidate = candidate.status === "candidate";
      return normalizeExtractedCandidate(
        {
          surfaceText: candidate.name,
          suggestedCategory: candidate.category,
          candidateType: isExisting ? "concept" : candidate.candidateType,
          contextRole: isExisting ? "explicit_question" : candidate.contextRole ?? (isDetectedCandidate ? "unknown" : undefined),
          educationalValue: isExisting ? 0.84 : candidate.educationalValue ?? (isDetectedCandidate ? 0.48 : undefined),
          noiseRisk: isExisting ? 0.18 : candidate.noiseRisk ?? (isDetectedCandidate ? 0.48 : undefined),
          granularity: isExisting ? "good" : candidate.granularity ?? (isDetectedCandidate ? "unknown" : undefined),
          reason: candidate.reason,
          confidence: isExisting ? 0.78 : candidate.confidence,
          decision: isExisting ? "link_existing" : "pending_review"
        },
        input
      );
    });
}

export function processConceptExtraction(input: ConceptExtractionInput): {
  acceptedCandidates: CandidateConcept[];
  linkedConceptKeys: string[];
  rejectedCandidates: ExtractedConceptCandidate[];
} {
  const rawCandidates = [...candidatesFromLLM(input), ...extractConceptCandidatesByRules(input)];
  const hardRejected = rawCandidates.filter((candidate) => isHardReject(candidate.surfaceText) || isHardReject(candidate.canonicalName) || isTooBroad(candidate.surfaceText) || isTooBroad(candidate.canonicalName));
  const allCandidates = mergeByKey(
    rawCandidates.filter((candidate) => !isHardReject(candidate.surfaceText) && !isHardReject(candidate.canonicalName) && !isTooBroad(candidate.surfaceText) && !isTooBroad(candidate.canonicalName))
  );
  const accepted = filterExtractedCandidates(allCandidates, input.sourceType);
  const acceptedKeys = new Set(accepted.map((candidate) => candidate.normalizedKey));
  const rejectedCandidates = [...hardRejected, ...allCandidates.filter((candidate) => !acceptedKeys.has(candidate.normalizedKey))];
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
  const devEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
  if (devEnv) {
    console.debug("[concept-extraction]", {
      sourceType: input.sourceType,
      rawCount: rawCandidates.length,
      accepted: accepted.map((candidate) => ({
        name: candidate.canonicalName,
        educationalValue: candidate.educationalValue,
        noiseRisk: candidate.noiseRisk,
        granularity: candidate.granularity,
        contextRole: candidate.contextRole
      })),
      rejected: rejectedCandidates.map((candidate) => ({
        name: candidate.surfaceText,
        canonicalName: candidate.canonicalName,
        educationalValue: candidate.educationalValue,
        noiseRisk: candidate.noiseRisk,
        granularity: candidate.granularity,
        contextRole: candidate.contextRole,
        reason: candidate.reason
      }))
    });
  }
  return { acceptedCandidates, linkedConceptKeys, rejectedCandidates };
}
