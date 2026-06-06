import type {
  AgentAnswer,
  AgentTraceStep,
  CourseChunk,
  DetectedConcept,
  KnowledgeCard,
  KnowledgeConcept,
  LLMConfig,
  MasteryRecord,
  NewConceptCandidate,
  QuestionType,
  QuizQuestion,
  SourceRef
} from "../types";
import { initialCards } from "../data/demoCourse";
import { conceptIdFromName, getMasteryLevel } from "./masteryService";
import { buildFallbackKnowledgeCard, normalizeCard } from "./knowledgeCardService";
import type { RetrievalResult } from "./retrievalService";
import { describeRetrievalResult } from "./retrievalService";

export type StructuredLLMResult = {
  answer: AgentAnswer;
  trace: AgentTraceStep[];
  cards: KnowledgeCard[];
};

export type GenerateKnowledgeCardParams = {
  conceptName: string;
  category?: string;
  courseName?: string;
  source?: "chat" | "quiz" | "quiz_explanation" | "related_concept" | "prerequisite" | "manual";
  userQuestion?: string;
  sourceText?: string;
  currentAnswerMarkdown?: string;
  currentQuizQuestion?: QuizQuestion;
  knownConcepts?: KnowledgeConcept[];
  masteryScore?: number;
  llmConfig?: LLMConfig;
};

const providerDefaults: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  dashscope: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "GLM-5" },
  zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  "openai-compatible": { baseUrl: "", model: "" }
};

export function getProviderDefaults(provider: string) {
  return providerDefaults[provider] ?? providerDefaults["openai-compatible"];
}

function sourceRefsFromChunks(chunks: CourseChunk[]): SourceRef[] {
  return chunks.slice(0, 3).map((chunk) => chunk.source);
}

function sourceRefsFromRetrieval(results: RetrievalResult[] | undefined, fallbackChunks: CourseChunk[]): SourceRef[] {
  if (!results || results.length === 0) return sourceRefsFromChunks(fallbackChunks);
  return results.map((result) => ({
    document: result.chunk.sourceTitle ?? result.chunk.source?.document ?? "current document",
    section: result.chunk.section ?? `chunk ${(result.chunk.index ?? 0) + 1}`,
    chunkId: result.chunk.id
  }));
}

function buildPrompt(question: string, chunks: CourseChunk[], concepts: KnowledgeConcept[], mastery: MasteryRecord[], contextChunks?: RetrievalResult[]) {
  const selectedChunks = contextChunks && contextChunks.length > 0 ? contextChunks.map((result) => result.chunk) : chunks.slice(0, 6);
  const contextText = selectedChunks
    .slice(0, 6)
    .map((chunk, index) => `[chunk ${index + 1} | ${chunk.sourceTitle ?? chunk.source.document} | index ${(chunk.index ?? index) + 1}]\n${(chunk.text ?? chunk.content).slice(0, 1400)}`)
    .join("\n\n");
  const contextNotice =
    contextChunks && contextChunks.length > 0
      ? contextChunks.some((result) => result.fallback)
        ? "No strong matching material was found. The context below uses the first document chunks as weak fallback context. Say this clearly if the material is insufficient."
        : "The context below was retrieved from the current course material. Prioritize it when answering."
      : "No course material context is available for this question. Answer as general chat if needed.";
  const conceptText = concepts.map((concept) => `${concept.name}（${concept.category}，${concept.status}）`).join("、");
  const masteryText = mastery.map((item) => `${item.conceptName}: ${item.score.toFixed(2)} ${getMasteryLevel(item.score)}`).join("\n");

  return `You are ZhiJie Agent, an AI learning assistant for university courses.
When course material chunks are provided, prioritize them. If the chunks do not contain enough evidence, explicitly say "?????????????" before using general knowledge.
Do not invent citations or claim that the material contains something it does not contain.
${contextNotice}

用户问题：
${question}

课程资料片段：
${contextText || "当前没有上传资料，主要依赖模型通用知识。"}

当前课程知识点：
${conceptText || "暂无知识点。"}

学生掌握画像：
${masteryText || "暂无画像。"}

请严格返回 JSON，不要返回 Markdown code fence，不要返回额外解释。

answerMarkdown 字段是给学生看的最终回答：
- 不要包含 JSON 字段说明。
- 不要包含内部推理过程。
- 不要把完整 JSON 或工具调用参数写进 answerMarkdown。
- 结构必须清楚：
  1. 先用 1-2 句话直接回答问题。
  2. 如果存在薄弱前置概念，使用“### 前置概念”小节补充。
  3. 使用“### 核心解释”小节解释主要问题。
  4. 必要时使用“### 例子”小节。
  5. 最后使用“### 下一步建议”小节。
- 数学公式必须使用 Markdown LaTeX：行内公式 $...$，块级公式 $$...$$。
- 不要使用 HTML 公式。

Concept extraction rules:
- detectedConcepts should only include real teachable concepts, methods, models, algorithms, theorems, skills, misconceptions, or applications.
- Do not list greetings, filler words, task verbs, generic nouns, or broad labels such as math/model/code/knowledge point/course as ordinary concepts.
- newConceptCandidates should include only course-external but educationally valuable concepts worth pending review.
- If a term is only casually mentioned, do not include it as a new candidate.
- For each new candidate, estimate contextRole, candidateType, educationalValue, noiseRisk, and granularity.


JSON Schema：
{
  "taskType": "course_qa",
  "detectedConcepts": [
    {
      "name": "概念名",
      "category": "数学基础/机器学习基础/深度学习/编程实现/论文阅读/待确认新概念",
      "status": "existing/candidate",
      "masteryScore": 0.28,
      "reason": "为什么识别到该概念"
    }
  ],
  "newConceptCandidates": [
    {
      "name": "新概念",
      "category": "分类",
      "confidence": 0.82,
      "shouldAddToCourse": true,
      "reason": "why this concept should be added",
      "contextRole": "main_topic/explicit_question/key_prerequisite/application/passing_mention/social/unknown",
      "candidateType": "concept/method/algorithm/model/theorem/skill/misconception/application/task/unknown",
      "educationalValue": 0.0,
      "noiseRisk": 0.0,
      "granularity": "good/too_broad/too_narrow/invalid/unknown"
    }
  ],
  "agentTrace": [
    {"step": "任务识别", "detail": "识别为课程问答"},
    {"step": "概念识别", "detail": "识别到..."},
    {"step": "资料检索", "detail": "使用上传资料中..."},
    {"step": "画像查询", "detail": "发现...掌握较弱"},
    {"step": "策略选择", "detail": "先补前置概念再解释..."},
    {"step": "回答生成", "detail": "生成 Markdown 回答和知识卡片"}
  ],
  "answerMarkdown": "适合直接展示给学生的 Markdown 回答",
  "knowledgeCards": [
    {
      "name": "链式法则",
      "category": "数学基础",
      "summary": "用于计算复合函数导数的规则。",
      "intuition": "当一个变量通过中间变量影响结果时，需要把每一段影响相乘。",
      "formula": "$$\\\\frac{dy}{dx}=\\\\frac{dy}{du}\\\\cdot\\\\frac{du}{dx}$$",
      "example": "如果 $y=(3x+1)^2$，令 $u=3x+1$...",
      "commonMistakes": ["只对外层函数求导，忘记乘以内层导数"],
      "prerequisites": ["函数", "导数", "复合函数"],
      "relatedConcepts": ["梯度", "反向传播"],
      "source": "上传资料或模型生成",
      "masterySuggestion": "听过但不稳"
    }
  ],
  "reviewSuggestions": ["复习链式法则卡片", "完成一道复合函数求导题"]
}`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) return JSON.parse(fence[1].trim());
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("无法从模型输出中解析 JSON。");
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function asContextRole(value: unknown): NewConceptCandidate["contextRole"] {
  return ["main_topic", "explicit_question", "key_prerequisite", "application", "example", "passing_mention", "social", "unknown"].includes(String(value))
    ? (String(value) as NewConceptCandidate["contextRole"])
    : undefined;
}

function asCandidateType(value: unknown): NewConceptCandidate["candidateType"] {
  return ["concept", "method", "algorithm", "model", "theorem", "skill", "misconception", "application", "task", "unknown"].includes(String(value))
    ? (String(value) as NewConceptCandidate["candidateType"])
    : undefined;
}

function asGranularity(value: unknown): NewConceptCandidate["granularity"] {
  return ["good", "too_broad", "too_narrow", "invalid", "unknown"].includes(String(value))
    ? (String(value) as NewConceptCandidate["granularity"])
    : undefined;
}

function asScore(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function normalizeLLMResult(raw: unknown, mode: "llm" | "mock", fallbackSources: SourceRef[]): StructuredLLMResult {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const detectedConcepts = Array.isArray(data.detectedConcepts)
    ? (data.detectedConcepts as Array<Record<string, unknown>>).map(
        (item): DetectedConcept => ({
          name: String(item.name ?? "未知概念"),
          category: String(item.category ?? "待确认新概念"),
          status: item.status === "existing" ? "existing" : "candidate",
          masteryScore: typeof item.masteryScore === "number" ? item.masteryScore : undefined,
          reason: typeof item.reason === "string" ? item.reason : ""
        })
      )
    : [];
  const candidates = Array.isArray(data.newConceptCandidates)
    ? (data.newConceptCandidates as Array<Record<string, unknown>>).map(
        (item): NewConceptCandidate => ({
          name: String(item.name ?? "未知新概念"),
          category: String(item.category ?? "待确认新概念"),
          confidence: typeof item.confidence === "number" ? item.confidence : 0.5,
          shouldAddToCourse: Boolean(item.shouldAddToCourse),
          reason: String(item.reason ?? ""),
          contextRole: asContextRole(item.contextRole),
          candidateType: asCandidateType(item.candidateType),
          educationalValue: asScore(item.educationalValue),
          noiseRisk: asScore(item.noiseRisk),
          granularity: asGranularity(item.granularity)
        })
      )
    : [];
  const cards = Array.isArray(data.knowledgeCards)
    ? (data.knowledgeCards as Array<Record<string, unknown>>).map((item) =>
        normalizeCard({
          name: String(item.name ?? "未知概念"),
          category: String(item.category ?? "待确认新概念"),
          summary: String(item.summary ?? ""),
          intuition: String(item.intuition ?? ""),
          formula: String(item.formula ?? ""),
          example: String(item.example ?? ""),
          commonMistakes: asStringArray(item.commonMistakes),
          prerequisites: asStringArray(item.prerequisites),
          relatedConcepts: asStringArray(item.relatedConcepts),
          source: String(item.source ?? "模型生成"),
          masterySuggestion: String(item.masterySuggestion ?? ""),
          status: "confirmed",
          generatedBy: "llm"
        })
      )
    : [];
  const trace = Array.isArray(data.agentTrace)
    ? (data.agentTrace as Array<Record<string, unknown>>).map((item, index): AgentTraceStep => ({
        id: `llm_trace_${index}`,
        title: String(item.step ?? `步骤 ${index + 1}`),
        type: "llm_trace",
        status: "success",
        detail: String(item.detail ?? "")
      }))
    : [];

  return {
    answer: {
      mode,
      taskType: String(data.taskType ?? "course_qa"),
      answerMarkdown: String(data.answerMarkdown ?? "模型返回内容无法结构化解析。"),
      concepts: detectedConcepts.map((concept) => conceptIdFromName(concept.name)),
      detectedConcepts,
      newConceptCandidates: candidates,
      sourceRefs: fallbackSources,
      reviewSuggestions: asStringArray(data.reviewSuggestions)
    },
    trace,
    cards
  };
}

function fallbackFromPlainText(text: string, sources: SourceRef[]): StructuredLLMResult {
  return {
    answer: {
      mode: "llm",
      taskType: "course_qa",
      answerMarkdown: `${text}\n\n> 提示：模型本次未返回结构化 JSON，已按普通 Markdown 回答展示。`,
      concepts: [],
      detectedConcepts: [],
      newConceptCandidates: [],
      sourceRefs: sources,
      reviewSuggestions: []
    },
    trace: [
      {
        id: `plain_${Date.now()}`,
        title: "JSON 解析降级",
        type: "parse_fallback",
        status: "success",
        detail: "模型未返回合法 JSON，聊天区已展示原始 Markdown 文本。"
      }
    ],
    cards: []
  };
}

export function buildMockAgentResponse(
  question: string,
  chunks: CourseChunk[],
  concepts: KnowledgeConcept[],
  mastery: MasteryRecord[],
  reason = "未配置模型或模型调用失败，使用 mock fallback。"
): StructuredLLMResult {
  const detected = concepts.filter((concept) => question.includes(concept.name));
  const fallbackDetected = detected.length > 0 ? detected : concepts.filter((concept) => ["链式法则", "反向传播", "梯度", "损失函数"].includes(concept.name));
  const sources = sourceRefsFromChunks(chunks);
  const chain = mastery.find((item) => item.conceptName === "链式法则");
  const answerMarkdown = `反向传播需要链式法则，是因为神经网络本身是一层套一层的复合函数，而训练时要计算最终损失对每一层参数的影响。

### 前置概念

如果 $y=f(g(x))$，变量 $x$ 会先影响 $g(x)$，再影响 $f$ 的输出。链式法则把这两段影响相乘：

$$
\\frac{dy}{dx}=\\frac{dy}{du}\\cdot\\frac{du}{dx}
$$

${chain && chain.score < 0.4 ? `你当前“链式法则”的掌握分是 **${chain.score.toFixed(2)}（${getMasteryLevel(chain.score)}）**，所以这里先补前置概念。` : ""}

### 核心解释

神经网络的输出由多层变换得到，损失函数又依赖这个输出。某一层参数对最终损失的影响不是直接发生的，而是通过后续多层逐步传递。因此反向传播会从输出层开始，把梯度一层层往前传，每一步都在使用链式法则。

### 例子

如果某层可以写成 $u=g(x)$，后面损失写成 $L=f(u)$，那么计算 $x$ 对损失的影响时就需要：

$$
\\frac{dL}{dx}=\\frac{dL}{du}\\cdot\\frac{du}{dx}
$$

### 下一步建议

1. 先复习“链式法则”卡片。
2. 做一道复合函数求导题。
3. 再看反向传播中梯度如何逐层传递。`;

  const detectedConcepts = fallbackDetected.map((concept): DetectedConcept => ({
    name: concept.name,
    category: concept.category,
    status: "existing",
    masteryScore: mastery.find((item) => item.conceptName === concept.name)?.score,
    reason: "从问题文本和课程知识点匹配得到"
  }));

  const raw = {
    taskType: "course_qa",
    detectedConcepts,
    newConceptCandidates: [],
    agentTrace: [
      { step: "任务识别", detail: "识别为课程问答" },
      { step: "概念识别", detail: `识别到 ${detectedConcepts.map((item) => item.name).join("、")}` },
      { step: "画像查询", detail: "读取学生掌握分并判断前置概念薄弱点" },
      { step: "资料检索", detail: chunks.length > 0 ? "使用上传或内置资料片段作为上下文" : "当前没有上传资料，主要依赖模型通用知识" },
      { step: "策略选择", detail: "链式法则较弱时，先补前置概念再讲反向传播" },
      { step: "回答生成", detail: reason }
    ],
    answerMarkdown,
    knowledgeCards: initialCards.filter((card) => detectedConcepts.some((concept) => concept.name === card.name)),
    reviewSuggestions: ["复习链式法则卡片", "完成一道复合函数求导题", "再看一遍反向传播中的梯度传递过程"]
  };
  return normalizeLLMResult(raw, "mock", sources);
}

function isDeepSeekV4(config: LLMConfig, model: string) {
  return config.provider === "deepseek" && /^deepseek-v4-(pro|flash)$/i.test(model);
}

function normalizeRequestModel(config: LLMConfig, model: string) {
  if (config.provider === "dashscope" && /^GLM-5$/i.test(model)) return "glm-5";
  return model;
}

function buildRequestBody(config: LLMConfig, model: string, messages: Array<{ role: string; content: string }>, maxTokens?: number) {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false
  };

  if (maxTokens) body.max_tokens = maxTokens;

  if (isDeepSeekV4(config, model)) {
    // DeepSeek V4 defaults to thinking mode. This Demo needs direct structured JSON,
    // so disable thinking to avoid responses with reasoning_content but empty content.
    body.thinking = { type: "disabled" };
  } else {
    body.temperature = config.temperature ?? 0.3;
  }

  return body;
}

function getChatCompletionsUrl(config: LLMConfig, baseUrl: string, model: string) {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(normalizedBaseUrl)) return normalizedBaseUrl;
  if (isDeepSeekV4(config, model) && /^https:\/\/api\.deepseek\.com\/v1\/?$/i.test(normalizedBaseUrl)) {
    return "https://api.deepseek.com/chat/completions";
  }
  return `${normalizedBaseUrl}/chat/completions`;
}

function formatHttpError(status: number, message: string) {
  if (status === 401) return `401 Unauthorized: invalid or unauthorized API Key. ${message}`;
  if (status === 404) return `404 Not Found: Base URL or model may be wrong. ${message}`;
  if (status === 429) return `429 Rate Limit: too many requests or insufficient quota. ${message}`;
  return `HTTP ${status}: ${message}`;
}
function extractErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const data = json as Record<string, unknown>;
  const error = data.error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  if (typeof data.message === "string") return data.message;
  return null;
}

async function postChatCompletions(config: LLMConfig, messages: Array<{ role: string; content: string }>, maxTokens?: number) {
  const defaults = getProviderDefaults(config.provider);
  const baseUrl = (config.baseUrl || defaults.baseUrl).trim().replace(/\/+$/, "");
  const model = normalizeRequestModel(config, config.model || defaults.model);
  if (!baseUrl || !model) throw new Error("Missing Base URL or Model Name.");

  let response: Response;
  try {
    response = await fetch(getChatCompletionsUrl(config, baseUrl, model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(buildRequestBody(config, model, messages, maxTokens))
    });
  } catch (error) {
    throw new Error(
      `Network/CORS Error: request did not reach the model service. Browser direct access may be blocked by CORS; use a backend proxy later. ${error instanceof Error ? error.message : ""}`
    );
  }

  const rawText = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error(`Model returned non-JSON response: ${rawText.slice(0, 240)}`);
  }

  const errorMessage = extractErrorMessage(json);
  if (!response.ok || errorMessage) {
    throw new Error(formatHttpError(response.status, errorMessage ?? rawText.slice(0, 240)));
  }

  const data = json as Record<string, any>;
  const message = data?.choices?.[0]?.message;
  const content = message?.content;
  const reasoningContent = message?.reasoning_content;
  if ((!content || typeof content !== "string") && reasoningContent) {
    throw new Error("Model returned reasoning_content but no final content. Thinking mode or token limit may be the cause.");
  }
  if (!content || typeof content !== "string") throw new Error("Model response is empty: missing choices[0].message.content.");
  return content;
}
function sourceLabel(source?: GenerateKnowledgeCardParams["source"]) {
  if (source === "chat") return "由问答中新概念生成";
  if (source === "quiz") return "由习题生成中新概念生成";
  if (source === "quiz_explanation") return "由习题解析中新概念生成";
  if (source === "related_concept") return "由相关概念点击生成";
  if (source === "prerequisite") return "由前置知识点击生成";
  return "由用户手动创建或补全";
}

function quizContext(question?: QuizQuestion) {
  if (!question) return "";
  return [
    `题干：${question.questionMarkdown}`,
    `选项：${question.options.map((option) => `${option.id}. ${option.textMarkdown}`).join("；")}`,
    `正确答案：${Array.isArray(question.answer) ? question.answer.join("、") : question.answer}`,
    `解析：${question.explanationMarkdown}`
  ].join("\n");
}

function buildKnowledgeCardPrompt(params: GenerateKnowledgeCardParams) {
  const knownConcepts = (params.knownConcepts ?? [])
    .slice(0, 80)
    .map((concept) => `${concept.name}（${concept.category || "待分类"}）`)
    .join("、");
  const contextParts = [
    params.sourceText,
    params.userQuestion ? `用户问题：${params.userQuestion}` : "",
    params.currentAnswerMarkdown ? `当前回答：${params.currentAnswerMarkdown.slice(0, 1600)}` : "",
    quizContext(params.currentQuizQuestion)
  ].filter(Boolean);

  return `你是一个面向学生的学习 Agent，需要为指定概念生成一张知识卡片。

课程名称：
${params.courseName || "机器学习基础"}

待生成卡片的概念：
${params.conceptName}

概念可能出现的上下文：
${contextParts.join("\n\n") || "暂无额外上下文，请结合通用学科知识和当前课程知识点生成。"}

当前课程中已有知识点：
${knownConcepts || "暂无"}

学生当前掌握度：
${typeof params.masteryScore === "number" ? params.masteryScore.toFixed(2) : "未知"}

请生成一张适合学生快速理解和复习的知识卡片。要求：
1. summary：一句话定义，不超过 60 字。
2. intuition：用直觉语言解释这个概念，避免堆砌术语。
3. formula：如果该概念有常见公式，用 LaTeX 给出；如果没有公式，返回空字符串。
4. example：给一个具体、简短的例子。
5. commonMistakes：列出 2-3 个常见误区。
6. prerequisites：列出理解该概念前最好掌握的 2-4 个前置知识点。
7. relatedConcepts：列出 3-5 个相关概念，优先使用课程已有知识点，也可以给出必要的新概念。
8. category：给出合适分类，例如“数学基础”“机器学习基础”“深度学习”“编程实现”“待分类”等。
9. source：说明该卡片基于什么上下文生成。

请严格返回 JSON：
{
  "name": "...",
  "category": "...",
  "summary": "...",
  "intuition": "...",
  "formula": "...",
  "example": "...",
  "commonMistakes": ["...", "..."],
  "prerequisites": ["...", "..."],
  "relatedConcepts": ["...", "..."],
  "source": "..."
}

数学公式必须使用 $...$ 或 $$...$$。
不要返回 Markdown 代码块。
不要返回 JSON 之外的文字。
relatedConcepts 和 prerequisites 不要包含当前概念本身，不要包含普通词。`;
}

export async function generateKnowledgeCardForConcept(params: GenerateKnowledgeCardParams): Promise<KnowledgeCard> {
  const fallback = buildFallbackKnowledgeCard({
    conceptName: params.conceptName,
    category: params.category,
    source: sourceLabel(params.source),
    sourceText: params.sourceText || params.currentAnswerMarkdown || quizContext(params.currentQuizQuestion),
    knownConcepts: params.knownConcepts
  });
  const config = params.llmConfig;
  if (!config?.apiKey.trim()) return fallback;

  try {
    const content = await postChatCompletions(
      config,
      [
        { role: "system", content: "你是知识卡片生成器，只输出合法 JSON，不要输出 Markdown code fence。" },
        { role: "user", content: buildKnowledgeCardPrompt(params) }
      ],
      1800
    );
    const data = extractJson(content) as Record<string, unknown>;
    return normalizeCard(
      {
        name: String(data.name ?? params.conceptName),
        category: String(data.category ?? params.category ?? "待分类"),
        summary: String(data.summary ?? ""),
        intuition: String(data.intuition ?? ""),
        formula: String(data.formula ?? ""),
        example: String(data.example ?? ""),
        commonMistakes: asStringArray(data.commonMistakes),
        prerequisites: asStringArray(data.prerequisites),
        relatedConcepts: asStringArray(data.relatedConcepts),
        source: String(data.source ?? sourceLabel(params.source)),
        status: "temporary",
        generatedBy: "llm"
      },
      sourceLabel(params.source),
      params.knownConcepts
    );
  } catch {
    return fallback;
  }
}

export async function callLLMAgent(
  config: LLMConfig,
  question: string,
  chunks: CourseChunk[],
  concepts: KnowledgeConcept[],
  mastery: MasteryRecord[],
  contextChunks?: RetrievalResult[]
): Promise<StructuredLLMResult> {
  if (!config.apiKey.trim()) {
    if (config.useMockFallback) return buildMockAgentResponse(question, chunks, concepts, mastery, "Missing API Key, using mock fallback.");
    throw new Error("Please configure API Key in Settings, or enable mock fallback.");
  }

  try {
    const materialTrace: AgentTraceStep | null = contextChunks
      ? {
          id: `materials_${Date.now()}`,
          title: contextChunks.length > 0 ? "Materials Retriever" : "Materials Retriever: no chunks",
          type: "retrieval",
          status: "success",
          detail:
            contextChunks.length > 0
              ? `Using ${contextChunks.length} chunk(s): ${contextChunks.map(describeRetrievalResult).join("; ")}`
              : "No material context injected; using normal chat.",
          data: contextChunks.map((result) => describeRetrievalResult(result))
        }
      : null;
    const content = await postChatCompletions(config, [
      { role: "system", content: "You are a strict learning Agent. Return valid JSON unless the user explicitly asks otherwise." },
      { role: "user", content: buildPrompt(question, chunks, concepts, mastery, contextChunks) }
    ]);
    const realApiTrace: AgentTraceStep = {
      id: `real_api_${Date.now()}`,
      title: "Real API",
      type: "llm_call",
      status: "success",
      detail: `${config.provider} / ${config.model || getProviderDefaults(config.provider).model}`
    };
    try {
      const result = normalizeLLMResult(extractJson(content), "llm", sourceRefsFromRetrieval(contextChunks, chunks));
      result.trace = [realApiTrace, ...(materialTrace ? [materialTrace] : []), ...result.trace];
      return result;
    } catch {
      const result = fallbackFromPlainText(content, sourceRefsFromRetrieval(contextChunks, chunks));
      result.trace = [realApiTrace, ...(materialTrace ? [materialTrace] : []), ...result.trace];
      return result;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown API error";
    if (config.useMockFallback) {
      const result = buildMockAgentResponse(question, chunks, concepts, mastery, `Real API failed, fallback to Mock: ${message}`);
      result.trace = [
        { id: `api_error_${Date.now()}`, title: "API Error -> Mock fallback", type: "llm_call", status: "failed", detail: message },
        ...(contextChunks && contextChunks.length > 0
          ? [
              {
                id: `materials_${Date.now()}`,
                title: "Materials Retriever",
                type: "retrieval",
                status: "success",
                detail: `Using ${contextChunks.length} chunk(s): ${contextChunks.map(describeRetrievalResult).join("; ")}`,
                data: contextChunks.map((result) => describeRetrievalResult(result))
              } as AgentTraceStep
            ]
          : []),
        ...result.trace
      ];
      return result;
    }
    throw error;
  }
}
export async function callQuizLLM(
  config: LLMConfig,
  concepts: KnowledgeConcept[],
  chunks: CourseChunk[],
  mastery: MasteryRecord[],
  difficulty: "basic" | "medium" | "advanced",
  selectedConceptNames: string[] = concepts.map((concept) => concept.name),
  selectedQuestionTypes: QuestionType[] = ["single_choice", "multiple_choice", "true_false"]
): Promise<unknown> {
  const contextText = chunks
    .slice(0, 5)
    .map((chunk, index) => `[${index + 1}] ${chunk.section}\n${chunk.content.slice(0, 1000)}`)
    .join("\n\n");
  const conceptText = concepts.map((concept) => `${concept.name}（${concept.category}）`).join("、");
  const selectedText = selectedConceptNames.length > 0 ? selectedConceptNames.join("、") : concepts.map((concept) => concept.name).join("、");
  const allowedTypeText = selectedQuestionTypes.join(", ");
  const masteryText = mastery.map((item) => `${item.conceptName}: ${item.score.toFixed(2)}`).join("；");
  const prompt = `请基于当前课程资料和知识点生成 3 道 ${difficulty} 难度诊断题。

课程资料：
${contextText || "暂无上传资料。"}

知识点：
${conceptText}

学生画像：
${masteryText}

本次允许生成的题型：${allowedTypeText}

你只能生成以下题型：
- single_choice：单选题，必须有 4 个选项，answer 是一个选项 id。
- multiple_choice：多选题，必须有 4 个选项，answer 是选项 id 数组。
- true_false：判断题，必须有 2 个选项，分别是 A. 正确 和 B. 错误，answer 是 A 或 B。

禁止生成 short_answer。
禁止生成填空题。
禁止生成没有 options 的题。
所有题干、选项、解析使用 Markdown。数学公式使用 $...$ 或 $$...$$。
严格返回 JSON，不要返回额外解释。

返回格式：
{
  "questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "difficulty": "${difficulty}",
      "conceptNames": ["链式法则"],
      "extraConcepts": [],
      "questionMarkdown": "若 $y=(3x+1)^2$，则 $\\\\frac{dy}{dx}$ 等于多少？",
      "options": [
        {"id": "A", "textMarkdown": "$2(3x+1)$"},
        {"id": "B", "textMarkdown": "$6(3x+1)$"},
        {"id": "C", "textMarkdown": "$3x+1$"},
        {"id": "D", "textMarkdown": "$9x^2$"}
      ],
      "answer": "B",
      "explanationMarkdown": "令 $u=3x+1$，则 $y=u^2$，所以 $$\\\\frac{dy}{dx}=2u\\\\cdot 3=6(3x+1)$$。"
    }
  ]
}`;
  const scopeInstruction = `本次用户指定考察的知识点为：${selectedText}

硬性范围要求：
1. 每一道题的 conceptNames 字段必须包含上面指定知识点中的至少一个。
2. 可以涉及其他交叉知识点，但不能生成完全不包含指定知识点的题。
3. 如果你想考察前置知识，也必须在题目中明确关联至少一个指定知识点。
4. 不允许生成与指定知识点无关的题。
5. 每一道题的 type 必须属于本次允许生成的题型：${allowedTypeText}。
6. 禁止生成未选择的题型；禁止 short_answer、填空题、开放问答题。`;

  const extraInstruction = `如果题目或解析中使用了当前知识库之外的新知识点，请在每道题的 extraConcepts 中列出。只列出真正的学科概念，不要列普通词。`;

  const content = await postChatCompletions(config, [
    { role: "system", content: "你是诊断测验生成器，只输出合法 JSON。" },
    { role: "user", content: `${scopeInstruction}\n\n${extraInstruction}\n\n${prompt}` }
  ]);
  return extractJson(content);
}

export async function testLLMConnection(config: LLMConfig): Promise<string> {
  if (!config.apiKey.trim()) throw new Error("请先填写 API Key。");
  const defaults = getProviderDefaults(config.provider);
  const model = config.model || defaults.model;
  await postChatCompletions(config, [{ role: "user", content: "请只回答 OK，用于连接测试。" }], isDeepSeekV4(config, model) ? 128 : 32);
  return `${model} 连接成功`;
}
