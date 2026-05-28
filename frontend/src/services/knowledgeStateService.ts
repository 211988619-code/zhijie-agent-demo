import type { CandidateConcept, KnowledgeCard, KnowledgeConcept, MasteryRecord, NewConceptCandidate } from "../types";
import { canonicalizeConceptName, mergeAliases, normalizeConceptKey } from "./conceptIdentity";
import { normalizeCard, upsertCards } from "./knowledgeCardService";
import { conceptIdFromName, upsertMastery } from "./masteryService";

const now = () => new Date().toISOString();

type CandidateInput = NewConceptCandidate | { name: string; category?: string; reason?: string; source?: CandidateConcept["source"] };

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
    suggestedCategory: candidate.category,
    summary: candidate.reason,
    reason: candidate.reason,
    source: "source" in candidate && candidate.source ? candidate.source : source,
    status: "pending",
    createdAt: now()
  };
}

export function upsertCandidateConcept(candidates: CandidateConcept[], incoming: CandidateConcept, confirmed: KnowledgeConcept[]) {
  const confirmedKeys = new Set(confirmed.map((concept) => concept.normalizedKey || normalizeConceptKey(concept.canonicalName || concept.name)));
  if (confirmedKeys.has(incoming.normalizedKey)) return candidates.filter((candidate) => candidate.normalizedKey !== incoming.normalizedKey);

  const existing = candidates.find((candidate) => candidate.normalizedKey === incoming.normalizedKey);
  if (!existing) return [incoming, ...candidates];
  return candidates.map((candidate) =>
    candidate.normalizedKey === incoming.normalizedKey
      ? {
          ...candidate,
          aliases: mergeAliases(candidate.aliases, incoming.aliases, candidate.canonicalName),
          suggestedCategory: incoming.suggestedCategory || candidate.suggestedCategory,
          summary: incoming.summary || candidate.summary,
          reason: incoming.reason || candidate.reason,
          source: incoming.source || candidate.source
        }
      : candidate
  );
}

export function classifyConceptFallback(conceptName: string, aliases: string[] = []) {
  const text = [conceptName, ...aliases].join(" ").toLowerCase();
  if (/(cnn|rnn|lstm|resnet|transformer|attention|bert|gpt|gan|卷积神经网络|循环神经网络|注意力机制|深度)/i.test(text)) return "深度学习";
  if (/(gradient|loss|overfit|regularization|svm|pca|梯度|损失函数|过拟合|正则化|机器学习)/i.test(text)) return "机器学习基础";
  if (/(derivative|chain rule|matrix|probability|导数|链式法则|矩阵|概率|函数|数学)/i.test(text)) return "数学基础";
  return "待分类";
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
    category: concept.category || "待分类",
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
    if (concept.status === "candidate" || concept.category === "待确认新概念") {
      migratedCandidates.push(
        toCandidateConcept(
          {
            name: concept.canonicalName || concept.name,
            category: concept.category === "待确认新概念" ? undefined : concept.category,
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
        previous?.category && previous.category !== "待分类" && previous.category !== "待确认新概念"
          ? previous.category
          : canonical.category && canonical.category !== "待确认新概念"
            ? canonical.category
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
    candidateByKey.set(canonical.normalizedKey, {
      ...candidate,
      ...existing,
      id: `candidate_${canonical.normalizedKey}`,
      canonicalName: canonical.canonicalName,
      aliases: mergeAliases(existing?.aliases, [...(candidate.aliases ?? []), ...canonical.aliases], canonical.canonicalName),
      normalizedKey: canonical.normalizedKey,
      status: "pending"
    });
  });

  return {
    concepts: reconciledConcepts,
    cards: reconciledCards,
    mastery: reconciledMastery,
    candidates: Array.from(candidateByKey.values())
  };
}
