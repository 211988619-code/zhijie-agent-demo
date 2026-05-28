import { CheckCircle2, ChevronDown, FileText, Search, AlertTriangle } from "lucide-react";
import { useState } from "react";
import type { ConceptId, ParsedDocument } from "../types";
import { FileUploader } from "./FileUploader";
import { MarkdownRenderer } from "./MarkdownRenderer";

type Props = {
  document: ParsedDocument;
  onParsed: (document: ParsedDocument) => void;
  onOpenCard: (conceptId: ConceptId) => void;
};

export function DocumentPanel({ document, onParsed, onOpenCard: _onOpenCard }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [conceptsOpen, setConceptsOpen] = useState(false);
  const statusLabel = document.status === "ready" ? "解析成功" : document.status === "partial" ? "部分解析" : "解析失败";
  return (
    <section className={`panel document-panel ${collapsed ? "collapsed" : ""}`}>
      <div className="panel-header collapsible-header">
        <div>
          <p className="eyebrow">课程资料</p>
          <h2>{document.fileName}</h2>
          {collapsed && (
            <span className="collapse-summary">
              已上传 1 个文件，已解析 {document.chunks.length} 个片段，导入 {document.concepts.length} 个知识点
            </span>
          )}
        </div>
        <div className="header-actions">
          <span className={`status-pill ${document.status === "failed" ? "failed" : "success"}`}>
            {document.status === "failed" ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
            {statusLabel}
          </span>
          <button className="icon-button" onClick={() => setCollapsed((value) => !value)} aria-label="切换课程资料">
            <ChevronDown size={18} className={collapsed ? "" : "rotate"} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
      <FileUploader onParsed={onParsed} />

      <div className="doc-summary">
        <div className="doc-file">
          <FileText size={19} />
          <div>
            <strong>{document.fileName}</strong>
            <span>
              {document.fileType.toUpperCase()} · 最近更新：{document.updatedAt}
            </span>
          </div>
        </div>
        <div className="metric-grid">
          <div>
            <strong>{document.chunks.length}</strong>
            <span>文本片段</span>
          </div>
          <div>
            <strong>{document.concepts.length}</strong>
            <span>知识点</span>
          </div>
          <div>
            <strong>{document.status === "partial" ? "部分" : "可用"}</strong>
            <span>问答上下文</span>
          </div>
        </div>
      </div>

      <div className="parse-state">
        <div>
          <CheckCircle2 size={14} />
          文本抽取
        </div>
        <div>
          <CheckCircle2 size={14} />
          片段切分
        </div>
        <div>
          <Search size={14} />
          可进入问答
        </div>
      </div>

      {document.error && <div className="error-box">{document.error}</div>}

      <div className="imported-concepts-block">
        <button className="imported-concepts-summary" onClick={() => setConceptsOpen((value) => !value)}>
          <span>导入知识点</span>
          <ChevronDown size={16} className={conceptsOpen ? "rotate" : ""} />
        </button>
        {conceptsOpen && (
          <div className="imported-concepts-list">
            {document.concepts.map((concept) => (
              <button className="imported-concept-chip" key={concept.id} onClick={() => _onOpenCard(concept.name)}>
                <span className="imported-concept-name">{concept.name}</span>
                <span className="imported-concept-category">{concept.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <details className="raw-doc">
        <summary>资料预览（Markdown/公式渲染）</summary>
        <MarkdownRenderer content={document.text.slice(0, 2500)} />
      </details>
        </>
      )}
    </section>
  );
}
