import { Bot, Loader2, Send, UserRound } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChatMessage, ConceptId, LLMConfig, ModelConnectionStatus, SourceRef } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

type Props = {
  messages: ChatMessage[];
  input: string;
  loading: boolean;
  config: LLMConfig;
  modelStatus: ModelConnectionStatus;
  lastModelError?: string;
  documentTitle?: string;
  chunkCount?: number;
  lastContextCount?: number;
  usedFallbackContext?: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onOpenCard: (conceptId: ConceptId) => void;
  feedbackByMessageConcept: Record<string, "understood" | "confused">;
  onFeedback: (messageId: string, conceptName: string, event: "understood" | "confused") => void;
  onAddReview: (conceptName: string, source: "knowledge_card" | "chat_suggestion" | "quiz") => void;
  isInReview: (conceptName: string) => boolean;
};

function SourceList({ sources }: { sources: SourceRef[] }) {
  return (
    <section className="answer-section source-section">
      <h4>来源依据</h4>
      {sources.length === 0 ? (
        <p>当前没有上传资料依据，主要依赖模型通用知识或内置示例。</p>
      ) : (
        <ul>
          {sources.map((source) => (
            <li key={`${source.document}-${source.section}`}>
              {source.document}：{source.section}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function normalizeConceptName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function MaterialContextStatus({
  documentTitle,
  chunkCount,
  lastContextCount,
  usedFallbackContext
}: {
  documentTitle?: string;
  chunkCount: number;
  lastContextCount: number;
  usedFallbackContext: boolean;
}) {
  return (
    <div className="context-status-card">
      <div className="context-status-main">
        <span className={chunkCount > 0 ? "context-badge ready" : "context-badge"}>{chunkCount > 0 ? "资料已加载" : "未加载资料"}</span>
        {chunkCount > 0 && <span className="context-badge">上下文已启用</span>}
        <span className="context-detail">
          {chunkCount > 0
            ? `${documentTitle ?? "当前资料"} · ${chunkCount} 个片段 · 本次回答使用 ${lastContextCount} 个片段${usedFallbackContext ? " · 已启用弱匹配兜底" : ""}`
            : "上传资料后，AI Agent 可以结合课程内容回答问题。"}
        </span>
      </div>
      {chunkCount > 0 && <small>当前为简化检索：关键词匹配 + 片段注入，暂未接入向量数据库。</small>}
    </div>
  );
}

export function ChatWindow({
  messages,
  input,
  loading,
  config,
  modelStatus,
  lastModelError,
  documentTitle,
  chunkCount = 0,
  lastContextCount = 0,
  usedFallbackContext = false,
  onInputChange,
  onSend,
  onOpenCard,
  feedbackByMessageConcept,
  onFeedback,
  onAddReview,
  isInReview
}: Props) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }, [messages, loading]);

  return (
    <section className="panel chat-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">自适应问答 Agent</p>
          <h2>先查画像，再生成解释</h2>
        </div>
        <span className={`mode-pill ${modelStatus === "ready" ? "llm" : "mock"}`}>
          {modelStatus === "ready" ? `Real API: ${config.model}` : config.useMockFallback ? "Mock fallback" : "API not ready"}
        </span>
      </div>
      {lastModelError && <div className="settings-message">Last API error: {lastModelError}</div>}
      <MaterialContextStatus documentTitle={documentTitle} chunkCount={chunkCount} lastContextCount={lastContextCount} usedFallbackContext={usedFallbackContext} />

      <div className="message-list">
        {messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <div className="avatar">{message.role === "student" ? <UserRound size={18} /> : <Bot size={18} />}</div>
            <div className="message-bubble">
              {message.text && <MarkdownRenderer content={message.text} compact />}
              {message.error && <div className="error-box">{message.error}</div>}
              {message.answer &&
                (() => {
                  const answer = message.answer;
                  const primaryConcept = answer.detectedConcepts[0]?.name ?? "链式法则";
                  const feedbackKey = `${message.id}:${normalizeConceptName(primaryConcept)}`;
                  const feedbackValue = feedbackByMessageConcept[feedbackKey];
                  const reviewAdded = isInReview(primaryConcept);
                  return (
                    <div className="answer-card">
                      <div className="answer-mode">{answer.mode === "llm" ? "真实 LLM 输出" : "mock fallback 输出"}</div>
                      <MarkdownRenderer content={answer.answerMarkdown} />

                      <section className="answer-section">
                        <h4>关键概念</h4>
                        <div className="concept-tags prominent">
                          {answer.detectedConcepts.map((concept) => (
                            <button className="tag-button" key={concept.name} onClick={() => onOpenCard(concept.name)}>
                              {concept.name}
                            </button>
                          ))}
                        </div>
                      </section>

                      <SourceList sources={answer.sourceRefs} />

                      <section className="answer-section">
                        <h4>复习建议</h4>
                        <ol>
                          {answer.reviewSuggestions.map((suggestion) => (
                            <li key={suggestion}>
                              <MarkdownRenderer content={suggestion} compact />
                            </li>
                          ))}
                        </ol>
                      </section>

                      <div className="feedback-bar">
                        <button disabled={Boolean(feedbackValue)} onClick={() => onFeedback(message.id, primaryConcept, "understood")}>
                          {feedbackValue === "understood" ? "已反馈：我懂了" : "我懂了"}
                        </button>
                        <button disabled={Boolean(feedbackValue)} onClick={() => onFeedback(message.id, primaryConcept, "confused")}>
                          {feedbackValue === "confused" ? "已反馈：还是不懂" : "还是不懂"}
                        </button>
                        <button disabled={reviewAdded} onClick={() => onAddReview(primaryConcept, "chat_suggestion")}>
                          {reviewAdded ? "已加入复习" : "加入复习"}
                        </button>
                      </div>
                    </div>
                  );
                })()}
            </div>
          </article>
        ))}
        {loading && (
          <article className="message agent">
            <div className="avatar">
              <Bot size={18} />
            </div>
            <div className="message-bubble loading-row">
              <Loader2 size={18} className="spin" />
              正在调用 Agent：检索资料、查询画像、生成结构化回答...
            </div>
          </article>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          disabled={loading}
          rows={2}
        />
        <button className="send-button" onClick={onSend} aria-label="发送问题" disabled={loading}>
          {loading ? <Loader2 size={19} className="spin" /> : <Send size={19} />}
        </button>
      </div>
    </section>
  );
}
