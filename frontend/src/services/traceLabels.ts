import type { AgentTraceStep } from "../types";

const MOJIBAKE_PATTERN = /[�]|(?:鎵|杩|鏆|姝|楠|鐘|璧|勬|鍥|绛|鐢|诲|姒|浠|锛|銆|€|冩|枡|妫|紱)/;

function fallbackForStep(step?: Partial<AgentTraceStep>, fallbackLabel = "Agent 执行完成") {
  const type = step?.type ?? "";
  const detail = step?.detail ?? "";
  const rawTitle = step?.title ?? "";

  if (type.includes("document") || type.includes("retrieval") || detail.includes("context")) return "资料上下文准备";
  if (type.includes("context")) return "资料上下文准备";
  if (type.includes("quiz")) return "测验生成链路";
  if (type.includes("llm") || rawTitle.includes("API")) return "真实模型已配置";
  if (type.includes("parse")) return "资料解析完成";
  if (type.includes("concept")) return "知识点抽取完成";
  return fallbackLabel;
}

export function normalizeTraceLabel(value: unknown, fallbackLabel = "Agent 执行完成") {
  if (typeof value !== "string") return fallbackLabel;
  const label = value.trim();
  if (!label || MOJIBAKE_PATTERN.test(label)) return fallbackLabel;
  return label;
}

export function normalizeTraceStep(step: AgentTraceStep, fallbackLabel?: string): AgentTraceStep {
  const resolvedFallback = fallbackLabel ?? fallbackForStep(step);
  return {
    ...step,
    title: normalizeTraceLabel(step.title, resolvedFallback),
    tool: step.tool ? normalizeTraceLabel(step.tool, resolvedFallback) : step.tool
  };
}

export function normalizeTraceSteps(trace: AgentTraceStep[], fallbackLabel?: string) {
  return trace.map((step) => normalizeTraceStep(step, fallbackLabel));
}

export function normalizeTraceRecord(record: Record<string, AgentTraceStep[]>) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Array.isArray(value) ? normalizeTraceSteps(value) : []]));
}
