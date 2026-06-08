import { BookOpenCheck, Brain, CheckCircle2, FileText, Library, MessageCircle, RotateCcw, Search, Trash2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { CandidateConcept, KnowledgeCard, KnowledgeConcept, MasteryRecord, ParsedDocument, UploadState } from "../../types";
import type { WorkspaceTab } from "../layout/Sidebar";
import type { RetrievalResult } from "../../services/retrievalService";
import { normalizeConceptName } from "../../services/knowledgeCardService";
import { DocumentPanel } from "../DocumentPanel";

type MaterialsSection = "document" | "concepts" | "cards" | "rag";

type Props = {
  document: ParsedDocument;
  concepts: KnowledgeConcept[];
  pendingCandidates: CandidateConcept[];
  cards: KnowledgeCard[];
  temporaryCards: KnowledgeCard[];
  mastery: MasteryRecord[];
  lastRetrievalResults: RetrievalResult[];
  onParsed: (document: ParsedDocument, reportProgress?: (state: UploadState) => void) => Promise<void> | void;
  onNavigate: (tab: WorkspaceTab) => void;
  onOpenCard: (conceptName: string) => void;
  onStartKnowledgeCheck: (conceptName: string) => void;
  onAddReview: (conceptName: string, source: "knowledge_card" | "chat_suggestion" | "quiz") => void;
  onConfirmCandidate: (candidate: CandidateConcept) => void;
  onRejectCandidate: (candidate: CandidateConcept) => void;
  onRemoveConcept: (concept: KnowledgeConcept | CandidateConcept) => void;
  onRemoveCard: (card: KnowledgeCard) => void;
  onRestoreDemoDocument: () => void;
};

const sections: Array<{ id: MaterialsSection; title: string; description: string; icon: typeof FileText }> = [
  { id: "document", title: "资料管理", description: "上传、预览、片段统计", icon: FileText },
  { id: "concepts", title: "概念管理", description: "确认 / 忽略 / 删除知识点", icon: Brain },
  { id: "cards", title: "知识卡片库", description: "查看、检测、移除卡片", icon: Library },
  { id: "rag", title: "RAG 上下文", description: "查看问答注入状态", icon: Search }
];

function masteryScoreFor(name: string, mastery: MasteryRecord[]) {
  const normalized = normalizeConceptName(name);
  return mastery.find((record) => normalizeConceptName(record.conceptName) === normalized)?.score;
}

function compactText(value = "", max = 120) {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function candidateSourceLabel(source: CandidateConcept["source"]) {
  const labels: Record<CandidateConcept["source"], string> = {
    chat: "问答反馈",
    quiz: "测验结果",
    quiz_explanation: "测验解析",
    related_concept: "关联概念",
    document: "课程资料"
  };
  return labels[source] ?? source;
}

type MaterialGroup<T> = {
  category: string;
  items: T[];
};

function cleanMaterialCategory(category?: string | null) {
  const value = String(category ?? "").trim();
  const lower = value.toLowerCase();
  if (
    !value ||
    ["uncategorized", "unknown", "pending", "pending review", "new concept"].includes(lower) ||
    value.includes("待确认") ||
    value.includes("新概念")
  ) {
    return "待分类";
  }
  return value;
}

function scoreForName(name: string, mastery: MasteryRecord[]) {
  return masteryScoreFor(name, mastery) ?? 0.15;
}

function sortByMasteryThenName<T>(items: T[], getName: (item: T) => string, mastery: MasteryRecord[]) {
  return [...items].sort((left, right) => {
    const scoreDelta = scoreForName(getName(left), mastery) - scoreForName(getName(right), mastery);
    if (scoreDelta !== 0) return scoreDelta;
    return getName(left).localeCompare(getName(right), "zh-Hans-CN");
  });
}

function groupMaterialsByCategory<T>(items: T[], getCategory: (item: T) => string): MaterialGroup<T>[] {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const category = cleanMaterialCategory(getCategory(item));
    groups.set(category, [...(groups.get(category) ?? []), item]);
  });
  return Array.from(groups.entries())
    .map(([category, groupedItems]) => ({ category, items: groupedItems }))
    .sort((left, right) => left.category.localeCompare(right.category, "zh-Hans-CN"));
}

function categoryCollapsed(state: Record<string, boolean>, scope: string, category: string) {
  return Boolean(state[`${scope}:${category}`]);
}

function toggleCategoryState(setter: React.Dispatch<React.SetStateAction<Record<string, boolean>>>, scope: string, category: string) {
  setter((current) => ({ ...current, [`${scope}:${category}`]: !current[`${scope}:${category}`] }));
}


export function MaterialsPage({
  document,
  concepts,
  pendingCandidates,
  cards,
  temporaryCards,
  mastery,
  lastRetrievalResults,
  onParsed,
  onNavigate,
  onOpenCard,
  onStartKnowledgeCheck,
  onAddReview,
  onConfirmCandidate,
  onRejectCandidate,
  onRemoveConcept,
  onRemoveCard,
  onRestoreDemoDocument
}: Props) {
  const [activeSection, setActiveSection] = useState<MaterialsSection>("document");
  const confirmedKeys = useMemo(() => new Set(concepts.map((concept) => concept.normalizedKey ?? normalizeConceptName(concept.name))), [concepts]);
  const confirmedCards = useMemo(() => cards.filter((card) => confirmedKeys.has(card.normalizedKey ?? normalizeConceptName(card.name))), [cards, confirmedKeys]);
  const currentChunks = document.chunks.length;
  const ragReady = currentChunks > 0;
  const [collapsedMaterialGroups, setCollapsedMaterialGroups] = useState<Record<string, boolean>>({});
  const confirmedConceptGroups = useMemo(
    () => groupMaterialsByCategory(sortByMasteryThenName(concepts, (concept) => concept.name, mastery), (concept) => concept.category),
    [concepts, mastery]
  );
  const pendingCandidateGroups = useMemo(
    () => groupMaterialsByCategory(sortByMasteryThenName(pendingCandidates, (candidate) => candidate.canonicalName, mastery), (candidate) => candidate.suggestedCategory ?? ""),
    [pendingCandidates, mastery]
  );
  const cardGroups = useMemo(
    () =>
      groupMaterialsByCategory(
        sortByMasteryThenName([...cards, ...temporaryCards], (card) => card.name, mastery),
        (card) => card.category
      ),
    [cards, temporaryCards, mastery]
  );

  return (
    <div className="materials-page">
      <section className="panel materials-hero">
        <div>
          <p className="eyebrow">资料与知识库</p>
          <h2>把上传资料、概念、卡片和问答上下文分开管理</h2>
          <span>当前资料：{document.fileName} · {currentChunks} 个片段 · {concepts.length} 个已确认知识点 · {pendingCandidates.length} 个候选知识点</span>
        </div>
        <div className="materials-hero-actions">
          <button className="secondary-button small" type="button" onClick={() => onNavigate("assistant")}><MessageCircle size={14} />去问 AI</button>
          <button className="secondary-button small" type="button" onClick={onRestoreDemoDocument}><RotateCcw size={14} />恢复示例资料</button>
        </div>
      </section>

      <div className="materials-section-tabs" aria-label="资料与知识库分区">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <button key={section.id} type="button" className={activeSection === section.id ? "active" : ""} onClick={() => setActiveSection(section.id)}>
              <Icon size={18} />
              <span><strong>{section.title}</strong><small>{section.description}</small></span>
            </button>
          );
        })}
      </div>

      {activeSection === "document" && (
        <div className="materials-section-stack">
          <div className="materials-stat-grid">
            <div className="summary-card"><strong>{document.fileName}</strong><span>当前资料</span></div>
            <div className="summary-card"><strong>{currentChunks}</strong><span>可注入问答的片段</span></div>
            <div className="summary-card"><strong>{document.concepts.length}</strong><span>本次资料解析出的概念</span></div>
          </div>
          <DocumentPanel document={document} onParsed={onParsed} onOpenCard={onOpenCard} />
        </div>
      )}

      {activeSection === "concepts" && (
        <section className="panel materials-section-panel">
          <div className="materials-section-header"><div><p className="eyebrow">Concept Manager</p><h2>按分类管理知识点</h2><span>已确认和候选知识点分区展示，组内按掌握度从低到高排序。</span></div><div className="materials-count-pill">{concepts.length} confirmed · {pendingCandidates.length} pending</div></div>
          <div className="materials-subsection">
            <h3>已确认知识点</h3>
            <div className="materials-list grouped">
              {confirmedConceptGroups.map((group) => {
                const collapsed = categoryCollapsed(collapsedMaterialGroups, "concept", group.category);
                const avgScore = group.items.reduce((sum, concept) => sum + scoreForName(concept.name, mastery), 0) / Math.max(1, group.items.length);
                return (
                  <div className="materials-category-group" key={`concept-${group.category}`}>
                    <button className="materials-category-header" type="button" onClick={() => toggleCategoryState(setCollapsedMaterialGroups, "concept", group.category)}>
                      <span><strong>{group.category}</strong><small>{group.items.length} 项 · 平均掌握度 {Math.round(avgScore * 100)}%</small></span>
                      <span>{collapsed ? "+" : "-"}</span>
                    </button>
                    {!collapsed && group.items.map((concept) => {
                      const score = masteryScoreFor(concept.name, mastery);
                      return (
                        <div className="materials-row" key={concept.id}>
                          <div className="materials-row-main"><strong>{concept.name}</strong><span>{cleanMaterialCategory(concept.category)} · 掌握度 {typeof score === "number" ? `${Math.round(score * 100)}%` : "未评估"}</span>{concept.reason && <p>{compactText(concept.reason)}</p>}</div>
                          <div className="materials-row-actions">
                            <button className="secondary-button small" type="button" onClick={() => onOpenCard(concept.name)}>查看卡片</button>
                            <button className="secondary-button small" type="button" onClick={() => onStartKnowledgeCheck(concept.name)}>知识检测</button>
                            <button className="secondary-button small" type="button" onClick={() => onAddReview(concept.name, "knowledge_card")}>加入复习</button>
                            <button className="secondary-button small danger" type="button" onClick={() => onRemoveConcept(concept)}><Trash2 size={13} />移除</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {concepts.length === 0 && <div className="materials-empty">暂无已确认知识点，请先上传资料或从候选概念中确认。</div>}
            </div>
          </div>
          <div className="materials-subsection">
            <h3>候选知识点</h3>
            <div className="materials-list grouped">
              {pendingCandidateGroups.map((group) => {
                const collapsed = categoryCollapsed(collapsedMaterialGroups, "candidate", group.category);
                const avgScore = group.items.reduce((sum, candidate) => sum + scoreForName(candidate.canonicalName, mastery), 0) / Math.max(1, group.items.length);
                return (
                  <div className="materials-category-group" key={`candidate-${group.category}`}>
                    <button className="materials-category-header" type="button" onClick={() => toggleCategoryState(setCollapsedMaterialGroups, "candidate", group.category)}>
                      <span><strong>{group.category}</strong><small>{group.items.length} pending · 平均掌握度 {Math.round(avgScore * 100)}%</small></span>
                      <span>{collapsed ? "+" : "-"}</span>
                    </button>
                    {!collapsed && group.items.map((candidate) => (
                      <div className="materials-row candidate" key={candidate.id}>
                        <div className="materials-row-main"><strong>{candidate.canonicalName}</strong><span>{cleanMaterialCategory(candidate.suggestedCategory)} · 来源：{candidateSourceLabel(candidate.source)}</span><p>{compactText(candidate.reason ?? candidate.summary ?? "等待确认后加入课程知识库。")}</p></div>
                        <div className="materials-row-actions"><button className="primary-button small" type="button" onClick={() => onConfirmCandidate(candidate)}><CheckCircle2 size={13} />确认入库</button><button className="secondary-button small" type="button" onClick={() => onRejectCandidate(candidate)}><XCircle size={13} />忽略</button></div>
                      </div>
                    ))}
                  </div>
                );
              })}
              {pendingCandidates.length === 0 && <div className="materials-empty">暂无候选知识点。问答反馈、测验解析或关联概念会出现在这里。</div>}
            </div>
          </div>
        </section>
      )}

      {activeSection === "cards" && (
        <section className="panel materials-section-panel">
          <div className="materials-section-header"><div><p className="eyebrow">Knowledge Card Library</p><h2>知识卡片库</h2><span>已确认卡片和临时候选卡片按分类统一管理。</span></div><div className="materials-count-pill">{confirmedCards.length} cards · {temporaryCards.length} temporary</div></div>
          <div className="materials-list grouped">
            {cardGroups.map((group) => {
              const collapsed = categoryCollapsed(collapsedMaterialGroups, "card", group.category);
              const confirmedCount = group.items.filter((card) => card.status !== "temporary").length;
              const temporaryCount = group.items.filter((card) => card.status === "temporary").length;
              const avgScore = group.items.reduce((sum, card) => sum + scoreForName(card.name, mastery), 0) / Math.max(1, group.items.length);
              return (
                <div className="materials-category-group" key={`card-${group.category}`}>
                  <button className="materials-category-header" type="button" onClick={() => toggleCategoryState(setCollapsedMaterialGroups, "card", group.category)}>
                    <span><strong>{group.category}</strong><small>{confirmedCount} cards · {temporaryCount} temporary · 平均掌握度 {Math.round(avgScore * 100)}%</small></span>
                    <span>{collapsed ? "+" : "-"}</span>
                  </button>
                  {!collapsed && group.items.map((card) => (
                    <div className={`materials-row ${card.status === "temporary" ? "candidate" : ""}`} key={card.id}>
                      <div className="materials-row-main"><strong>{card.name}</strong><span>{cleanMaterialCategory(card.category)} · {card.generatedBy ?? "manual"} · {card.source}</span><p>{compactText(card.summary)}</p></div>
                      <div className="materials-row-actions"><button className="secondary-button small" type="button" onClick={() => onOpenCard(card.name)}>查看卡片</button><button className="secondary-button small" type="button" onClick={() => onStartKnowledgeCheck(card.name)}>知识检测</button>{card.status !== "temporary" && <button className="secondary-button small" type="button" onClick={() => onAddReview(card.name, "knowledge_card")}>加入复习</button>}<button className="secondary-button small danger" type="button" onClick={() => onRemoveCard(card)}><Trash2 size={13} />移除</button></div>
                    </div>
                  ))}
                </div>
              );
            })}
            {cards.length + temporaryCards.length === 0 && <div className="materials-empty">暂无知识卡片。</div>}
          </div>
        </section>
      )}

      {activeSection === "rag" && (
        <section className="panel materials-section-panel">
          <div className="materials-section-header"><div><p className="eyebrow">RAG / Context Status</p><h2>问答上下文注入状态</h2><span>当前实现是前端关键词检索 + prompt 注入，不是向量库或后端 RAG。</span></div><div className={`materials-count-pill ${ragReady ? "ready" : "muted"}`}>{ragReady ? "Context ready" : "No chunks"}</div></div>
          <div className="materials-stat-grid"><div className="summary-card"><strong>{document.chunks.length}</strong><span>当前资料片段</span></div><div className="summary-card"><strong>{lastRetrievalResults.length}</strong><span>上次问答命中的片段</span></div><div className="summary-card"><strong>{lastRetrievalResults.some((result) => result.fallback) ? "Fallback" : "Keyword"}</strong><span>上次上下文策略</span></div></div>
          <div className="materials-list">
            {lastRetrievalResults.map((result) => <div className="materials-row" key={result.chunk.id}><div className="materials-row-main"><strong>{result.chunk.sourceTitle ?? result.chunk.source?.document ?? document.fileName}{typeof result.chunk.index === "number" ? ` #${result.chunk.index + 1}` : ""}</strong><span>score {result.score.toFixed(2)} · {result.fallback ? "fallback context" : `matched: ${result.matchedTerms.join(", ") || "concept"}`}</span><p>{compactText(result.chunk.text ?? result.chunk.content, 180)}</p></div></div>)}
            {lastRetrievalResults.length === 0 && <div className="materials-empty">还没有问答检索记录。进入“问 AI Agent”提问后，这里会显示被注入 prompt 的资料片段。</div>}
          </div>
          <div className="materials-bottom-actions"><button className="primary-button" type="button" onClick={() => onNavigate("assistant")}><MessageCircle size={15} />用当前资料提问</button><button className="secondary-button" type="button" onClick={() => onNavigate("quiz")}><BookOpenCheck size={15} />开始能力评估</button></div>
        </section>
      )}
    </div>
  );
}
