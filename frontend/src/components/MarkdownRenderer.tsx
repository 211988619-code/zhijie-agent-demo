import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

type MarkdownRendererProps = {
  content?: string;
  className?: string;
  compact?: boolean;
  renderCodeAsText?: boolean;
};

export function normalizeMathMarkdown(input: string): string {
  return (input || "")
    .replace(/\\\[((?:.|\n)*?)\\\]/g, (_, formula) => `$$${formula}$$`)
    .replace(/\\\((.*?)\\\)/g, (_, formula) => `$${formula}$`);
}

export function asBlockMath(value?: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes("$")) return trimmed;
  return `$$${trimmed}$$`;
}

export function MarkdownRenderer({ content = "", className, compact = false, renderCodeAsText = false }: MarkdownRendererProps) {
  const normalized = normalizeMathMarkdown(content);

  return (
    <div className={`${className ?? "markdown-body"} ${compact ? "compact" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          table: ({ children }) => (
            <div className="markdown-table-wrap">
              <table>{children}</table>
            </div>
          ),
          code: ({ className: codeClassName, children, ...props }) =>
            renderCodeAsText ? (
              <span className={codeClassName} {...props}>
                {children}
              </span>
            ) : (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            ),
          pre: ({ children }) => (renderCodeAsText ? <span>{children}</span> : <pre>{children}</pre>)
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
