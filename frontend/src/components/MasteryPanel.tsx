import { Brain } from "lucide-react";
import { getMasteryColor, getMasteryLevel } from "../services/masteryService";
import type { ConceptId, KnowledgeConcept, MasteryRecord } from "../types";

type Props = {
  mastery: MasteryRecord[];
  concepts: KnowledgeConcept[];
  collapsed: boolean;
  onOpenCard: (conceptId: ConceptId) => void;
  onToggleCollapsed: () => void;
};

export function MasteryPanel({ mastery, concepts, collapsed, onOpenCard, onToggleCollapsed }: Props) {
  const categoryByName = new Map(concepts.map((concept) => [concept.name, concept.category || "待分类"]));
  const weakCount = mastery.filter((record) => record.score < 0.4).length;
  const groups = mastery.reduce<Record<string, MasteryRecord[]>>((acc, record) => {
    const category = categoryByName.get(record.conceptName) || "待分类";
    acc[category] = [...(acc[category] ?? []), record];
    return acc;
  }, {});

  return (
    <section className="panel mastery-panel">
      <div className="panel-header compact collapsible-header">
        <div>
          <p className="eyebrow">学生掌握画像</p>
          <h2>概念掌握画像</h2>
          {collapsed && <span className="collapse-summary">学生掌握画像：{mastery.length} 个知识点，{weakCount} 个薄弱</span>}
        </div>
        <button className="icon-button" onClick={onToggleCollapsed} aria-label="切换学生掌握画像">
          <Brain size={18} />
        </button>
      </div>

      {!collapsed && (
        <div className="mastery-group-list">
          {Object.entries(groups).map(([category, records]) => (
            <div className="mastery-category" key={category}>
              <div className="category-heading">
                <strong>{category}</strong>
                <span>{records.length} 个</span>
              </div>
              <div className="mastery-list">
                {records.map((record) => {
                  const score = record.score;
                  return (
                    <button className="mastery-row" key={record.conceptId} onClick={() => onOpenCard(record.conceptName)}>
                      <div className="mastery-row-top">
                        <strong>{record.conceptName}</strong>
                        <span className={`level-badge ${getMasteryColor(score)}`}>{getMasteryLevel(score)}</span>
                      </div>
                      <div className="progress-track">
                        <span className={getMasteryColor(score)} style={{ width: `${score * 100}%` }} />
                      </div>
                      <div className="mastery-meta">
                        <span>{score.toFixed(2)}</span>
                        <small>{record.lastEvent ?? "暂无学习记录"}</small>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
