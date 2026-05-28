import { BookOpenCheck, LibraryBig, Plus, RefreshCcw, X } from "lucide-react";
import { useState } from "react";
import { buildFallbackKnowledgeCard, isKnowledgeCardIncomplete } from "../services/knowledgeCardService";
import { getMasteryColor, getMasteryLevel } from "../services/masteryService";
import type { ConceptId, KnowledgeCard, KnowledgeConcept, MasteryRecord } from "../types";
import { asBlockMath, MarkdownRenderer } from "./MarkdownRenderer";

type Props = {
  conceptId: ConceptId | null;
  secondaryConceptId: ConceptId | null;
  cards: KnowledgeCard[];
  concepts: KnowledgeConcept[];
  mastery: MasteryRecord[];
  isInReview: (conceptName: string) => boolean;
  onClose: () => void;
  onCloseSecondary: () => void;
  onOpenCard: (conceptId: ConceptId) => void;
  onOpenRelated: (conceptId: ConceptId) => void;
  onAddReview: (conceptName: string, source: "knowledge_card" | "chat_suggestion" | "quiz") => void;
  onStartKnowledgeCheck: (conceptName: string) => void;
  onAddToKnowledgeBase: (name: string, category: string, reason: string, initialScore: number) => void;
  onRegenerateCard?: (card: KnowledgeCard) => void;
};

function normalizeConceptName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function findCard(cards: KnowledgeCard[], conceptId: ConceptId | null) {
  if (!conceptId) return null;
  const normalized = normalizeConceptName(conceptId);
  return cards.find((item) => item.id === conceptId || normalizeConceptName(item.normalizedKey || item.name) === normalized || normalizeConceptName(item.name) === normalized) ?? null;
}

function sameConceptCard(a?: KnowledgeCard | null, b?: KnowledgeCard | null) {
  if (!a || !b) return false;
  return normalizeConceptName(a.normalizedKey || a.name) === normalizeConceptName(b.normalizedKey || b.name);
}

function isOfficialConcept(card: KnowledgeCard, concepts: KnowledgeConcept[]) {
  return card.status === "confirmed" || concepts.some((concept) => normalizeConceptName(concept.name) === normalizeConceptName(card.name));
}

function buildTemporaryCard(name: string, sourceCard: KnowledgeCard | null): KnowledgeCard {
  return buildFallbackKnowledgeCard({
    conceptName: name,
    category: sourceCard?.category,
    source: "由相关概念点击生成的临时卡片",
    sourceText: sourceCard ? `来自「${sourceCard.name}」卡片。${sourceCard.summary}` : undefined,
    relatedConcept: sourceCard?.name
  });
}

type CardPaneProps = {
  card: KnowledgeCard;
  status: "existing" | "temporary";
  variant: "primary" | "secondary";
  sourceCard: KnowledgeCard | null;
  cards: KnowledgeCard[];
  concepts: KnowledgeConcept[];
  mastery: MasteryRecord[];
  isInReview: (conceptName: string) => boolean;
  onClose: () => void;
  onOpenRelated: (conceptId: ConceptId) => void;
  onAddReview: (conceptName: string, source: "knowledge_card" | "chat_suggestion" | "quiz") => void;
  onStartKnowledgeCheck: (conceptName: string) => void;
  onAddToKnowledgeBase: (name: string, category: string, reason: string, initialScore: number) => void;
  onRegenerateCard?: (card: KnowledgeCard) => void;
};

function ConceptChip({
  name,
  cards,
  concepts,
  onOpenRelated
}: {
  name: string;
  cards: KnowledgeCard[];
  concepts: KnowledgeConcept[];
  onOpenRelated: (conceptId: ConceptId) => void;
}) {
  const normalized = normalizeConceptName(name);
  const exists = cards.some((card) => isOfficialConcept(card, concepts) && normalizeConceptName(card.name) === normalized);
  return (
    <button className={`related-chip ${exists ? "known" : "temporary"}`} onClick={() => onOpenRelated(name)}>
      {name}
      {!exists && <small>未入库</small>}
    </button>
  );
}

function CardPane({
  card,
  status,
  variant,
  sourceCard,
  cards,
  concepts,
  mastery,
  isInReview,
  onClose,
  onOpenRelated,
  onAddReview,
  onStartKnowledgeCheck,
  onAddToKnowledgeBase,
  onRegenerateCard
}: CardPaneProps) {
  const score = mastery.find((item) => item.conceptName === card.name || item.conceptId === card.id)?.score ?? 0.15;
  const added = isInReview(card.name);
  const [selectingMastery, setSelectingMastery] = useState(false);
  const shouldShowRegenerate = isKnowledgeCardIncomplete(card);

  const addTemporaryConcept = (initialScore: number) => {
    onAddToKnowledgeBase(
      card.name,
      card.category || sourceCard?.category || "待分类",
      `从知识卡片「${sourceCard?.name ?? "当前卡片"}」关联概念加入。${card.summary}`,
      initialScore
    );
    if (initialScore >= 0.55) onAddReview(card.name, "knowledge_card");
    setSelectingMastery(false);
  };

  return (
    <aside className={`card-drawer knowledge-card ${variant}`} onClick={(event) => event.stopPropagation()}>
      <div className="drawer-header">
        <div>
          <p className="eyebrow">
            知识卡片 · {card.category} · {status === "existing" ? "已在知识库" : "临时卡片"}
            {card.generatedBy ? ` · ${card.generatedBy}` : ""}
          </p>
          <h2>{card.name}</h2>
          {card.aliases && card.aliases.length > 0 && <p className="alias-line">别名：{card.aliases.join("、")}</p>}
        </div>
        <button className="icon-button" onClick={onClose} aria-label={variant === "primary" ? "关闭知识卡片" : "关闭二级知识卡片"}>
          <X size={19} />
        </button>
      </div>

      {status === "existing" ? (
        <div className="card-mastery">
          <span className={`level-badge ${getMasteryColor(score)}`}>{getMasteryLevel(score)}</span>
          <strong>{score.toFixed(2)}</strong>
          <div className="progress-track">
            <span className={getMasteryColor(score)} style={{ width: `${score * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className="empty-card">该概念还不是课程知识库正式知识点。加入后会初始化掌握分，并进入诊断选择器和复习任务。</div>
      )}

      <div className="knowledge-card-scroll-body">
        <section className="card-section">
          <h3>一句话定义</h3>
          <MarkdownRenderer content={card.summary} compact />
        </section>
        <section className="card-section">
          <h3>直觉解释</h3>
          <MarkdownRenderer content={card.intuition} compact />
        </section>
        {card.formula && (
          <section className="card-section formula-section">
            <h3>公式</h3>
            <MarkdownRenderer content={asBlockMath(card.formula)} />
          </section>
        )}
        <section className="card-section">
          <h3>简单例子</h3>
          <MarkdownRenderer content={card.example} compact />
        </section>
        <section className="card-section">
          <h3>常见误区</h3>
          <ul className="markdown-list">
            {card.commonMistakes.map((mistake) => (
              <li key={mistake}>
                <MarkdownRenderer content={mistake} compact />
              </li>
            ))}
          </ul>
        </section>

        <div className="card-grid">
          <div>
            <h3>前置知识</h3>
            <div className="pill-list">
              {card.prerequisites.length === 0 ? (
                <span>暂无</span>
              ) : (
                card.prerequisites.map((item) => <ConceptChip key={item} name={item} cards={cards} concepts={concepts} onOpenRelated={onOpenRelated} />)
              )}
            </div>
          </div>
          <div>
            <h3>相关概念</h3>
            <div className="pill-list">
              {card.relatedConcepts.length === 0 ? (
                <span>暂无</span>
              ) : (
                card.relatedConcepts.map((related) => <ConceptChip key={related} name={related} cards={cards} concepts={concepts} onOpenRelated={onOpenRelated} />)
              )}
            </div>
          </div>
        </div>

        <section className="card-section source-card">
          <h3>来源</h3>
          <MarkdownRenderer content={card.source} compact />
        </section>
      </div>

      <div className="drawer-actions">
        {shouldShowRegenerate && (
          <button onClick={() => onRegenerateCard?.(card)}>
            <RefreshCcw size={16} />
            补全讲解
          </button>
        )}
        {status === "existing" ? (
          <>
            <button disabled={added} onClick={() => onAddReview(card.name, "knowledge_card")}>
              <Plus size={16} />
              {added ? "已加入复习" : "加入复习"}
            </button>
            <button onClick={() => onStartKnowledgeCheck(card.name)}>
              <BookOpenCheck size={16} />
              知识检测
            </button>
          </>
        ) : (
          <div className="mastery-choice">
            {selectingMastery ? (
              <>
                <strong>你目前对这个知识点的掌握情况是？</strong>
                <button onClick={() => addTemporaryConcept(0.15)}>没听过 / 基本不了解</button>
                <button onClick={() => addTemporaryConcept(0.35)}>听过但不太会用</button>
                <button onClick={() => addTemporaryConcept(0.55)}>基本理解，想加入复习</button>
                <button onClick={() => setSelectingMastery(false)}>取消</button>
              </>
            ) : (
              <button onClick={() => setSelectingMastery(true)}>
                <LibraryBig size={16} />
                加入知识库
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

export function KnowledgeCardDrawer({
  conceptId,
  secondaryConceptId,
  cards,
  concepts,
  mastery,
  isInReview,
  onClose,
  onCloseSecondary,
  onOpenRelated,
  onAddReview,
  onStartKnowledgeCheck,
  onAddToKnowledgeBase,
  onRegenerateCard
}: Props) {
  if (!conceptId) return null;
  const primaryCard = findCard(cards, conceptId) ?? buildTemporaryCard(conceptId, null);
  const primaryStatus = isOfficialConcept(primaryCard, concepts) ? "existing" : "temporary";
  const secondaryExisting = findCard(cards, secondaryConceptId);
  const resolvedSecondaryCard = secondaryConceptId ? secondaryExisting ?? buildTemporaryCard(secondaryConceptId, primaryCard) : null;
  const secondaryCard = sameConceptCard(primaryCard, resolvedSecondaryCard) ? null : resolvedSecondaryCard;
  const secondaryStatus = secondaryCard && isOfficialConcept(secondaryCard, concepts) ? "existing" : "temporary";

  return (
    <div className={`drawer-overlay ${secondaryCard ? "with-secondary" : ""}`} onClick={onClose}>
      <div className="drawer-stack">
        {secondaryCard && (
          <CardPane
            card={secondaryCard}
            status={secondaryStatus}
            variant="secondary"
            sourceCard={primaryCard}
            cards={cards}
            concepts={concepts}
            mastery={mastery}
            isInReview={isInReview}
            onClose={onCloseSecondary}
            onOpenRelated={onOpenRelated}
            onAddReview={onAddReview}
            onStartKnowledgeCheck={onStartKnowledgeCheck}
            onAddToKnowledgeBase={onAddToKnowledgeBase}
            onRegenerateCard={onRegenerateCard}
          />
        )}
        <CardPane
          card={primaryCard}
          status={primaryStatus}
          variant="primary"
          sourceCard={null}
          cards={cards}
          concepts={concepts}
          mastery={mastery}
          isInReview={isInReview}
          onClose={onClose}
          onOpenRelated={onOpenRelated}
          onAddReview={onAddReview}
          onStartKnowledgeCheck={onStartKnowledgeCheck}
          onAddToKnowledgeBase={onAddToKnowledgeBase}
          onRegenerateCard={onRegenerateCard}
        />
      </div>
    </div>
  );
}
