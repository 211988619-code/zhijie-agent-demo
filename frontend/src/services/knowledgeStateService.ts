import type { CandidateConcept, ConceptExtractionSource, KnowledgeCard, KnowledgeConcept, MasteryRecord, NewConceptCandidate } from "../types";
import { canonicalizeConceptName, getTerminologyCategoryHint, mergeAliases, normalizeConceptKey } from "./conceptIdentity";
import { buildFallbackKnowledgeCard, normalizeCard, upsertCards } from "./knowledgeCardService";
import { conceptIdFromName, upsertMastery } from "./masteryService";

const now = () => new Date().toISOString();

const pendingCategoryLabels = new Set([
  "\u5f85\u786e\u8ba4\u65b0\u6982\u5ff5",
  "\u5f85\u786e\u8ba4",
  "pending",
  "pending review",
  "unknown",
  "new concept",
  ""
]);

export function sanitizeKnowledgeCategory(category?: string | null) {
  const value = String(category ?? "").trim();
  if (!value) return "\u5f85\u5206\u7c7b";
  const normalized = value.toLowerCase();
  if (
    pendingCategoryLabels.has(value) ||
    pendingCategoryLabels.has(normalized) ||
    value.includes("\u5f85\u786e\u8ba4") ||
    value.includes("\u65b0\u6982\u5ff5")
  ) {
    return "\u5f85\u5206\u7c7b";
  }
  return value;
}

export function isPendingCategoryLabel(category?: string | null) {
  return sanitizeKnowledgeCategory(category) === "\u5f85\u5206\u7c7b";
}

type CandidateInput = NewConceptCandidate | {
  name: string;
  category?: string;
  reason?: string;
  source?: ConceptExtractionSource;
  surfaceText?: string;
  candidateType?: CandidateConcept["candidateType"];
  contextRole?: CandidateConcept["contextRole"];
  educationalValue?: number;
  noiseRisk?: number;
  granularity?: CandidateConcept["granularity"];
  extractionConfidence?: number;
  matchedConceptId?: string;
  decision?: CandidateConcept["decision"];
  decisionReason?: string;
};

export function toCandidateConcept(
  candidate: CandidateInput,
  known: Array<KnowledgeConcept | CandidateConcept> = [],
  source: CandidateConcept["source"] = "chat"
): CandidateConcept {
  const canonical = canonicalizeConceptName(candidate.name, known);
  return {
    id: `candidate_${canonical.normalizedKey}`,
    canonicalName: canonical.canonicalName,
    aliases: canonical.aliases,
    normalizedKey: canonical.normalizedKey,
    suggestedCategory: sanitizeKnowledgeCategory(candidate.category),
    summary: candidate.reason,
    reason: candidate.reason,
    source: "source" in candidate && candidate.source ? candidate.source : source,
    status: "pending",
    createdAt: now(),
    surfaceText: "surfaceText" in candidate ? candidate.surfaceText : candidate.name,
    candidateType: "candidateType" in candidate ? candidate.candidateType : undefined,
    contextRole: "contextRole" in candidate ? candidate.contextRole : undefined,
    educationalValue: "educationalValue" in candidate ? candidate.educationalValue : undefined,
    noiseRisk: "noiseRisk" in candidate ? candidate.noiseRisk : undefined,
    granularity: "granularity" in candidate ? candidate.granularity : undefined,
    extractionConfidence: "extractionConfidence" in candidate ? candidate.extractionConfidence : "confidence" in candidate ? candidate.confidence : undefined,
    matchedConceptId: "matchedConceptId" in candidate ? candidate.matchedConceptId : undefined,
    decision: "decision" in candidate ? candidate.decision : undefined,
    decisionReason: "decisionReason" in candidate ? candidate.decisionReason : candidate.reason
  };
}

function mostInformative(current?: string, incoming?: string) {
  if (!incoming) return current;
  if (!current) return incoming;
  return incoming.length > current.length ? incoming : current;
}

function mergeCandidateConcept(existing: CandidateConcept, incoming: CandidateConcept): CandidateConcept {
  return {
    ...existing,
    aliases: mergeAliases(existing.aliases, incoming.aliases, existing.canonicalName),
    suggestedCategory: incoming.suggestedCategory || existing.suggestedCategory,
    summary: mostInformative(existing.summary, incoming.summary),
    reason: mostInformative(existing.reason, incoming.reason),
    source: incoming.source || existing.source,
    surfaceText: existing.surfaceText || incoming.surfaceText,
    candidateType: incoming.candidateType || existing.candidateType,
    contextRole: incoming.contextRole || existing.contextRole,
    educationalValue: Math.max(existing.educationalValue ?? 0, incoming.educationalValue ?? 0) || existing.educationalValue || incoming.educationalValue,
    noiseRisk:
      existing.noiseRisk === undefined
        ? incoming.noiseRisk
        : incoming.noiseRisk === undefined
          ? existing.noiseRisk
          : Math.min(existing.noiseRisk, incoming.noiseRisk),
    granularity: incoming.granularity === "good" ? incoming.granularity : existing.granularity || incoming.granularity,
    extractionConfidence: Math.max(existing.extractionConfidence ?? 0, incoming.extractionConfidence ?? 0) || existing.extractionConfidence || incoming.extractionConfidence,
    matchedConceptId: existing.matchedConceptId || incoming.matchedConceptId,
    decision: existing.decision === "link_existing" || incoming.decision === "link_existing" ? "link_existing" : incoming.decision || existing.decision,
    decisionReason: mostInformative(existing.decisionReason, incoming.decisionReason)
  };
}

export function upsertCandidateConcept(candidates: CandidateConcept[], incoming: CandidateConcept, confirmed: KnowledgeConcept[]) {
  const confirmedKeys = new Set(confirmed.map((concept) => concept.normalizedKey || normalizeConceptKey(concept.canonicalName || concept.name)));
  if (confirmedKeys.has(incoming.normalizedKey)) return candidates.filter((candidate) => candidate.normalizedKey !== incoming.normalizedKey);

  const existing = candidates.find((candidate) => candidate.normalizedKey === incoming.normalizedKey);
  if (!existing) return [incoming, ...candidates];
  return candidates.map((candidate) => (candidate.normalizedKey === incoming.normalizedKey ? mergeCandidateConcept(candidate, incoming) : candidate));
}

export function classifyConceptFallback(conceptName: string, aliases: string[] = []) {
  const registryHint = getTerminologyCategoryHint(conceptName) || aliases.map(getTerminologyCategoryHint).find(Boolean);
  if (registryHint) return registryHint;
  const text = [conceptName, ...aliases].join(" ").toLowerCase();
  if (/(tcp|\bip\b|dns|http|routing|congestion|computer network|\u8ba1\u7b97\u673a\u7f51\u7edc|\u62e5\u585e\u63a7\u5236|\u8def\u7531)/i.test(text)) return "\u8ba1\u7b97\u673a\u7f51\u7edc";
  if (/(operating system|process|thread|virtual memory|deadlock|scheduling|file system|\u64cd\u4f5c\u7cfb\u7edf|\u8fdb\u7a0b|\u7ebf\u7a0b|\u865a\u62df\u5185\u5b58|\u6b7b\u9501|\u8c03\u5ea6)/i.test(text)) return "\u64cd\u4f5c\u7cfb\u7edf";
  if (/(cache|pipeline|bus|address|computer architecture|\u7f13\u5b58|\u6307\u4ee4\u6d41\u6c34\u7ebf|\u603b\u7ebf|\u5730\u5740)/i.test(text)) return "\u8ba1\u7b97\u673a\u7cfb\u7edf";
  if (/(database|sql|transaction|index|normal form|normalization|\u6570\u636e\u5e93|\u4e8b\u52a1|\u7d22\u5f15|\u8303\u5f0f)/i.test(text)) return "\u6570\u636e\u5e93\u7cfb\u7edf";
  if (/(lexical|syntax|parsing|compiler|intermediate representation|register allocation|\u8bcd\u6cd5\u5206\u6790|\u8bed\u6cd5\u5206\u6790|\u7f16\u8bd1|\u4e2d\u95f4\u4ee3\u7801|\u5bc4\u5b58\u5668\u5206\u914d)/i.test(text)) return "\u7f16\u8bd1\u539f\u7406";
  if (/(linked list|tree|graph|sort|dynamic programming|\u94fe\u8868|\u6811|\u56fe|\u6392\u5e8f|\u52a8\u6001\u89c4\u5212)/i.test(text)) return "\u6570\u636e\u7ed3\u6784\u4e0e\u7b97\u6cd5";
  if (/(mdp|bellman|q-learning|ppo|dqn|reward function|value function|policy function|\u8d1d\u5c14\u66fc|\u9a6c\u5c14\u53ef\u592b|\u5956\u52b1\u51fd\u6570|\u4ef7\u503c\u51fd\u6570|\u7b56\u7565\u51fd\u6570|\u5f3a\u5316\u5b66\u4e60)/i.test(text)) return "\u5f3a\u5316\u5b66\u4e60";
  if (/(cnn|rnn|lstm|resnet|transformer|attention|bert|gpt|gan|convolutional neural network|\u5377\u79ef\u795e\u7ecf\u7f51\u7edc|\u5faa\u73af\u795e\u7ecf\u7f51\u7edc|\u6ce8\u610f\u529b\u673a\u5236|\u6df1\u5ea6)/i.test(text)) return "\u6df1\u5ea6\u5b66\u4e60";
  if (/(gradient|loss|overfit|regularization|svm|pca|\u68af\u5ea6|\u635f\u5931\u51fd\u6570|\u8fc7\u62df\u5408|\u6b63\u5219\u5316|\u673a\u5668\u5b66\u4e60)/i.test(text)) return "\u673a\u5668\u5b66\u4e60\u57fa\u7840";
  if (/(derivative|chain rule|matrix|probability|\u5bfc\u6570|\u94fe\u5f0f\u6cd5\u5219|\u77e9\u9635|\u6982\u7387|\u51fd\u6570|\u6570\u5b66)/i.test(text)) return "\u6570\u5b66\u57fa\u7840";
  return "\u5f85\u5206\u7c7b";
}


function canonicalizeConcept(concept: KnowledgeConcept, known: KnowledgeConcept[] = []): KnowledgeConcept {
  const canonical = canonicalizeConceptName(concept.canonicalName || concept.name, known);
  return {
    ...concept,
    id: concept.id || conceptIdFromName(canonical.canonicalName),
    name: canonical.canonicalName,
    canonicalName: canonical.canonicalName,
    aliases: mergeAliases(concept.aliases ?? [], canonical.aliases, canonical.canonicalName),
    normalizedKey: canonical.normalizedKey,
    status: "existing",
    category: sanitizeKnowledgeCategory(concept.category || classifyConceptFallback(canonical.canonicalName, canonical.aliases)),
    cardId: concept.cardId || conceptIdFromName(canonical.canonicalName),
    createdAt: concept.createdAt || now()
  };
}

export function reconcileKnowledgeState({
  concepts,
  cards,
  mastery,
  candidates
}: {
  concepts: KnowledgeConcept[];
  cards: KnowledgeCard[];
  mastery: MasteryRecord[];
  candidates: CandidateConcept[];
}) {
  const conceptByKey = new Map<string, KnowledgeConcept>();
  const migratedCandidates: CandidateConcept[] = [];
  concepts.forEach((concept) => {
    if (concept.status === "candidate" || isPendingCategoryLabel(concept.category)) {
      migratedCandidates.push(
        toCandidateConcept(
          {
            name: concept.canonicalName || concept.name,
            category: sanitizeKnowledgeCategory(concept.category),
            reason: concept.reason,
            source: "chat"
          },
          [...Array.from(conceptByKey.values()), ...migratedCandidates],
          "chat"
        )
      );
      return;
    }
    const canonical = canonicalizeConcept(concept, Array.from(conceptByKey.values()));
    const previous = conceptByKey.get(canonical.normalizedKey || normalizeConceptKey(canonical.name));
    conceptByKey.set(canonical.normalizedKey || normalizeConceptKey(canonical.name), {
      ...canonical,
      id: previous?.id || canonical.id,
      aliases: mergeAliases(previous?.aliases, canonical.aliases, canonical.canonicalName || canonical.name),
      category:
        !isPendingCategoryLabel(previous?.category)
          ? sanitizeKnowledgeCategory(previous?.category)
          : !isPendingCategoryLabel(canonical.category)
            ? sanitizeKnowledgeCategory(canonical.category)
            : classifyConceptFallback(canonical.name, canonical.aliases),
      cardId: previous?.cardId || canonical.cardId,
      createdAt: previous?.createdAt || canonical.createdAt
    });
  });

  const reconciledConcepts = Array.from(conceptByKey.values());
  const reconciledCards = upsertCards(
    [],
    cards.map((card) => normalizeCard(card, card.source, reconciledConcepts))
  );

  const masteryByKey = new Map<string, MasteryRecord>();
  mastery.forEach((record) => {
    const canonical = canonicalizeConceptName(record.conceptName, reconciledConcepts);
    const previous = masteryByKey.get(canonical.normalizedKey);
    masteryByKey.set(canonical.normalizedKey, {
      conceptId: conceptIdFromName(canonical.canonicalName),
      conceptName: canonical.canonicalName,
      score: Math.max(previous?.score ?? 0, record.score),
      lastEvent: record.lastEvent || previous?.lastEvent
    });
  });

  let reconciledMastery = Array.from(masteryByKey.values());
  reconciledConcepts.forEach((concept) => {
    reconciledMastery = upsertMastery(reconciledMastery, concept.canonicalName || concept.name, 0.15, "知识库迁移补齐画像");
  });

  const confirmedKeys = new Set(reconciledConcepts.map((concept) => concept.normalizedKey || normalizeConceptKey(concept.name)));
  const candidateByKey = new Map<string, CandidateConcept>();
  [...migratedCandidates, ...candidates].forEach((candidate) => {
    const canonical = canonicalizeConceptName(candidate.canonicalName, [...reconciledConcepts, ...Array.from(candidateByKey.values())]);
    if (confirmedKeys.has(canonical.normalizedKey)) return;
    const existing = candidateByKey.get(canonical.normalizedKey);
    const normalizedCandidate: CandidateConcept = {
      ...candidate,
      id: `candidate_${canonical.normalizedKey}`,
      canonicalName: canonical.canonicalName,
      aliases: mergeAliases(candidate.aliases ?? [], canonical.aliases, canonical.canonicalName),
      normalizedKey: canonical.normalizedKey,
      suggestedCategory: sanitizeKnowledgeCategory(candidate.suggestedCategory || classifyConceptFallback(canonical.canonicalName, canonical.aliases)),
      status: "pending"
    };
    candidateByKey.set(canonical.normalizedKey, existing ? mergeCandidateConcept(existing, normalizedCandidate) : normalizedCandidate);
  });

  return {
    concepts: reconciledConcepts,
    cards: reconciledCards,
    mastery: reconciledMastery,
    candidates: Array.from(candidateByKey.values())
  };
}


export function reconcilePendingCandidatesAndTemporaryCards({
  pendingCandidates,
  temporaryCards,
  confirmedConcepts
}: {
  pendingCandidates: CandidateConcept[];
  temporaryCards: KnowledgeCard[];
  confirmedConcepts: KnowledgeConcept[];
}): {
  pendingCandidates: CandidateConcept[];
  temporaryCards: KnowledgeCard[];
  missingTemporaryCards: string[];
  orphanTemporaryCards: string[];
} {
  const confirmedKeys = new Set(confirmedConcepts.map((concept) => concept.normalizedKey || normalizeConceptKey(concept.canonicalName || concept.name)));
  const candidateByKey = new Map<string, CandidateConcept>();
  pendingCandidates.forEach((candidate) => {
    const canonical = canonicalizeConceptName(candidate.canonicalName, [...confirmedConcepts, ...Array.from(candidateByKey.values())]);
    if (confirmedKeys.has(canonical.normalizedKey)) return;
    const normalized: CandidateConcept = {
      ...candidate,
      id: `candidate_${canonical.normalizedKey}`,
      canonicalName: canonical.canonicalName,
      aliases: mergeAliases(candidate.aliases ?? [], canonical.aliases, canonical.canonicalName),
      normalizedKey: canonical.normalizedKey,
      suggestedCategory: sanitizeKnowledgeCategory(candidate.suggestedCategory || classifyConceptFallback(canonical.canonicalName, canonical.aliases)),
      status: "pending"
    };
    const existing = candidateByKey.get(canonical.normalizedKey);
    candidateByKey.set(canonical.normalizedKey, existing ? mergeCandidateConcept(existing, normalized) : normalized);
  });

  const cardByKey = new Map<string, KnowledgeCard>();
  temporaryCards.forEach((card) => {
    const canonical = canonicalizeConceptName(card.canonicalName || card.name, [...confirmedConcepts, ...Array.from(candidateByKey.values())]);
    if (confirmedKeys.has(canonical.normalizedKey)) return;
    const normalizedCard = normalizeCard(
      {
        ...card,
        name: canonical.canonicalName,
        canonicalName: canonical.canonicalName,
        aliases: mergeAliases(card.aliases ?? [], canonical.aliases, canonical.canonicalName),
        normalizedKey: canonical.normalizedKey,
        category: sanitizeKnowledgeCategory(card.category || classifyConceptFallback(canonical.canonicalName, canonical.aliases)),
        status: "temporary"
      },
      card.source,
      confirmedConcepts
    );
    cardByKey.set(canonical.normalizedKey, normalizedCard);
    if (!candidateByKey.has(canonical.normalizedKey)) {
      candidateByKey.set(canonical.normalizedKey, toCandidateConcept({
        name: canonical.canonicalName,
        category: normalizedCard.category,
        reason: normalizedCard.summary,
        source: "related_concept",
        candidateType: "concept",
        contextRole: "application",
        educationalValue: 0.68,
        noiseRisk: 0.3,
        granularity: "good"
      }, [...confirmedConcepts, ...Array.from(candidateByKey.values())], "related_concept"));
    }
  });

  const missingTemporaryCards: string[] = [];
  candidateByKey.forEach((candidate) => {
    if (cardByKey.has(candidate.normalizedKey)) return;
    missingTemporaryCards.push(candidate.canonicalName);
    const fallback = buildFallbackKnowledgeCard({
      conceptName: candidate.canonicalName,
      category: sanitizeKnowledgeCategory(candidate.suggestedCategory || classifyConceptFallback(candidate.canonicalName, candidate.aliases)),
      source: "pending candidate fallback temporary card",
      sourceText: candidate.reason || candidate.summary,
      knownConcepts: confirmedConcepts
    });
    cardByKey.set(candidate.normalizedKey, {
      ...fallback,
      name: candidate.canonicalName,
      canonicalName: candidate.canonicalName,
      aliases: candidate.aliases,
      normalizedKey: candidate.normalizedKey,
      category: sanitizeKnowledgeCategory(candidate.suggestedCategory || fallback.category),
      status: "temporary"
    });
  });

  const candidateKeys = new Set(candidateByKey.keys());
  const orphanTemporaryCards = Array.from(cardByKey.entries()).filter(([key]) => !candidateKeys.has(key)).map(([, card]) => card.name);
  return {
    pendingCandidates: Array.from(candidateByKey.values()),
    temporaryCards: Array.from(cardByKey.values()),
    missingTemporaryCards,
    orphanTemporaryCards
  };
}
