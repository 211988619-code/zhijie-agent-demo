import type { KnowledgeCard, KnowledgeConcept, NewConceptCandidate } from "../types";
import { canonicalizeConceptName, mergeAliases, normalizeConceptKey } from "./conceptIdentity";
import { conceptIdFromName } from "./masteryService";

const now = () => new Date().toISOString();

export function normalizeConceptName(name: string) {
  return normalizeConceptKey(name);
}

function uniqueConcepts(values: unknown[] | undefined, selfName: string): string[] {
  const seen = new Set<string>();
  const self = normalizeConceptName(selfName);
  return (values ?? [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .filter((value) => {
      const normalized = normalizeConceptName(value);
      if (normalized === self || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 5);
}

function nonEmptyList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const list = value.map((item) => String(item ?? "").trim()).filter(Boolean);
  return list.length > 0 ? list : fallback;
}

export function inferRelatedConceptsFromKnownConcepts(
  conceptName: string,
  category: string | undefined,
  knownConcepts: KnowledgeConcept[] = [],
  preferred: string[] = []
) {
  const sameCategory = knownConcepts
    .filter((concept) => !category || concept.category === category)
    .map((concept) => concept.name);
  const fallbackPool = knownConcepts.map((concept) => concept.name);
  return uniqueConcepts([...preferred, ...sameCategory, ...fallbackPool], conceptName).slice(0, 4);
}

export function buildFallbackKnowledgeCard({
  conceptName,
  category,
  source,
  sourceText,
  relatedConcept,
  knownConcepts = []
}: {
  conceptName: string;
  category?: string;
  source?: string;
  sourceText?: string;
  relatedConcept?: string;
  knownConcepts?: KnowledgeConcept[];
}): KnowledgeCard {
  const canonical = canonicalizeConceptName(conceptName, knownConcepts);
  const safeName = canonical.canonicalName;
  const safeCategory = category?.trim() || "待分类";
  const relatedConcepts = inferRelatedConceptsFromKnownConcepts(safeName, safeCategory, knownConcepts, relatedConcept ? [relatedConcept] : []);
  const context = sourceText?.trim() ? `当前上下文提到：${sourceText.trim().slice(0, 140)}` : "当前上下文暂时较少，后续可结合课程资料继续完善。";

  return {
    id: conceptIdFromName(safeName),
    name: safeName,
    canonicalName: safeName,
    aliases: canonical.aliases,
    normalizedKey: canonical.normalizedKey,
    category: safeCategory,
    summary: `${safeName} 是当前学习过程中识别出的一个新知识点。`,
    intuition: `你可以先把「${safeName}」理解为与当前问题、习题或相关概念有关的学习对象。${context}`,
    formula: "",
    example: `在当前问题或习题中，「${safeName}」可用于解释相关推理过程；建议结合课程资料中的定义、例子和公式继续完善。`,
    commonMistakes: [
      `只记住「${safeName}」这个名称，但没有理解它和当前问题的关系。`,
      `把「${safeName}」和相近概念混淆，没有区分适用场景。`
    ],
    prerequisites: relatedConcept ? [relatedConcept] : [],
    relatedConcepts,
    source: source || "LLM 不可用时由系统生成的临时卡片",
    masterySuggestion: "未接触",
    status: "temporary",
    generatedBy: "fallback",
    createdAt: now(),
    updatedAt: now()
  };
}

export function normalizeCard(
  raw: Partial<KnowledgeCard> & { name: string },
  fallbackSource = "模型生成",
  knownConcepts: KnowledgeConcept[] = []
): KnowledgeCard {
  const canonical = canonicalizeConceptName(raw.canonicalName || raw.name, knownConcepts);
  const fallback = buildFallbackKnowledgeCard({
    conceptName: canonical.canonicalName,
    category: raw.category,
    source: raw.source || fallbackSource,
    knownConcepts
  });
  const category = raw.category?.trim() || fallback.category;
  const aliases = mergeAliases(raw.aliases ?? [], canonical.aliases, canonical.canonicalName);
  const related = inferRelatedConceptsFromKnownConcepts(canonical.canonicalName, category, knownConcepts, raw.relatedConcepts);
  const normalized: KnowledgeCard = {
    ...fallback,
    ...raw,
    id: raw.id ?? conceptIdFromName(canonical.canonicalName),
    name: canonical.canonicalName,
    canonicalName: canonical.canonicalName,
    aliases,
    normalizedKey: canonical.normalizedKey,
    category,
    summary: raw.summary?.trim() || fallback.summary,
    intuition: raw.intuition?.trim() || fallback.intuition,
    formula: raw.formula?.trim() || "",
    example: raw.example?.trim() || fallback.example,
    commonMistakes: nonEmptyList(raw.commonMistakes, fallback.commonMistakes),
    prerequisites: uniqueConcepts(raw.prerequisites, canonical.canonicalName),
    relatedConcepts: uniqueConcepts(raw.relatedConcepts, canonical.canonicalName).length > 0 ? uniqueConcepts(raw.relatedConcepts, canonical.canonicalName) : related,
    source: raw.source?.trim() || fallbackSource,
    masterySuggestion: raw.masterySuggestion || fallback.masterySuggestion,
    status: raw.status ?? fallback.status,
    generatedBy: raw.generatedBy ?? fallback.generatedBy,
    createdAt: raw.createdAt ?? fallback.createdAt,
    updatedAt: now()
  };
  return normalized;
}

export function isKnowledgeCardIncomplete(card: KnowledgeCard | null | undefined) {
  if (!card) return true;
  return (
    !card.summary?.trim() ||
    !card.intuition?.trim() ||
    !card.example?.trim() ||
    !card.commonMistakes?.length ||
    (!card.relatedConcepts?.length && card.generatedBy !== "manual") ||
    card.generatedBy === "fallback" ||
    card.status === "temporary"
  );
}

export function cardFromCandidate(candidate: NewConceptCandidate, knownConcepts: KnowledgeConcept[] = []): KnowledgeCard {
  return buildFallbackKnowledgeCard({
    conceptName: candidate.name,
    category: candidate.category,
    source: "由问答中新概念生成的候选卡片",
    sourceText: candidate.reason,
    knownConcepts
  });
}

export function mergeKnowledgeCards(previous: KnowledgeCard | undefined, incoming: KnowledgeCard): KnowledgeCard {
  if (!previous) return incoming;
  const canonical = canonicalizeConceptName(previous.canonicalName || previous.name, []);
  const incomingCanonical = canonicalizeConceptName(incoming.canonicalName || incoming.name, [
    {
      id: previous.id,
      name: canonical.canonicalName,
      category: previous.category,
      status: "existing",
      aliases: previous.aliases,
      normalizedKey: canonical.normalizedKey,
      canonicalName: canonical.canonicalName
    }
  ]);
  const mergedAliases = mergeAliases(previous.aliases, incoming.aliases, canonical.canonicalName);
  const allAliases = mergeAliases(mergedAliases, incomingCanonical.aliases, canonical.canonicalName);
  const preferIncoming = incoming.generatedBy === "llm" || isKnowledgeCardIncomplete(previous);
  const mergedStatus: KnowledgeCard["status"] =
    previous.status === "confirmed" || incoming.status === "confirmed" ? "confirmed" : incoming.status || previous.status;
  const merged: Partial<KnowledgeCard> & { name: string } = {
    ...previous,
    ...(preferIncoming ? incoming : {}),
    id: previous.id,
    name: canonical.canonicalName,
    canonicalName: canonical.canonicalName,
    aliases: allAliases,
    normalizedKey: canonical.normalizedKey,
    category: incoming.category || previous.category,
    summary: preferIncoming ? incoming.summary || previous.summary : previous.summary || incoming.summary,
    intuition: preferIncoming ? incoming.intuition || previous.intuition : previous.intuition || incoming.intuition,
    formula: incoming.formula || previous.formula,
    example: preferIncoming ? incoming.example || previous.example : previous.example || incoming.example,
    commonMistakes: incoming.commonMistakes?.length ? incoming.commonMistakes : previous.commonMistakes,
    prerequisites: uniqueConcepts([...(previous.prerequisites ?? []), ...(incoming.prerequisites ?? [])], previous.name || incoming.name),
    relatedConcepts: uniqueConcepts([...(previous.relatedConcepts ?? []), ...(incoming.relatedConcepts ?? [])], previous.name || incoming.name),
    source: incoming.source || previous.source,
    generatedBy: incoming.generatedBy || previous.generatedBy,
    status: mergedStatus,
    createdAt: previous.createdAt || incoming.createdAt,
    updatedAt: now()
  };
  return normalizeCard(merged);
}

export function upsertCards(cards: KnowledgeCard[], incoming: KnowledgeCard[]): KnowledgeCard[] {
  const byName = new Map(cards.map((card) => {
    const normalized = normalizeCard(card);
    return [normalized.normalizedKey || normalizeConceptName(normalized.name), normalized] as const;
  }));
  incoming.forEach((card) => {
    const normalized = normalizeCard(card);
    const key = normalized.normalizedKey || normalizeConceptName(normalized.name);
    byName.set(key, mergeKnowledgeCards(byName.get(key), normalized));
  });
  return Array.from(byName.values());
}
