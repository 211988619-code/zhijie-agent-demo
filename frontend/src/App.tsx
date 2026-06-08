import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, BookOpenCheck, CalendarCheck, Compass, GraduationCap, LayoutDashboard, Layers3, LogOut, MessageSquarePlus, Moon, Plus, RotateCcw, Settings, Sun, Trash2 } from "lucide-react";
import { AgentTracePanel } from "./components/AgentTracePanel";
import { ChatWindow } from "./components/ChatWindow";
import { FeatureCard } from "./components/common/FeatureCard";
import { DashboardPage } from "./components/dashboard/DashboardPage";
import { DocumentPanel } from "./components/DocumentPanel";
import { KnowledgeCardDrawer } from "./components/KnowledgeCardDrawer";
import { AppShell } from "./components/layout/AppShell";
import { Header } from "./components/layout/Header";
import { RightSummaryPanel } from "./components/layout/RightSummaryPanel";
import { Sidebar, type WorkspaceTab } from "./components/layout/Sidebar";
import { MaterialsPage } from "./components/materials/MaterialsPage";
import { MasteryPanel } from "./components/MasteryPanel";
import { MistakeBookPanel } from "./components/MistakeBookPanel";
import { MistakesPage } from "./components/MistakesPage";
import { ModelSettings } from "./components/ModelSettings";
import { QuizPanel } from "./components/QuizPanel";
import { ReviewTaskPanel } from "./components/ReviewTaskPanel";
import { builtInDocument, builtInQuizBank, initialCards, initialConcepts, initialMastery } from "./data/demoCourse";
import { callLLMAgent, classifyConceptForKnowledgeBase, extractDocumentConceptsWithLLM, generateKnowledgeCardForConcept, getProviderDefaults } from "./services/llmClient";
import { isKnowledgeCardIncomplete, normalizeConceptName, upsertCards } from "./services/knowledgeCardService";
import { applyQuizResult, conceptIdFromName, getChatFeedbackDelta, updateConceptMastery, upsertMastery } from "./services/masteryService";
import { checkQuizAnswer, generateQuiz, getBuiltInQuiz } from "./services/quizService";
import { normalizeTraceRecord, normalizeTraceSteps } from "./services/traceLabels";
import type {
  AgentTraceStep,
  AgentSession,
  ChatMessage,
  CandidateConcept,
  KnowledgeCard,
  KnowledgeConcept,
  LearningSpace,
  LLMConfig,
  ModelConnectionStatus,
  MasteryEvent,
  MistakeItem,
  ParsedDocument,
  QuestionType,
  QuizAnswer,
  QuizDifficulty,
  QuizQuestion,
  QuizResultChange,
  ReviewTask,
  SpaceConcept,
  ThemeMode,
  UploadState
} from "./types";
import { canonicalizeConceptName } from "./services/conceptIdentity";
import { processConceptExtraction } from "./services/conceptExtractionService";
import { classifyConceptFallback, classifyConceptFinalFallback, ensureFinalKnowledgeCategory, isInvalidFinalCategory, isPendingCategoryLabel, reconcileKnowledgeState, reconcilePendingCandidatesAndTemporaryCards, sanitizeKnowledgeCategory, toCandidateConcept, upsertCandidateConcept } from "./services/knowledgeStateService";
import { retrieveRelevantChunks, type RetrievalResult } from "./services/retrievalService";

type RightPanelMode = "trace" | "mistakes" | "review" | "modelConfig";
type QuizDifficultySelection = "all" | QuizDifficulty;
type AppPage = "workbench" | "learningSpace" | "mistakes";
type SpaceRightPanelMode = "default" | "mistakes" | "review" | "modelConfig" | "diagnosis";
type MistakesRightPanelMode = "none" | "review" | "diagnosis" | "modelConfig";
type CrossPageNoticeState = {
  workbenchUnread: boolean;
  spacesUnread: boolean;
};
type QuizGenerationProgress = {
  conceptName: string;
  activeIndex: number;
  sourceLabel?: string;
};

const demoQuestion = "为什么神经网络的反向传播需要链式法则？请用公式解释。";
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function mistakeKeyForQuestion(question: QuizQuestion) {
  return `mistake_${hashText(
    [question.questionMarkdown, question.conceptNames?.join(",") ?? "", question.difficulty ?? "", question.type ?? ""].join("|")
  )}`;
}

function isSameMistakeQuestion(item: MistakeItem, question: QuizQuestion) {
  const key = mistakeKeyForQuestion(question);
  return item.id === key || item.questionId === key || item.question?.id === question.id;
}

function appPageFromPath(pathname: string): AppPage {
  if (pathname.startsWith("/mistakes")) return "mistakes";
  return pathname.startsWith("/spaces") ? "learningSpace" : "workbench";
}

function pathForAppPage(page: AppPage) {
  if (page === "mistakes") return "/mistakes";
  return page === "learningSpace" ? "/spaces" : "/workbench";
}

function getOverviewSessionTitle(spaceName: string) {
  return `${spaceName}总览 Agent`;
}

function getTopicSessionTitle(conceptName: string) {
  return `${conceptName} 专题`;
}

function isOverviewSessionForSpace(session: AgentSession, space?: LearningSpace | null) {
  return session.mode === "space" || Boolean(space && session.title.replace(/\s+/g, "") === getOverviewSessionTitle(space.name).replace(/\s+/g, ""));
}

function normalizeAgentSessionsForSpaces(spaces: LearningSpace[], sessions: AgentSession[]) {
  const bySpace = new Map(spaces.map((space) => [space.id, space]));
  const overviewIds = new Set<string>();
  const next: AgentSession[] = [];

  spaces.forEach((space) => {
    const existingOverview = sessions.find((session) => session.spaceId === space.id && isOverviewSessionForSpace(session, space));
    if (existingOverview) {
      overviewIds.add(existingOverview.id);
      next.push({
        ...existingOverview,
        title: getOverviewSessionTitle(space.name),
        mode: "space",
        focusConceptId: undefined,
        focusConceptName: undefined,
        status: "confirmed",
        isGenerating: existingOverview.isGenerating ?? false,
        hasUnreadCompletion: existingOverview.hasUnreadCompletion ?? false,
        hasBeenViewedAfterCompletion: existingOverview.hasBeenViewedAfterCompletion ?? false,
        needsTitleResolution: false
      });
    } else {
      next.push({
        id: `session_${space.id}_overview`,
        studentId: "demo_student",
        spaceId: space.id,
        title: getOverviewSessionTitle(space.name),
        mode: "space",
        status: "confirmed",
        isGenerating: false,
        hasUnreadCompletion: false,
        hasBeenViewedAfterCompletion: false,
        needsTitleResolution: false,
        createdAt: now(),
        updatedAt: now()
      });
    }
  });

  sessions.forEach((session) => {
    const space = bySpace.get(session.spaceId);
    if (space && isOverviewSessionForSpace(session, space)) {
      if (overviewIds.has(session.id)) return;
      return;
    }
    const focusConceptName = session.focusConceptName ?? session.focusConceptId;
    next.push({
      ...session,
      focusConceptName,
      title: focusConceptName && session.status !== "draft" ? getTopicSessionTitle(focusConceptName) : session.title,
      status: session.status ?? (focusConceptName ? "confirmed" : "draft"),
      isGenerating: session.isGenerating ?? false,
      hasUnreadCompletion: session.hasUnreadCompletion ?? false,
      hasBeenViewedAfterCompletion: session.hasBeenViewedAfterCompletion ?? false,
      needsTitleResolution: session.needsTitleResolution ?? false
    });
  });

  return next;
}

function textForPrompt(message: ChatMessage) {
  if (message.text) return message.text;
  if (message.answer?.answerMarkdown) return message.answer.answerMarkdown;
  return message.error ?? "";
}

function truncateForPrompt(value: string, maxLength = 900) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function buildRecentSessionContext(messages: ChatMessage[]) {
  return messages
    .slice(-8)
    .map((message) => `${message.role === "student" ? "学生" : "Agent"}：${truncateForPrompt(textForPrompt(message))}`)
    .filter((line) => line.trim().length > 0)
    .join("\n\n");
}

function AppSwitchMenu({
  activePage,
  rect,
  onNavigate,
  onKeepOpen,
  onClose
}: {
  activePage: AppPage;
  rect: DOMRect;
  onNavigate: (page: AppPage) => void;
  onKeepOpen: () => void;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="app-switch-menu global"
      style={{ top: rect.bottom + 8, left: rect.left }}
      onMouseEnter={onKeepOpen}
      onMouseLeave={onClose}
    >
      {activePage !== "workbench" && (
        <button onClick={() => { onNavigate("workbench"); onClose(); }}>
          <LayoutDashboard size={15} />
          学习工作区
        </button>
      )}
      {activePage !== "learningSpace" && (
        <button onClick={() => { onNavigate("learningSpace"); onClose(); }}>
          <Compass size={15} />
          学习空间
        </button>
      )}
      {activePage !== "mistakes" && (
        <button onClick={() => { onNavigate("mistakes"); onClose(); }}>
          <BookOpenCheck size={15} />
          错题本
        </button>
      )}
    </div>,
    document.body
  );
}


const MODEL_CONFIG_STORAGE_KEY = "learning-agent-model-config";

const defaultConfig: LLMConfig = {
  provider: "dashscope",
  apiKey: "",
  baseUrl: getProviderDefaults("dashscope").baseUrl,
  model: getProviderDefaults("dashscope").model,
  useMockFallback: true,
  temperature: 0.3
};

const demoAnswers: Record<string, QuizAnswer> = {
  q_chain_basic: "A",
  q_chain_formula_render: "B",
  q_gradient_basic: "B"
};

const seedTime = "2026-05-26T00:00:00.000Z";

const defaultLearningSpaces: LearningSpace[] = [
  { id: "space_math", name: "高等数学", description: "导数、函数、矩阵、概率等前置数学能力", icon: "∑", color: "green", createdAt: seedTime, updatedAt: seedTime },
  { id: "space_ml", name: "机器学习基础", description: "损失函数、梯度下降、泛化与基础模型", icon: "ML", color: "blue", createdAt: seedTime, updatedAt: seedTime },
  { id: "space_dl", name: "深度学习", description: "神经网络、反向传播、CNN、RNN 与 Transformer", icon: "DL", color: "purple", createdAt: seedTime, updatedAt: seedTime },
  { id: "space_rl", name: "强化学习", description: "MDP、Q-learning、策略梯度与 PPO", icon: "RL", color: "orange", createdAt: seedTime, updatedAt: seedTime },
  { id: "space_cv", name: "计算机视觉", description: "图像分类、卷积网络、检测与分割", icon: "CV", color: "cyan", createdAt: seedTime, updatedAt: seedTime },
  { id: "space_nlp", name: "自然语言处理", description: "语言模型、注意力机制、BERT 与 GPT", icon: "NLP", color: "red", createdAt: seedTime, updatedAt: seedTime }
];

const defaultAgentSessions: AgentSession[] = [
  { id: "session_math_overview", studentId: "demo_student", spaceId: "space_math", title: "高等数学总览 Agent", mode: "space", createdAt: seedTime, updatedAt: seedTime },
  { id: "session_ml_overview", studentId: "demo_student", spaceId: "space_ml", title: "机器学习基础总览 Agent", mode: "space", createdAt: seedTime, updatedAt: seedTime },
  { id: "session_dl_overview", studentId: "demo_student", spaceId: "space_dl", title: "深度学习总览 Agent", mode: "space", createdAt: seedTime, updatedAt: seedTime },
  { id: "session_dl_cnn", studentId: "demo_student", spaceId: "space_dl", focusConceptId: "CNN", title: "CNN 专题", mode: "concept", createdAt: seedTime, updatedAt: seedTime },
  { id: "session_dl_rnn", studentId: "demo_student", spaceId: "space_dl", focusConceptId: "RNN", title: "RNN 专题", mode: "concept", createdAt: seedTime, updatedAt: seedTime },
  { id: "session_dl_backprop", studentId: "demo_student", spaceId: "space_dl", focusConceptId: "反向传播", title: "反向传播专题", mode: "concept", createdAt: seedTime, updatedAt: seedTime },
  { id: "session_dl_transformer", studentId: "demo_student", spaceId: "space_dl", focusConceptId: "Transformer", title: "Transformer 专题", mode: "concept", createdAt: seedTime, updatedAt: seedTime },
  { id: "session_rl_overview", studentId: "demo_student", spaceId: "space_rl", title: "强化学习总览 Agent", mode: "space", createdAt: seedTime, updatedAt: seedTime },
  { id: "session_rl_mdp", studentId: "demo_student", spaceId: "space_rl", focusConceptId: "MDP", title: "MDP 专题", mode: "concept", createdAt: seedTime, updatedAt: seedTime },
  { id: "session_rl_q", studentId: "demo_student", spaceId: "space_rl", focusConceptId: "Q-learning", title: "Q-learning 专题", mode: "concept", createdAt: seedTime, updatedAt: seedTime },
  { id: "session_rl_ppo", studentId: "demo_student", spaceId: "space_rl", focusConceptId: "PPO", title: "PPO 专题", mode: "concept", createdAt: seedTime, updatedAt: seedTime }
];

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or privacy-mode failures.
  }
}

function difficultyFromMastery(score: number | undefined): "basic" | "medium" | "advanced" {
  if (score === undefined || score < 0.4) return "basic";
  if (score < 0.7) return "medium";
  return "advanced";
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => readLocal<ThemeMode>("theme", "light"));
  const [parsedDocument, setParsedDocument] = useState<ParsedDocument>(builtInDocument);
  const [bootKnowledge] = useState(() =>
    reconcileKnowledgeState({
      concepts: readLocal("courseKnowledge", initialConcepts),
      cards: readLocal("knowledgeCards", initialCards),
      mastery: readLocal("mastery", initialMastery),
      candidates: readLocal("candidateConcepts", [])
    })
  );
  const [concepts, setConcepts] = useState<KnowledgeConcept[]>(() => bootKnowledge.concepts);
  const [cards, setCards] = useState<KnowledgeCard[]>(() => bootKnowledge.cards);
  const [temporaryCards, setTemporaryCards] = useState<KnowledgeCard[]>(() => readLocal("temporaryKnowledgeCards", []));
  const [mastery, setMastery] = useState(() => bootKnowledge.mastery);
  const [pendingCandidates, setPendingCandidates] = useState<CandidateConcept[]>(() => bootKnowledge.candidates);
  const [reviewTasks, setReviewTasks] = useState<ReviewTask[]>(() => readLocal("reviewTasks", []));
  const [mistakes, setMistakes] = useState<MistakeItem[]>(() => readLocal("mistakeBook", []));
  const [appliedMasteryEventIds, setAppliedMasteryEventIds] = useState<string[]>(() => readLocal("appliedMasteryEventIds", []));
  const [feedbackByMessageConcept, setFeedbackByMessageConcept] = useState<Record<string, "understood" | "confused">>(() =>
    readLocal("feedbackEvents", {})
  );
  const [dismissedCandidateNames, setDismissedCandidateNames] = useState<string[]>(() => readLocal("dismissedCandidateNames", []));
  const [recentExtractedCandidateKeys, setRecentExtractedCandidateKeys] = useState<string[]>([]);
  const [candidateMasteryPicker, setCandidateMasteryPicker] = useState<string | null>(null);
  const [candidateInitialScores, setCandidateInitialScores] = useState<Record<string, number>>({});
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("trace");
  const [activePage, setActivePageState] = useState<AppPage>(() => appPageFromPath(window.location.pathname));
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>("dashboard");
  const [learningSpaces, setLearningSpaces] = useState<LearningSpace[]>(() => readLocal("learningSpaces", defaultLearningSpaces));
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>(() =>
    normalizeAgentSessionsForSpaces(readLocal("learningSpaces", defaultLearningSpaces), readLocal<AgentSession[]>("agentSessions", defaultAgentSessions))
  );
  const [activeLearningSpaceId, setActiveLearningSpaceId] = useState(() => readLocal("activeLearningSpaceId", "space_dl"));
  const [activeSessionId, setActiveSessionId] = useState(() => readLocal("activeSessionId", "session_dl_overview"));
  const [spaceRightPanelMode, setSpaceRightPanelMode] = useState<SpaceRightPanelMode>(() => readLocal<SpaceRightPanelMode>("spaceRightPanelMode", "default"));
  const [spaceConcepts, setSpaceConcepts] = useState<SpaceConcept[]>(() => readLocal("spaceConcepts", []));
  const [sessionMessages, setSessionMessages] = useState<Record<string, ChatMessage[]>>(() => readLocal("agentSessionMessages", {}));
  const [sessionInputs, setSessionInputs] = useState<Record<string, string>>(() => readLocal("agentSessionInputs", {}));
  const [sessionTrace, setSessionTrace] = useState<Record<string, AgentTraceStep[]>>(() => normalizeTraceRecord(readLocal("agentSessionTrace", {})));
  const [sessionLoading, setSessionLoading] = useState(false);
  const [masteryCollapsed, setMasteryCollapsed] = useState(() => readLocal("masteryCollapsed", false));
  const [cardsCollapsed, setCardsCollapsed] = useState(() => readLocal("cardsCollapsed", false));

  const appliedEventRef = useRef(new Set(appliedMasteryEventIds));
  const feedbackRef = useRef({ ...feedbackByMessageConcept });
  const scoredQuestionRef = useRef(new Set(readLocal<string[]>("scoredQuestionKeys", [])));
  const reviewTaskIdsRef = useRef(new Set(reviewTasks.map((task) => task.id)));
  const mistakeIdsRef = useRef(new Set(mistakes.flatMap((item) => [item.id, item.questionId])));
  const conceptNameSetRef = useRef(new Set(concepts.map((concept) => normalizeConceptName(concept.name))));
  const quizSubmitLockedRef = useRef(readLocal<boolean>("quizSubmitted", false));
  const activePageRef = useRef(activePage);
  const activeSessionIdRef = useRef(activeSessionId);
  const generatingSessionIdsRef = useRef(new Set<string>());
  const appMenuCloseTimerRef = useRef<number | null>(null);
  const knowledgeSyncGuardRef = useRef(false);

  const [config, setConfig] = useState<LLMConfig>(() => ({ ...defaultConfig, ...readLocal<Partial<LLMConfig>>(MODEL_CONFIG_STORAGE_KEY, {}) }));
  const [modelStatus, setModelStatus] = useState<ModelConnectionStatus>(() => (readLocal<Partial<LLMConfig>>(MODEL_CONFIG_STORAGE_KEY, {}).apiKey ? "mock" : "missing-key"));
  const [lastModelError, setLastModelError] = useState("");
  const connected = modelStatus === "ready";
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "agent",
      text: "课程资料已加载。你可以上传资料、配置模型，也可以直接使用 mock fallback 演示。"
    }
  ]);
  const [trace, setTrace] = useState<AgentTraceStep[]>([]);
  const [lastRetrievalResults, setLastRetrievalResults] = useState<RetrievalResult[]>([]);
  const [input, setInput] = useState(demoQuestion);
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [secondaryCard, setSecondaryCard] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [quizAttemptId, setQuizAttemptId] = useState(() => readLocal("quizAttemptId", `attempt_${Date.now()}`));
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>(() => readLocal("quizQuestions", builtInQuizBank.slice(0, 3)));
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, QuizAnswer>>(() => readLocal("quizSelectedAnswers", demoAnswers));
  const [quizSubmitted, setQuizSubmitted] = useState(() => readLocal("quizSubmitted", false));
  const [quizDifficulty, setQuizDifficulty] = useState<"all" | "basic" | "medium" | "advanced">("all");
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<QuestionType[]>(() =>
    readLocal<QuestionType[]>("selectedQuestionTypes", ["single_choice", "multiple_choice", "true_false"])
  );
  const [quizCategory, setQuizCategory] = useState("全部");
  const [selectedConceptNames, setSelectedConceptNames] = useState<string[]>([]);
  const [conceptSelectorOpen, setConceptSelectorOpen] = useState(false);
  const [quizHighlight, setQuizHighlight] = useState(false);
  const [quizGenerating, setQuizGenerating] = useState(false);
  const [quizChanges, setQuizChanges] = useState<QuizResultChange[]>(() => readLocal("quizChanges", []));
  const [quizWarning, setQuizWarning] = useState("");
  const [quizDifficultyHint, setQuizDifficultyHint] = useState("");
  const [quizSummary, setQuizSummary] = useState("");
  const [quizGenerationProgress, setQuizGenerationProgress] = useState<QuizGenerationProgress | null>(null);
  const [quizCollapsed, setQuizCollapsed] = useState(() => readLocal("quizCollapsed", false));
  const [quizSource, setQuizSource] = useState<"diagnosis" | "knowledge_check" | "review_task">("diagnosis");
  const [activeReviewTaskId, setActiveReviewTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [crossPageNotice, setCrossPageNotice] = useState<CrossPageNoticeState>({ workbenchUnread: false, spacesUnread: false });
  const [deletingSessionIds, setDeletingSessionIds] = useState<string[]>([]);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [appMenuRect, setAppMenuRect] = useState<DOMRect | null>(null);
  const [lastVisitedMainPage, setLastVisitedMainPage] = useState<"workbench" | "learningSpace">(() => readLocal<"workbench" | "learningSpace">("lastVisitedMainPage", "workbench"));
  const [mistakesRightPanelMode, setMistakesRightPanelMode] = useState<MistakesRightPanelMode>("none");

  useEffect(() => {
    if (window.location.pathname === "/") {
      window.history.replaceState(null, "", "/workbench");
      setActivePageState("workbench");
    }
    const handlePopState = () => setActivePageState(appPageFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    activePageRef.current = activePage;
    if (activePage === "workbench") {
      setCrossPageNotice((current) => ({ ...current, workbenchUnread: false }));
    }
  }, [activePage]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    window.document.documentElement.dataset.theme = theme;
    writeLocal("theme", theme);
  }, [theme]);

  useEffect(() => {
    conceptNameSetRef.current = new Set(concepts.map((concept) => normalizeConceptName(concept.name)));
    writeLocal("courseKnowledge", concepts);
  }, [concepts]);
  useEffect(() => writeLocal("knowledgeCards", cards), [cards]);
  useEffect(() => writeLocal("temporaryKnowledgeCards", temporaryCards), [temporaryCards]);
  useEffect(() => writeLocal("mastery", mastery), [mastery]);
  useEffect(() => writeLocal("candidateConcepts", pendingCandidates), [pendingCandidates]);
  useEffect(() => {
    reviewTaskIdsRef.current = new Set(reviewTasks.map((task) => task.id));
    writeLocal("reviewTasks", reviewTasks);
  }, [reviewTasks]);
  useEffect(() => {
    mistakeIdsRef.current = new Set(mistakes.flatMap((item) => [item.id, item.questionId]));
    writeLocal("mistakeBook", mistakes);
  }, [mistakes]);
  useEffect(() => writeLocal("masteryCollapsed", masteryCollapsed), [masteryCollapsed]);
  useEffect(() => writeLocal("cardsCollapsed", cardsCollapsed), [cardsCollapsed]);
  useEffect(() => writeLocal("quizCollapsed", quizCollapsed), [quizCollapsed]);
  useEffect(() => writeLocal("feedbackEvents", feedbackByMessageConcept), [feedbackByMessageConcept]);
  useEffect(() => writeLocal("dismissedCandidateNames", dismissedCandidateNames), [dismissedCandidateNames]);
  useEffect(() => writeLocal("appliedMasteryEventIds", appliedMasteryEventIds), [appliedMasteryEventIds]);
  useEffect(() => writeLocal("quizAttemptId", quizAttemptId), [quizAttemptId]);
  useEffect(() => writeLocal("quizQuestions", quizQuestions), [quizQuestions]);
  useEffect(() => writeLocal("quizSelectedAnswers", selectedAnswers), [selectedAnswers]);
  useEffect(() => writeLocal("quizSubmitted", quizSubmitted), [quizSubmitted]);
  useEffect(() => writeLocal("quizChanges", quizChanges), [quizChanges]);
  useEffect(() => writeLocal("selectedQuestionTypes", selectedQuestionTypes), [selectedQuestionTypes]);
  useEffect(() => writeLocal("learningSpaces", learningSpaces), [learningSpaces]);
  useEffect(() => writeLocal("agentSessions", agentSessions), [agentSessions]);
  useEffect(() => {
    setAgentSessions((current) => {
      const normalized = normalizeAgentSessionsForSpaces(learningSpaces, current);
      return JSON.stringify(normalized) === JSON.stringify(current) ? current : normalized;
    });
  }, [learningSpaces]);
  useEffect(() => writeLocal("activeLearningSpaceId", activeLearningSpaceId), [activeLearningSpaceId]);
  useEffect(() => writeLocal("activeSessionId", activeSessionId), [activeSessionId]);
  useEffect(() => writeLocal("spaceRightPanelMode", spaceRightPanelMode), [spaceRightPanelMode]);
  useEffect(() => writeLocal("spaceConcepts", spaceConcepts), [spaceConcepts]);
  useEffect(() => writeLocal("agentSessionMessages", sessionMessages), [sessionMessages]);
  useEffect(() => writeLocal("agentSessionInputs", sessionInputs), [sessionInputs]);
  useEffect(() => writeLocal("agentSessionTrace", sessionTrace), [sessionTrace]);
  useEffect(() => writeLocal("lastVisitedMainPage", lastVisitedMainPage), [lastVisitedMainPage]);
  useEffect(() => writeLocal(MODEL_CONFIG_STORAGE_KEY, config), [config]);

  useEffect(() => {
    if (knowledgeSyncGuardRef.current) return;
    const sync = reconcilePendingCandidatesAndTemporaryCards({
      pendingCandidates,
      temporaryCards,
      confirmedConcepts: concepts
    });
    const pendingChanged = JSON.stringify(sync.pendingCandidates) !== JSON.stringify(pendingCandidates);
    const cardsChanged = JSON.stringify(sync.temporaryCards) !== JSON.stringify(temporaryCards);
    if (!pendingChanged && !cardsChanged) return;
    knowledgeSyncGuardRef.current = true;
    if (pendingChanged) setPendingCandidates(sync.pendingCandidates);
    if (cardsChanged) setTemporaryCards(sync.temporaryCards);
    queueMicrotask(() => {
      knowledgeSyncGuardRef.current = false;
    });
    const devEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
    if (devEnv) {
      console.debug("[knowledge-sync]", {
        pendingCandidates: sync.pendingCandidates.length,
        temporaryCards: sync.temporaryCards.length,
        missingTemporaryCards: sync.missingTemporaryCards,
        orphanTemporaryCards: sync.orphanTemporaryCards
      });
    }
  }, [pendingCandidates, temporaryCards, concepts]);

  const categories = useMemo(() => Array.from(new Set(cards.map((card) => card.category))), [cards]);
  const drawerCards = useMemo(() => upsertCards(cards, temporaryCards), [cards, temporaryCards]);
  const [activeCategory, setActiveCategory] = useState("全部");
  const visibleCards = activeCategory === "全部" ? cards : cards.filter((card) => card.category === activeCategory);

  const candidateConcepts = pendingCandidates
    .filter((candidate) => !dismissedCandidateNames.includes(candidate.normalizedKey))
    .filter((candidate) => !concepts.some((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) === candidate.normalizedKey));
  const displayedCandidateConcepts = useMemo(() => {
    const byKey = new Map(candidateConcepts.map((candidate) => [candidate.normalizedKey, candidate]));
    const recent = recentExtractedCandidateKeys.map((key) => byKey.get(key)).filter((candidate): candidate is CandidateConcept => Boolean(candidate));
    const recentKeys = new Set(recent.map((candidate) => candidate.normalizedKey));
    return [...recent, ...candidateConcepts.filter((candidate) => !recentKeys.has(candidate.normalizedKey))];
  }, [candidateConcepts, recentExtractedCandidateKeys]);
  const visibleCandidateConcepts = displayedCandidateConcepts.slice(0, 8);
  const hiddenCandidateConceptCount = Math.max(0, displayedCandidateConcepts.length - visibleCandidateConcepts.length);

  const activeLearningSpace = learningSpaces.find((space) => space.id === activeLearningSpaceId) ?? learningSpaces[0];
  const activeSession = agentSessions.find((session) => session.id === activeSessionId) ?? agentSessions.find((session) => session.spaceId === activeLearningSpace?.id);
  const sessionsForActiveSpace = agentSessions.filter((session) => session.spaceId === activeLearningSpace?.id);
  const spacesHasUnread = agentSessions.some((session) => session.hasUnreadCompletion);

  useEffect(() => {
    if (!spacesHasUnread) {
      setCrossPageNotice((current) => (current.spacesUnread ? { ...current, spacesUnread: false } : current));
    }
  }, [spacesHasUnread]);
  const sessionMessagesForActive = activeSession ? sessionMessages[activeSession.id] ?? [] : [];
  const expertInput = activeSession ? sessionInputs[activeSession.id] ?? "" : "";
  const expertTrace = activeSession ? sessionTrace[activeSession.id] ?? [] : [];
  const scopedConcepts = useMemo(() => {
    if (!activeLearningSpace) return concepts;
    const relationIds = new Set(spaceConcepts.filter((item) => item.spaceId === activeLearningSpace.id).map((item) => normalizeConceptName(item.conceptId)));
    const spaceName = activeLearningSpace.name;
    const keywordMap: Record<string, string[]> = {
      "高等数学": ["导数", "链式法则", "函数", "矩阵", "概率"],
      "机器学习基础": ["梯度", "损失函数", "过拟合", "正则化", "SVM", "PCA"],
      "深度学习": ["CNN", "RNN", "反向传播", "梯度", "损失函数", "激活函数", "链式法则", "矩阵乘法", "Transformer"],
      "强化学习": ["MDP", "Q-learning", "PPO", "策略", "价值函数", "强化学习"],
      "计算机视觉": ["CNN", "卷积", "ResNet", "图像", "视觉"],
      "自然语言处理": ["Transformer", "BERT", "GPT", "注意力", "语言模型"]
    };
    const keywords = keywordMap[spaceName] ?? [];
    const matched = concepts.filter((concept) => {
      const haystack = [concept.name, concept.canonicalName, concept.category, ...(concept.aliases ?? [])].join(" ");
      return relationIds.has(normalizeConceptName(concept.id)) || relationIds.has(normalizeConceptName(concept.name)) || keywords.some((keyword) => haystack.includes(keyword));
    });
    return matched.length > 0 ? matched : concepts;
  }, [activeLearningSpace, concepts, spaceConcepts]);
  const scopedMastery = useMemo(() => {
    const names = new Set(scopedConcepts.map((concept) => normalizeConceptName(concept.name)));
    const filtered = mastery.filter((record) => names.has(normalizeConceptName(record.conceptName)));
    return filtered.length > 0 ? filtered : mastery;
  }, [mastery, scopedConcepts]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  };

  const appendTraceSteps = (steps: Omit<AgentTraceStep, "id">[]) => {
    const timestamp = Date.now();
    setTrace((current) => [
      ...normalizeTraceSteps(
        steps.map((step, index) => ({
          id: `local_trace_${timestamp}_${index}`,
          ...step
        }))
      ),
      ...current
    ]);
  };

  const addPendingCandidate = (
    candidate: { name: string; category?: string; reason?: string; source?: CandidateConcept["source"] },
    source: CandidateConcept["source"] = "chat"
  ) => {
    const pending = toCandidateConcept(candidate, [...concepts, ...pendingCandidates], source);
    setPendingCandidates((current) => upsertCandidateConcept(current, pending, concepts));
    return pending;
  };

  const classifyCandidatesForPending = async (candidates: CandidateConcept[]) => {
    const existingCategories = Array.from(new Set([...concepts.map((concept) => concept.category), ...cards.map((card) => card.category)]));
    return Promise.all(
      candidates.map(async (candidate) => {
        const fallbackCategory = classifyConceptFinalFallback(candidate.canonicalName, candidate.aliases);
        if (!isInvalidFinalCategory(candidate.suggestedCategory)) {
          return { ...candidate, suggestedCategory: ensureFinalKnowledgeCategory(candidate.suggestedCategory, fallbackCategory) };
        }
        const classified = await classifyConceptForKnowledgeBase({
          concept: candidate,
          existingCategories,
          knownConcepts: concepts,
          llmConfig: config
        });
        return {
          ...candidate,
          suggestedCategory: ensureFinalKnowledgeCategory(classified.category, fallbackCategory)
        };
      })
    );
  };

  const addAgentExtractedCandidates = async (rawText: string, answerMarkdown: string, answer: { detectedConcepts: { name: string; category: string; status: "existing" | "candidate"; reason?: string }[]; newConceptCandidates: { name: string; category: string; reason: string; confidence: number; shouldAddToCourse: boolean; contextRole?: CandidateConcept["contextRole"]; candidateType?: CandidateConcept["candidateType"]; educationalValue?: number; noiseRisk?: number; granularity?: CandidateConcept["granularity"] }[] }) => {
    const extraction = processConceptExtraction({
      sourceType: "chat",
      rawText,
      contextText: answerMarkdown,
      knownConcepts: concepts,
      pendingCandidates,
      llmCandidates: [
        ...answer.detectedConcepts.map((concept) => ({
          name: concept.name,
          category: concept.category,
          reason: concept.reason,
          confidence: concept.status === "existing" ? 0.78 : 0.52,
          shouldAddToCourse: concept.status === "candidate",
          status: concept.status,
          contextRole: concept.status === "existing" ? ("explicit_question" as const) : ("unknown" as const),
          candidateType: concept.status === "existing" ? ("concept" as const) : ("unknown" as const),
          educationalValue: concept.status === "existing" ? 0.84 : 0.52,
          noiseRisk: concept.status === "existing" ? 0.18 : 0.42,
          granularity: concept.status === "existing" ? ("good" as const) : ("unknown" as const)
        })),
        ...answer.newConceptCandidates.map((candidate) => ({
          name: candidate.name,
          category: candidate.category,
          reason: candidate.reason,
          confidence: candidate.confidence,
          shouldAddToCourse: candidate.shouldAddToCourse,
          contextRole: candidate.contextRole,
          candidateType: candidate.candidateType,
          educationalValue: candidate.educationalValue,
          noiseRisk: candidate.noiseRisk,
          granularity: candidate.granularity
        }))
      ]
    });
    if (extraction.acceptedCandidates.length > 0) {
      const classifiedCandidates = await classifyCandidatesForPending(extraction.acceptedCandidates);
      setRecentExtractedCandidateKeys(classifiedCandidates.map((candidate) => candidate.normalizedKey));
      setPendingCandidates((current) => classifiedCandidates.reduce((next, candidate) => upsertCandidateConcept(next, candidate, concepts), current));
      await ensureTemporaryCardsForCandidates(classifiedCandidates, {
        source: "chat",
        userQuestion: rawText,
        currentAnswerMarkdown: answerMarkdown,
        limit: Math.max(4, classifiedCandidates.length)
      });
      return { ...extraction, acceptedCandidates: classifiedCandidates };
    }
    setRecentExtractedCandidateKeys([]);
    return extraction;
  };

  const dismissCandidate = (candidate: CandidateConcept) => {
    setPendingCandidates((current) => current.filter((item) => item.normalizedKey !== candidate.normalizedKey));
    setTemporaryCards((current) => current.filter((card) => (card.normalizedKey || normalizeConceptName(card.name)) !== candidate.normalizedKey));
    setDismissedCandidateNames((current) => (current.includes(candidate.normalizedKey) ? current : [...current, candidate.normalizedKey]));
    setCandidateMasteryPicker(null);
    showToast("已清除候选知识点");
  };

  const removeConceptFromMaterials = (item: KnowledgeConcept | CandidateConcept) => {
    const name = "name" in item ? item.name : item.canonicalName;
    const canonical = canonicalizeConceptName(name, [...concepts, ...pendingCandidates]);
    const normalized = canonical.normalizedKey;
    const confirmed = concepts.some((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) === normalized);
    const message = confirmed
      ? `Remove "${canonical.canonicalName}" from the current knowledge base? The related card will be removed, while mastery records stay.`
      : `Ignore candidate concept "${canonical.canonicalName}"?`;
    if (!window.confirm(message)) return;

    setConcepts((current) => {
      const next = current.filter((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) !== normalized);
      conceptNameSetRef.current = new Set(next.map((concept) => concept.normalizedKey || normalizeConceptName(concept.name)));
      return next;
    });
    setPendingCandidates((current) => current.filter((candidate) => candidate.normalizedKey !== normalized));
    setCards((current) => current.filter((card) => (card.normalizedKey || normalizeConceptName(card.name)) !== normalized));
    setTemporaryCards((current) => current.filter((card) => (card.normalizedKey || normalizeConceptName(card.name)) !== normalized));
    setDismissedCandidateNames((current) => (current.includes(normalized) ? current : [...current, normalized]));
    showToast(confirmed ? `Removed from knowledge base: ${canonical.canonicalName}` : `Ignored candidate concept: ${canonical.canonicalName}`);
  };

  const removeKnowledgeCardFromMaterials = (card: KnowledgeCard) => {
    const normalized = card.normalizedKey || normalizeConceptName(card.name);
    if (!window.confirm(`Delete knowledge card "${card.name}"? The concept and mastery records will stay.`)) return;
    setCards((current) => current.filter((item) => item.id !== card.id && (item.normalizedKey || normalizeConceptName(item.name)) !== normalized));
    setTemporaryCards((current) => current.filter((item) => item.id !== card.id && (item.normalizedKey || normalizeConceptName(item.name)) !== normalized));
    showToast(`Deleted knowledge card: ${card.name}`);
  };

  const confirmCandidateFromMaterials = (candidate: CandidateConcept) => {
    void addCandidateToCourseKnowledge(
      candidate.canonicalName,
      candidate.suggestedCategory ?? "Uncategorized",
      candidate.reason ?? candidate.summary ?? "Confirmed from Materials page",
      0.2,
      undefined,
      (candidate.source === "document" ? "manual" : candidate.source)
    ).then(() => {
      showToast(`Added to knowledge base: ${candidate.canonicalName}`);
    });
  };

  const rejectCandidateConcept = (candidate: CandidateConcept) => {
    dismissCandidate(candidate);
    showToast(`Ignored candidate concept: ${candidate.canonicalName}`);
  };

  const restoreDemoDocument = () => {
    setParsedDocument(builtInDocument);
    showToast("Restored built-in demo material");
  };

  const toggleRightPanel = (mode: Exclude<RightPanelMode, "trace">) => {
    setRightPanelMode((current) => (current === mode ? "trace" : mode));
  };

  const handleConfigChange = (next: LLMConfig) => {
    setConfig(next);
    setLastModelError("");
    if (!next.apiKey.trim()) setModelStatus(next.useMockFallback ? "mock" : "missing-key");
    else setModelStatus(next.useMockFallback ? "mock" : "missing-key");
  };

  const handleModelStatusChange = (status: ModelConnectionStatus, error = "") => {
    setModelStatus(status);
    setLastModelError(error);
  };

  const handleWorkspaceTabChange = (tab: WorkspaceTab) => {
    setActiveWorkspaceTab(tab);
    if (rightPanelMode === "modelConfig") setRightPanelMode("trace");
  };

  const navigatePage = (page: AppPage) => {
    if (page === "mistakes" && activePageRef.current !== "mistakes") {
      setLastVisitedMainPage(activePageRef.current === "learningSpace" ? "learningSpace" : "workbench");
    }
    const path = pathForAppPage(page);
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
    activePageRef.current = page;
    setActivePageState(page);
  };

  const openAppMenu = (rect: DOMRect) => {
    if (appMenuCloseTimerRef.current) {
      window.clearTimeout(appMenuCloseTimerRef.current);
      appMenuCloseTimerRef.current = null;
    }
    setAppMenuRect(rect);
    setAppMenuOpen(true);
  };

  const scheduleAppMenuClose = () => {
    if (appMenuCloseTimerRef.current) window.clearTimeout(appMenuCloseTimerRef.current);
    appMenuCloseTimerRef.current = window.setTimeout(() => setAppMenuOpen(false), 120);
  };

  const closeAppMenu = () => {
    if (appMenuCloseTimerRef.current) {
      window.clearTimeout(appMenuCloseTimerRef.current);
      appMenuCloseTimerRef.current = null;
    }
    setAppMenuOpen(false);
  };

  const toggleSpaceRightPanel = (mode: Exclude<SpaceRightPanelMode, "default">) => {
    setSpaceRightPanelMode((current) => (current === mode ? "default" : mode));
  };

  const toggleMistakesRightPanel = (mode: Exclude<MistakesRightPanelMode, "none">) => {
    setMistakesRightPanelMode((current) => (current === mode ? "none" : mode));
  };

  const openDiagnosisPanelForCurrentPage = () => {
    if (activePageRef.current === "learningSpace") {
      setSpaceRightPanelMode("diagnosis");
    } else if (activePageRef.current === "mistakes") {
      setMistakesRightPanelMode("diagnosis");
    }
  };

  const shouldCleanupTopicSession = (session?: AgentSession | null) => {
    if (!session || session.mode !== "concept" || session.status === "confirmed" || session.isGenerating || generatingSessionIdsRef.current.has(session.id) || session.hasUnreadCompletion) return false;
    const hasFocus = Boolean(session.focusConceptId || session.focusConceptName);
    if (hasFocus) return false;
    const messagesForSession = sessionMessages[session.id] ?? [];
    const hasUserMessage = messagesForSession.some((message) => message.role === "student");
    if (!hasUserMessage) return true;
    return Boolean(session.hasBeenViewedAfterCompletion && (session.needsTitleResolution || session.status === "unresolved"));
  };

  const cleanupDraftSession = (sessionId: string) => {
    const session = agentSessions.find((item) => item.id === sessionId);
    const space = learningSpaces.find((item) => item.id === session?.spaceId);
    if (session && isOverviewSessionForSpace(session, space)) return false;
    if (!shouldCleanupTopicSession(session)) return false;
    removeSessionWithAnimation(sessionId, "auto");
    return true;
  };

  const deleteSessionData = (sessionId: string) => {
    const session = agentSessions.find((item) => item.id === sessionId);
    setAgentSessions((current) => current.filter((item) => item.id !== sessionId));
    setSessionMessages((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setSessionTrace((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setSessionInputs((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    if (activeSessionIdRef.current === sessionId) {
      const fallback =
        agentSessions.find((item) => item.spaceId === session?.spaceId && isOverviewSessionForSpace(item, learningSpaces.find((space) => space.id === item.spaceId)) && item.id !== sessionId) ??
        agentSessions.find((item) => item.spaceId === session?.spaceId && item.id !== sessionId);
      if (fallback) {
        activeSessionIdRef.current = fallback.id;
        setActiveSessionId(fallback.id);
      }
    }
  };

  const removeSessionWithAnimation = (sessionId: string, _reason: "manual" | "auto") => {
    const session = agentSessions.find((item) => item.id === sessionId);
    const space = learningSpaces.find((item) => item.id === session?.spaceId);
    if (!session || isOverviewSessionForSpace(session, space)) return false;
    setDeletingSessionIds((current) => (current.includes(sessionId) ? current : [...current, sessionId]));
    window.setTimeout(() => {
      deleteSessionData(sessionId);
      setDeletingSessionIds((current) => current.filter((id) => id !== sessionId));
    }, 240);
    return true;
  };

  const switchSession = (nextSessionId: string) => {
    if (activeSessionId && activeSessionId !== nextSessionId) cleanupDraftSession(activeSessionId);
    activeSessionIdRef.current = nextSessionId;
    setActiveSessionId(nextSessionId);
    setCrossPageNotice((current) => ({ ...current, spacesUnread: false }));
    setAgentSessions((current) =>
      current.map((session) =>
        session.id === nextSessionId
          ? {
              ...session,
              hasUnreadCompletion: false,
              hasBeenViewedAfterCompletion: session.hasBeenViewedAfterCompletion || Boolean(session.needsTitleResolution || session.status === "unresolved"),
              updatedAt: now()
            }
          : session
      )
    );
  };

  const selectLearningSpace = (spaceId: string) => {
    const space = learningSpaces.find((item) => item.id === spaceId);
    const overview =
      agentSessions.find((session) => session.spaceId === spaceId && isOverviewSessionForSpace(session, space)) ??
      agentSessions.find((session) => session.spaceId === spaceId);
    setActiveLearningSpaceId(spaceId);
    if (overview) switchSession(overview.id);
  };

  const createSessionInSpace = (spaceId = activeLearningSpace?.id ?? "space_dl", focusConceptId?: string) => {
    if (activeSessionId) cleanupDraftSession(activeSessionId);
    const title = focusConceptId ? getTopicSessionTitle(focusConceptId) : "新专题会话";
    const id = `session_${Date.now()}`;
    const session: AgentSession = {
      id,
      studentId: "demo_student",
      spaceId,
      focusConceptId,
      focusConceptName: focusConceptId,
      title: focusConceptId ? title : "New Topic Session",
      mode: "concept",
      status: focusConceptId ? "confirmed" : "draft",
      isGenerating: false,
      hasUnreadCompletion: false,
      hasBeenViewedAfterCompletion: false,
      needsTitleResolution: false,
      createdAt: now(),
      updatedAt: now()
    };
    setAgentSessions((current) => [session, ...current]);
    setActiveLearningSpaceId(spaceId);
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
    navigatePage("learningSpace");
    return session;
  };

  const openConceptSession = (conceptName: string) => {
    const normalized = normalizeConceptName(conceptName);
    const existing = agentSessions.find((session) => session.spaceId === activeLearningSpace?.id && normalizeConceptName(session.focusConceptId ?? "") === normalized);
    if (existing) {
      switchSession(existing.id);
      navigatePage("learningSpace");
      return;
    }
    createSessionInSpace(activeLearningSpace?.id, conceptName);
  };

  const difficultyLabel = (difficulty: QuizDifficulty) => {
    if (difficulty === "basic") return "基础";
    if (difficulty === "medium") return "中等";
    return "提高";
  };

  const resolveQuizDifficulty = (
    selectedDifficulty: QuizDifficultySelection,
    conceptNames: string[]
  ): { effectiveDifficulty: QuizDifficulty; reason: string } => {
    if (selectedDifficulty !== "all") {
      return { effectiveDifficulty: selectedDifficulty, reason: "" };
    }

    const masteryByName = new Map(mastery.map((record) => [normalizeConceptName(record.conceptName), record.score]));
    const candidateNames =
      conceptNames.length > 0
        ? conceptNames
        : concepts
            .filter((concept) => quizCategory === "全部" || concept.category === quizCategory)
            .map((concept) => concept.name);

    if (candidateNames.length === 0) {
      return { effectiveDifficulty: "basic", reason: "已根据掌握度自动选择难度：基础。当前没有可用掌握度数据，默认从基础题开始。" };
    }

    const scores = candidateNames.map((name) => ({
      name,
      score: masteryByName.get(normalizeConceptName(name)) ?? 0.15
    }));
    const lowest = scores.reduce((min, item) => (item.score < min.score ? item : min), scores[0]);
    const effectiveDifficulty = difficultyFromMastery(lowest.score);
    const scopeReason =
      conceptNames.length > 0
        ? `${conceptNames.length > 1 ? "多个知识点以最低掌握度为准：" : "所选知识点掌握度："}${lowest.name} ${lowest.score.toFixed(2)}`
        : `未指定知识点，按当前范围最低掌握度决定：${lowest.name} ${lowest.score.toFixed(2)}`;

    return {
      effectiveDifficulty,
      reason: `已根据掌握度自动选择难度：${difficultyLabel(effectiveDifficulty)}。${scopeReason}`
    };
  };

  const getConceptCategory = (conceptName: string) => {
    const canonical = canonicalizeConceptName(conceptName, [...concepts, ...pendingCandidates]);
    return (
      concepts.find((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) === canonical.normalizedKey)?.category ||
      cards.find((card) => (card.normalizedKey || normalizeConceptName(card.name)) === canonical.normalizedKey)?.category ||
      "待分类"
    );
  };

  const findAnyCard = (conceptName: string) => {
    const normalized = canonicalizeConceptName(conceptName, [...concepts, ...pendingCandidates]).normalizedKey;
    return (
      cards.find((card) => (card.normalizedKey || normalizeConceptName(card.name)) === normalized) ??
      temporaryCards.find((card) => (card.normalizedKey || normalizeConceptName(card.name)) === normalized) ??
      null
    );
  };

  const upsertTemporaryCard = (card: KnowledgeCard) => {
    setTemporaryCards((current) => upsertCards(current, [{ ...card, status: "temporary" }]));
  };

  const ensureKnowledgeCard = async (
    conceptName: string,
    options: {
      category?: string;
      source?: "chat" | "quiz" | "quiz_explanation" | "related_concept" | "prerequisite" | "manual";
      sourceText?: string;
      userQuestion?: string;
      currentAnswerMarkdown?: string;
      currentQuizQuestion?: QuizQuestion;
      force?: boolean;
      relatedConcept?: string;
    } = {}
  ) => {
    const canonical = canonicalizeConceptName(conceptName, [...concepts, ...pendingCandidates]);
    const officialConcept = concepts.find((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) === canonical.normalizedKey);
    const cardName = officialConcept?.canonicalName || officialConcept?.name || canonical.canonicalName;
    const existing = findAnyCard(cardName);
    if (
      existing &&
      !options.force &&
      existing.generatedBy === "llm" &&
      existing.summary?.trim() &&
      existing.intuition?.trim() &&
      existing.example?.trim() &&
      existing.commonMistakes?.length
    ) {
      return existing;
    }
    if (existing && !options.force && !isKnowledgeCardIncomplete(existing)) return existing;
    const card = await generateKnowledgeCardForConcept({
      conceptName: cardName,
      category: options.category || existing?.category || getConceptCategory(cardName),
      courseName: parsedDocument.fileName || "机器学习基础",
      source: options.source || "manual",
      sourceText: options.sourceText,
      userQuestion: options.userQuestion,
      currentAnswerMarkdown: options.currentAnswerMarkdown,
      currentQuizQuestion: options.currentQuizQuestion,
      knownConcepts: concepts,
      masteryScore: mastery.find((record) => normalizeConceptName(record.conceptName) === normalizeConceptName(cardName))?.score,
      llmConfig: config
    });
    const normalizedCard = {
      ...card,
      name: cardName,
      canonicalName: cardName,
      aliases: canonical.aliases,
      normalizedKey: canonical.normalizedKey
    };
    const withRelated =
      options.relatedConcept && !normalizedCard.relatedConcepts.includes(options.relatedConcept)
        ? { ...normalizedCard, relatedConcepts: [...normalizedCard.relatedConcepts, options.relatedConcept] }
        : normalizedCard;
    const isOfficial = cards.some((item) => (item.normalizedKey || normalizeConceptName(item.name)) === canonical.normalizedKey);
    if (isOfficial) {
      setCards((current) => upsertCards(current, [{ ...withRelated, status: "confirmed" }]));
    } else {
      upsertTemporaryCard(withRelated);
    }
    return withRelated;
  };

  const ensureTemporaryCardsForCandidates = async (
    candidates: CandidateConcept[],
    options: {
      source?: "chat" | "quiz" | "quiz_explanation" | "related_concept" | "prerequisite" | "manual";
      sourceText?: string;
      userQuestion?: string;
      currentAnswerMarkdown?: string;
      currentQuizQuestion?: QuizQuestion;
      limit?: number;
    } = {}
  ) => {
    const confirmedKeys = new Set(concepts.map((concept) => concept.normalizedKey || normalizeConceptName(concept.name)));
    const cardKeys = new Set([...cards, ...temporaryCards].map((card) => card.normalizedKey || normalizeConceptName(card.name)));
    const targets = candidates
      .filter((candidate) => !confirmedKeys.has(candidate.normalizedKey) && !cardKeys.has(candidate.normalizedKey))
      .sort((a, b) => (b.educationalValue ?? 0) - (a.educationalValue ?? 0))
      .slice(0, options.limit ?? 4);
    if (targets.length === 0) return;
    await Promise.allSettled(
      targets.map((candidate) =>
        ensureKnowledgeCard(candidate.canonicalName, {
          category: candidate.suggestedCategory,
          source: options.source || (candidate.source === "document" ? "manual" : candidate.source),
          sourceText: options.sourceText || candidate.reason,
          userQuestion: options.userQuestion,
          currentAnswerMarkdown: options.currentAnswerMarkdown,
          currentQuizQuestion: options.currentQuizQuestion
        })
      )
    );
  };

  const openCardWithGeneratedFallback = async (
    conceptName: string,
    options: Parameters<typeof ensureKnowledgeCard>[1] = {}
  ) => {
    const canonical = canonicalizeConceptName(conceptName, [...concepts, ...pendingCandidates]);
    const cardName = canonical.canonicalName;
    const existingOfficial = cards.some((card) => (card.normalizedKey || normalizeConceptName(card.name)) === canonical.normalizedKey);
    if (!existingOfficial) {
      showToast(`正在生成「${conceptName}」知识卡片...`);
      await ensureKnowledgeCard(cardName, options);
    }
    setActiveCard(cardName);
    setSecondaryCard(null);
  };

  const openSecondaryCardWithGeneratedFallback = async (
    conceptName: string,
    sourceCard?: KnowledgeCard | null,
    sourceType: "related_concept" | "prerequisite" | "quiz_explanation" = "related_concept"
  ) => {
    const canonical = canonicalizeConceptName(conceptName, [...concepts, ...pendingCandidates]);
    const cardName = canonical.canonicalName;
    const existingOfficial = cards.some((card) => (card.normalizedKey || normalizeConceptName(card.name)) === canonical.normalizedKey);
    if (!existingOfficial) {
      showToast(`正在生成「${conceptName}」知识卡片...`);
      await ensureKnowledgeCard(cardName, {
        category: sourceCard?.category,
        source: sourceType,
        sourceText: sourceCard ? `来自「${sourceCard.name}」卡片的关联概念：${sourceCard.summary}` : undefined,
        relatedConcept: sourceCard?.name
      });
    }
    setSecondaryCard(cardName);
  };

  const buildMistakeItemFromQuestion = (
    question: QuizQuestion,
    userAnswer: QuizAnswer | undefined,
    source: "diagnosis" | "review" | "practice" = "diagnosis"
  ): MistakeItem => {
    const id = mistakeKeyForQuestion(question);
    const conceptNames = question.conceptNames?.length ? question.conceptNames : ["待分类"];
    return {
      id,
      questionId: id,
      question: { ...question, id: question.id || id, conceptNames },
      conceptNames,
      difficulty: question.difficulty ?? "medium",
      category: getConceptCategory(conceptNames[0] ?? "待分类") || "待分类",
      wrongCount: 1,
      lastUserAnswer: userAnswer,
      status: "active",
      source,
      createdAt: now(),
      updatedAt: now()
    };
  };

  const upsertMistake = (current: MistakeItem[], next: MistakeItem): MistakeItem[] => {
    const existingIndex = current.findIndex((item) => item.id === next.id || item.questionId === next.questionId);
    if (existingIndex < 0) return [next, ...current];
    return current.map((item, index) =>
      index === existingIndex
        ? {
            ...item,
            question: next.question,
            conceptNames: next.conceptNames,
            difficulty: next.difficulty,
            category: next.category,
            lastUserAnswer: next.lastUserAnswer,
            status: "active" as const,
            source: next.source,
            wrongCount: Math.max(item.wrongCount || 1, next.wrongCount),
            updatedAt: now()
          }
        : item
    );
  };

  const isQuestionInMistakeBook = (question: QuizQuestion) => mistakes.some((item) => item.status === "active" && isSameMistakeQuestion(item, question));

  const addMistake = (question: QuizQuestion, source: "diagnosis" | "review" | "practice" = "diagnosis", silent = false) => {
    const selected = selectedAnswers[question.id];
    const item = buildMistakeItemFromQuestion(question, selected, source);
    const existed = isQuestionInMistakeBook(question);
    mistakeIdsRef.current.add(item.id);
    mistakeIdsRef.current.add(item.questionId);
    setMistakes((current) => {
      const next = upsertMistake(current, item);
      writeLocal("mistakeBook", next);
      return next;
    });
    if (!silent) showToast(existed ? "错题已更新" : "已收入错题本");
    return !existed;
  };

  const isConceptRelevantToActiveSpace = (conceptName: string, conceptCategory?: string) => {
    if (!activeLearningSpace) return true;
    const canonical = canonicalizeConceptName(conceptName, [...concepts, ...pendingCandidates]);
    const relationMatch = spaceConcepts.some(
      (item) =>
        item.spaceId === activeLearningSpace.id &&
        (normalizeConceptName(item.conceptId) === canonical.normalizedKey || normalizeConceptName(item.conceptId) === normalizeConceptName(canonical.canonicalName))
    );
    if (relationMatch) return true;
    const haystack = [canonical.canonicalName, ...canonical.aliases, conceptCategory ?? ""].join(" ").toLowerCase();
    const keywordsBySpace: Record<string, string[]> = {
      space_dl: ["cnn", "rnn", "lstm", "transformer", "attention", "backprop", "resnet", "gan", "gradient", "loss", "卷积", "池化", "反向传播", "注意力"],
      space_rl: ["mdp", "q-learning", "ppo", "dqn", "bellman", "actor-critic", "reward", "policy", "强化学习", "奖励", "策略", "价值函数"],
      space_cv: ["cnn", "resnet", "vit", "yolo", "image", "vision", "卷积", "图像", "目标检测", "语义分割", "视觉"],
      space_math: ["limit", "derivative", "integral", "matrix", "probability", "gradient", "极限", "导数", "微分", "积分", "级数", "偏导数", "梯度", "链式法则", "矩阵"],
      space_ml: ["svm", "pca", "loss", "gradient", "regularization", "overfitting", "梯度下降", "损失函数", "过拟合", "正则化"],
      space_nlp: ["transformer", "bert", "gpt", "attention", "token", "embedding", "语言", "注意力", "词向量"]
    };
    return (keywordsBySpace[activeLearningSpace.id] ?? []).some((keyword) => haystack.includes(keyword.toLowerCase()));
  };

  const collectWrongMistakes = () => {
    if (!quizSubmitted) return;
    let count = 0;
    quizQuestions.forEach((question) => {
      if (!checkQuizAnswer(question, selectedAnswers[question.id])) {
        if (addMistake(question, quizSource === "review_task" ? "review" : "diagnosis")) count += 1;
      }
    });
    showToast(count > 0 ? `已收集 ${count} 道错题` : "没有新的错题可收集");
  };

  const applyMasteryEvent = (event: MasteryEvent) => {
    if (appliedEventRef.current.has(event.id)) return false;
    appliedEventRef.current.add(event.id);
    setAppliedMasteryEventIds(Array.from(appliedEventRef.current));
    if (event.delta !== 0) {
      setMastery((current) => updateConceptMastery(current, event.conceptName, event.delta, event.reason));
    } else {
      setMastery((current) => upsertMastery(current, event.conceptName, 0.15, event.reason));
    }
    return true;
  };

  const isInReview = (conceptName: string) => {
    const normalized = canonicalizeConceptName(conceptName, [...concepts, ...pendingCandidates]).normalizedKey;
    const dueDate = today();
    return reviewTasks.some(
      (task) => task.status === "pending" && ((normalizeConceptName(task.conceptName) === normalized && task.dueDate === dueDate) || `${normalized}:${dueDate}` === task.id)
    );
  };

  const createReviewTask = (
    conceptName: string,
    source: ReviewTask["source"],
    options: { navigate?: boolean; toast?: boolean; reason?: string } = {}
  ) => {
    const shouldToast = options.toast ?? true;
    const canonical = canonicalizeConceptName(conceptName, [...concepts, ...pendingCandidates]);
    const confirmed = concepts.some((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) === canonical.normalizedKey);
    if (!confirmed) {
      addPendingCandidate({ name: conceptName, reason: "加入复习前需要先确认入库", source: "chat" }, "chat");
      if (shouldToast) showToast("请先确认加入知识库，再加入复习任务");
      return false;
    }
    const canonicalName = canonical.canonicalName;
    const dueDate = today();
    const key = `${canonical.normalizedKey}:${dueDate}`;
    const alreadyPending = reviewTasks.some(
      (task) => task.status === "pending" && (task.id === key || normalizeConceptName(task.conceptName) === canonical.normalizedKey)
    );
    if (reviewTaskIdsRef.current.has(key) || alreadyPending) {
      if (shouldToast) showToast("已在复习任务中");
      if (options.navigate) setActiveWorkspaceTab("review");
      return false;
    }
    reviewTaskIdsRef.current.add(key);
    const category = cards.find((card) => (card.normalizedKey || normalizeConceptName(card.name)) === canonical.normalizedKey)?.category || concepts.find((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) === canonical.normalizedKey)?.category;
    const task: ReviewTask = {
      id: key,
      conceptName: canonicalName,
      title: `${canonicalName} 知识复习`,
      reason: options.reason ?? "学习 Agent 安排复习",
      category,
      dueDate,
      source,
      status: "pending",
      createdAt: now(),
      masteryApplied: false
    };
    setReviewTasks((current) => (current.some((item) => item.id === key) ? current : [task, ...current]));
    appendTraceSteps([
      { title: "Concept Selector", type: "review", status: "success", detail: `Selected concept: ${canonicalName}` },
      { title: "Review Scheduler", type: "review", status: "success", detail: `Created review task for ${canonicalName}` },
      { title: "State Tracker", type: "state", status: "success", detail: "reviewTasks updated" }
    ]);
    if (options.navigate) setActiveWorkspaceTab("review");
    if (shouldToast) showToast(`已加入今日复习：${canonicalName}`);
    return true;
  };

  const addReviewTask = (conceptName: string, source: "knowledge_card" | "chat_suggestion" | "quiz") => {
    createReviewTask(conceptName, source, { navigate: true, toast: true, reason: source === "quiz" ? "检测答错后自动安排复习" : "用户手动加入今日复习" });
  };

  const startReviewTaskCheck = async (taskId: string) => {
    const task = reviewTasks.find((item) => item.id === taskId);
    if (!task || task.status === "done") return;
    setActiveWorkspaceTab("quiz");
    setQuizSource("review_task");
    setActiveReviewTaskId(taskId);
    appendTraceSteps([
      { title: "ReviewTask Reader", type: "review", status: "success", detail: `Loaded review task: ${task.conceptName}` },
      { title: "Target Concept", type: "quiz", status: "success", detail: task.conceptName },
      { title: "Task Router", type: "router", status: "success", detail: "Switched to Quiz tab" }
    ]);
    await startKnowledgeCheck(task.conceptName, "review_task");
  };


  const conceptSnapshotFromCandidate = (candidate: CandidateConcept): KnowledgeConcept => ({
    id: candidate.id,
    name: candidate.canonicalName,
    canonicalName: candidate.canonicalName,
    aliases: candidate.aliases,
    normalizedKey: candidate.normalizedKey,
    category: ensureFinalKnowledgeCategory(candidate.suggestedCategory || classifyConceptFallback(candidate.canonicalName, candidate.aliases), classifyConceptFinalFallback(candidate.canonicalName, candidate.aliases)),
    status: "candidate",
    confidence: candidate.extractionConfidence,
    reason: candidate.reason || candidate.summary,
    cardId: candidate.normalizedKey,
    createdAt: candidate.createdAt || now()
  });

  const mergeDocumentConceptSnapshots = (current: KnowledgeConcept[], candidates: CandidateConcept[]) => {
    const byKey = new Map(current.map((concept) => [concept.normalizedKey || normalizeConceptName(concept.canonicalName || concept.name), concept]));
    candidates.forEach((candidate) => {
      byKey.set(candidate.normalizedKey, conceptSnapshotFromCandidate(candidate));
    });
    return Array.from(byKey.values());
  };

  const handleParsed = async (parsed: ParsedDocument, reportProgress?: (state: UploadState) => void) => {
    reportProgress?.({ progress: 60, status: "parsing", message: "Calling LLM to extract knowledge points..." });
    try {
      const extraction = await extractDocumentConceptsWithLLM({
        config,
        documentText: parsed.text,
        chunks: parsed.chunks,
        knownConcepts: concepts,
        pendingCandidates,
        fileName: parsed.fileName,
        existingCategories: Array.from(new Set([...concepts.map((concept) => concept.category), ...cards.map((card) => card.category)])),
        onProgress: (state) => reportProgress?.({ progress: state.progress, status: "parsing", message: state.message })
      });

      const finalizedCandidates = extraction.candidates.map((candidate) => ({
        ...candidate,
        suggestedCategory: ensureFinalKnowledgeCategory(
          candidate.suggestedCategory,
          classifyConceptFinalFallback(candidate.canonicalName, candidate.aliases)
        )
      }));

      reportProgress?.({ progress: 94, status: "parsing", message: "Generating temporary knowledge cards..." });
      await ensureTemporaryCardsForCandidates(finalizedCandidates, {
        source: "manual",
        sourceText: parsed.text.slice(0, 1800),
        limit: Math.max(4, finalizedCandidates.length)
      });

      const finalDocument: ParsedDocument = {
        ...parsed,
        status: extraction.usedLLM ? "ready" : "partial",
        concepts: mergeDocumentConceptSnapshots([], finalizedCandidates),
        updatedAt: now()
      };

      setParsedDocument(finalDocument);
      if (finalizedCandidates.length > 0) {
        setPendingCandidates((current) => finalizedCandidates.reduce((next, candidate) => upsertCandidateConcept(next, candidate, concepts), current));
      }
      setTrace([
        ...normalizeTraceSteps(extraction.trace ?? []),
        {
          id: `upload_${Date.now()}`,
          title: "Document parsing completed",
          type: "document_parse",
          status: "success",
          detail: `${parsed.fileName}: generated ${parsed.chunks.length} chunk(s), extracted ${finalizedCandidates.length} candidate concept(s). ${extraction.usedLLM ? "Used LLM." : `Used local fallback: ${extraction.fallbackReason ?? "model unavailable"}`}`
        }
      ]);
      reportProgress?.({
        progress: 100,
        status: extraction.usedLLM ? "ready" : "partial",
        message: extraction.usedLLM
          ? `Parsing completed: generated ${parsed.chunks.length} chunk(s), extracted ${finalizedCandidates.length} knowledge point(s).`
          : `Model unavailable; strict local fallback generated ${parsed.chunks.length} chunk(s), extracted ${finalizedCandidates.length} knowledge point(s).`
      });
    } catch (error) {
      reportProgress?.({ progress: 100, status: "failed", message: error instanceof Error ? error.message : "Document parsing failed" });
      throw error;
    }
  };

  const handleSend = async () => {
    const question = input.trim();
    if (!question || loading) return;
    const studentId = `student_${Date.now()}`;
    const agentId = `agent_${Date.now()}`;
    setLoading(true);
    setInput("");
    setMessages((current) => [...current, { id: studentId, role: "student", text: question }]);
    try {
      const retrievalResults = retrieveRelevantChunks(question, parsedDocument.chunks ?? [], {
        topK: 3,
        maxTotalChars: 4000,
        conceptNames: concepts.map((concept) => concept.name)
      });
      setLastRetrievalResults(retrievalResults);
      const result = await callLLMAgent(config, question, parsedDocument.chunks, concepts, mastery, retrievalResults);
      setTrace(normalizeTraceSteps(result.trace));
      const confirmedKeys = new Set(concepts.map((concept) => concept.normalizedKey || normalizeConceptName(concept.name)));
      const officialCards = result.cards.filter((card) => confirmedKeys.has(card.normalizedKey || normalizeConceptName(card.name)));
      const temporaryResultCards = result.cards.filter((card) => !confirmedKeys.has(card.normalizedKey || normalizeConceptName(card.name)));
      if (officialCards.length > 0) setCards((current) => upsertCards(current, officialCards.map((card) => ({ ...card, status: "confirmed" }))));
      if (temporaryResultCards.length > 0) setTemporaryCards((current) => upsertCards(current, temporaryResultCards.map((card) => ({ ...card, status: "temporary" }))));
      setMessages((current) => [...current, { id: agentId, role: "agent", answer: result.answer }]);
      if (result.answer.mode === "llm") {
        setModelStatus("ready");
        setLastModelError("");
      } else if (config.apiKey.trim()) {
        setModelStatus("error");
        setLastModelError(result.trace.find((step) => step.title.includes("API Error"))?.detail ?? "Real API failed, using mock fallback.");
      } else {
        setModelStatus(config.useMockFallback ? "mock" : "missing-key");
      }
      void addAgentExtractedCandidates(question, result.answer.answerMarkdown, result.answer).catch((error) => {
        if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) console.debug("[chat-candidate-classification]", error);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Model call failed";
      setModelStatus("error");
      setLastModelError(message);
      setMessages((current) => [
        ...current,
          { id: `agent_error_${Date.now()}`, role: "agent", error: error instanceof Error ? error.message : "模型调用失败" }
      ]);
    } finally {
      if (activePageRef.current !== "workbench") {
        setCrossPageNotice((current) => ({ ...current, workbenchUnread: true }));
      }
      setLoading(false);
    }
  };

  const handleExpertSend = async () => {
    if (!activeSession || sessionLoading) return;
    const question = expertInput.trim();
    if (!question) return;
    const studentId = `student_${Date.now()}`;
    const agentId = `agent_${Date.now()}`;
    const sessionId = activeSession.id;
    generatingSessionIdsRef.current.add(sessionId);
    setSessionLoading(true);
    setSessionInputs((current) => ({ ...current, [sessionId]: "" }));
    setSessionMessages((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), { id: studentId, role: "student", text: question }]
    }));
    setAgentSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              isGenerating: true,
              hasUnreadCompletion: false,
              hasBeenViewedAfterCompletion: false,
              updatedAt: now()
            }
          : session
      )
    );
    try {
      const focusConcept = activeSession.focusConceptName ?? activeSession.focusConceptId ?? "";
      const recentContext = buildRecentSessionContext(sessionMessages[sessionId] ?? []);
      const masterySummary = scopedMastery
        .slice(0, 12)
        .map((item) => `${item.conceptName}: ${item.score.toFixed(2)}`)
        .join("；");
      const spacePrompt = [
        "你是知阶 Agent 中的学习空间专属导师。",
        `当前学习空间：${activeLearningSpace?.name ?? "学习空间"}`,
        `学习空间说明：${activeLearningSpace?.description ?? "围绕当前方向组织学习"}`,
        `当前会话：${activeSession.title}`,
        `当前会话类型：${activeSession.mode === "space" ? "总览 Agent" : "专题 Agent"}`,
        `当前专题知识点：${focusConcept || "尚未确定"}`,
        activeSession.mode === "space"
          ? `你负责帮助学生建立 ${activeLearningSpace?.name ?? "当前方向"} 的整体理解、学习路径和知识联系。`
          : `你负责围绕当前专题知识点 ${focusConcept || "待识别专题"} 进行深入辅导。`,
        "你可以使用学生的全局掌握画像，但不要把其他方向的内容当作当前空间的主线。",
        `当前方向学生画像摘要：${masterySummary || "暂无画像记录"}`,
        recentContext
          ? `以下是本会话的近期对话上下文，请保持连续性，不要重复已经解释过的内容，也不要混入其他会话的聊天记录：\n${recentContext}`
          : "本会话暂无历史上下文。",
        `学生问题：${question}`
      ].join("\n");
      const result = await callLLMAgent(config, spacePrompt, parsedDocument.chunks, scopedConcepts, mastery);
      setSessionTrace((current) => ({ ...current, [sessionId]: normalizeTraceSteps(result.trace) }));
      setSessionMessages((current) => ({
        ...current,
        [sessionId]: [...(current[sessionId] ?? []), { id: agentId, role: "agent", answer: result.answer }]
      }));
      if (result.answer.mode === "llm") {
        setModelStatus("ready");
        setLastModelError("");
      } else if (config.apiKey.trim()) {
        setModelStatus("error");
        setLastModelError(result.trace.find((step) => step.title.includes("API Error"))?.detail ?? "Real API failed, using mock fallback.");
      } else {
        setModelStatus(config.useMockFallback ? "mock" : "missing-key");
      }
      const scopedKeys = new Set(concepts.map((concept) => concept.normalizedKey || normalizeConceptName(concept.name)));
      const officialCards = result.cards.filter((card) => scopedKeys.has(card.normalizedKey || normalizeConceptName(card.name)));
      const temporaryResultCards = result.cards.filter((card) => !scopedKeys.has(card.normalizedKey || normalizeConceptName(card.name)));
      if (officialCards.length > 0) setCards((current) => upsertCards(current, officialCards.map((card) => ({ ...card, status: "confirmed" }))));
      if (temporaryResultCards.length > 0) setTemporaryCards((current) => upsertCards(current, temporaryResultCards.map((card) => ({ ...card, status: "temporary" }))));
      const userIsViewingSession = activePageRef.current === "learningSpace" && activeSessionIdRef.current === sessionId;
      let sessionCompletionHandled = false;
      if (activeSession.mode === "concept" && activeSession.status !== "confirmed" && !activeSession.focusConceptId && !activeSession.focusConceptName) {
        const detected = [
          ...result.answer.detectedConcepts.map((concept) => ({ name: concept.name, category: concept.category })),
          ...result.answer.newConceptCandidates.map((concept) => ({ name: concept.name, category: concept.category }))
        ];
        const relevant = detected.find((concept) => isConceptRelevantToActiveSpace(concept.name, concept.category));
        if (relevant) {
          const canonical = canonicalizeConceptName(relevant.name, [...concepts, ...pendingCandidates]);
          setAgentSessions((current) =>
            current.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    title: getTopicSessionTitle(canonical.canonicalName),
                    focusConceptId: canonical.canonicalName,
                    focusConceptName: canonical.canonicalName,
                    status: "confirmed",
                    isGenerating: false,
                    hasUnreadCompletion: !userIsViewingSession,
                    hasBeenViewedAfterCompletion: userIsViewingSession,
                    needsTitleResolution: false,
                    updatedAt: now()
                  }
                : session
            )
          );
          sessionCompletionHandled = true;
        } else {
          setSessionMessages((current) => ({
            ...current,
            [sessionId]: [
              ...(current[sessionId] ?? []),
              {
                id: `agent_space_hint_${Date.now()}`,
                role: "agent",
                text: `这个问题似乎不属于当前的${activeLearningSpace?.name ?? "学习空间"}方向。你可以切换到更匹配的学习空间，或继续提出与当前方向相关的问题。`
              }
            ]
          }));
          setAgentSessions((current) =>
            current.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    status: "unresolved",
                    isGenerating: false,
                    hasUnreadCompletion: !userIsViewingSession,
                    hasBeenViewedAfterCompletion: userIsViewingSession,
                    needsTitleResolution: true,
                    updatedAt: now()
                  }
                : session
            )
          );
          sessionCompletionHandled = true;
        }
      }
      if (!sessionCompletionHandled) {
        setAgentSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  status:
                    session.mode === "concept" && session.status === "draft" && !session.focusConceptId && !session.focusConceptName
                      ? "unresolved"
                      : session.status,
                  isGenerating: false,
                  hasUnreadCompletion: !userIsViewingSession,
                  hasBeenViewedAfterCompletion: userIsViewingSession || session.hasBeenViewedAfterCompletion,
                  needsTitleResolution:
                    session.needsTitleResolution ||
                    (session.mode === "concept" && session.status === "draft" && !session.focusConceptId && !session.focusConceptName),
                  updatedAt: now()
                }
              : session
          )
        );
      }
      void addAgentExtractedCandidates(question, result.answer.answerMarkdown, result.answer).catch((error) => {
        if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) console.debug("[chat-candidate-classification]", error);
      });
    } catch (error) {
      setSessionMessages((current) => ({
        ...current,
        [sessionId]: [
          ...(current[sessionId] ?? []),
          { id: `agent_error_${Date.now()}`, role: "agent", error: error instanceof Error ? error.message : "模型调用失败" }
        ]
      }));
      const userIsViewingSession = activePageRef.current === "learningSpace" && activeSessionIdRef.current === sessionId;
      setAgentSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                isGenerating: false,
                hasUnreadCompletion: !userIsViewingSession,
                hasBeenViewedAfterCompletion: userIsViewingSession || session.hasBeenViewedAfterCompletion,
                updatedAt: now()
              }
            : session
        )
      );
    } finally {
      if (activePageRef.current !== "learningSpace") {
        setCrossPageNotice((current) => ({ ...current, spacesUnread: true }));
      }
      generatingSessionIdsRef.current.delete(sessionId);
      setSessionLoading(false);
    }
  };

  const handleFeedback = (messageId: string, conceptName: string, value: "understood" | "confused") => {
    const key = `${messageId}:${normalizeConceptName(conceptName)}`;
    if (feedbackRef.current[key]) return;
    feedbackRef.current = { ...feedbackRef.current, [key]: value };
    setFeedbackByMessageConcept(feedbackRef.current);
    const canonical = canonicalizeConceptName(conceptName, [...concepts, ...pendingCandidates]);
    const isConfirmed = concepts.some((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) === canonical.normalizedKey);
    if (!isConfirmed) {
      addPendingCandidate({ name: conceptName, reason: "来自问答反馈的待确认新概念", source: "chat" }, "chat");
      showToast("该概念尚未确认入库，已记录为候选知识点");
      return;
    }
    const score = mastery.find((record) => normalizeConceptName(record.conceptName) === normalizeConceptName(conceptName))?.score ?? 0.15;
    const delta = getChatFeedbackDelta(score, value);
    applyMasteryEvent({
      id: `chat_feedback:${key}`,
      conceptName,
      delta,
      reason: value === "understood" ? (delta === 0 ? "回答反馈：已记录，当前掌握度较高未加分" : `回答反馈：我懂了，掌握分 +${delta.toFixed(3)}`) : "回答反馈：还是不懂，掌握分 -0.04",
      source: "chat_feedback",
      createdAt: now()
    });
    showToast("反馈已记录");
  };

  const addCandidateToCourseKnowledge = async (
    name: string,
    category: string,
    reason: string,
    initialScore = 0.15,
    relatedConcept?: string,
    source: "chat" | "quiz" | "quiz_explanation" | "related_concept" | "prerequisite" | "manual" = "manual"
  ) => {
    const canonical = canonicalizeConceptName(name, [...concepts, ...pendingCandidates]);
    const normalized = canonical.normalizedKey;
    const exists = concepts.some((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) === normalized);
    const pending = pendingCandidates.find((candidate) => candidate.normalizedKey === normalized);
    const sanitizedInputCategory = sanitizeKnowledgeCategory(category);
    const sanitizedPendingCategory = sanitizeKnowledgeCategory(pending?.suggestedCategory);
    let finalCategory =
      !isPendingCategoryLabel(sanitizedInputCategory)
        ? sanitizedInputCategory
        : !isPendingCategoryLabel(sanitizedPendingCategory)
          ? sanitizedPendingCategory
          : classifyConceptFallback(canonical.canonicalName, canonical.aliases);
    if (isPendingCategoryLabel(finalCategory)) {
      const classified = await classifyConceptForKnowledgeBase({
        concept: pending ?? { canonicalName: canonical.canonicalName, aliases: canonical.aliases, reason },
        existingCategories: Array.from(new Set([...concepts.map((concept) => concept.category), ...cards.map((card) => card.category)])),
        knownConcepts: concepts,
        llmConfig: config
      });
      finalCategory = sanitizeKnowledgeCategory(classified.category || classifyConceptFallback(canonical.canonicalName, canonical.aliases));
    }
    const fullCard = await ensureKnowledgeCard(canonical.canonicalName, {
      category: finalCategory,
      source,
      sourceText: reason || pending?.reason,
      relatedConcept,
      force: isKnowledgeCardIncomplete(findAnyCard(canonical.canonicalName))
    });
    const cardCategory = !isPendingCategoryLabel(fullCard.category) ? sanitizeKnowledgeCategory(fullCard.category) : finalCategory;
    if (!exists) {
      conceptNameSetRef.current.add(normalized);
      const concept: KnowledgeConcept = {
        id: conceptIdFromName(canonical.canonicalName),
        name: canonical.canonicalName,
        canonicalName: canonical.canonicalName,
        aliases: canonical.aliases,
        normalizedKey: normalized,
        category: cardCategory,
        status: "existing",
        reason,
        cardId: fullCard.id,
        createdAt: now()
      };
      setConcepts((current) =>
        current.some((item) => (item.normalizedKey || normalizeConceptName(item.name)) === normalized) ? current : [...current, concept]
      );
      setCards((current) =>
        upsertCards(current, [
          {
            ...fullCard,
            name: canonical.canonicalName,
            canonicalName: canonical.canonicalName,
            aliases: canonical.aliases,
            normalizedKey: normalized,
            category: cardCategory,
            status: "confirmed"
          }
        ])
      );
      setMastery((current) => upsertMastery(current, canonical.canonicalName, initialScore, `用户确认加入课程知识库，初始化掌握度 ${initialScore.toFixed(2)}`));
    }
    if (exists) {
      setCards((current) =>
        upsertCards(current, [{ ...fullCard, name: canonical.canonicalName, canonicalName: canonical.canonicalName, aliases: canonical.aliases, normalizedKey: normalized, category: cardCategory, status: "confirmed" }])
      );
    }
    setTemporaryCards((current) => current.filter((card) => (card.normalizedKey || normalizeConceptName(card.name)) !== normalized));
    setPendingCandidates((current) => current.filter((candidate) => candidate.normalizedKey !== normalized));
    setDismissedCandidateNames((current) => (current.includes(normalized) ? current : [...current, normalized]));
    setCandidateMasteryPicker(null);
    showToast(exists ? "该知识点已在课程知识库中，已合并别名和卡片" : "已加入课程知识库");
    return !exists;
  };

  const renderCandidatePanel = (variant: "workspace" | "space" = "workspace") => {
    if (displayedCandidateConcepts.length === 0) return null;
    return (
      <section className={`panel space-candidates ${variant === "workspace" ? "workspace-candidates" : ""}`}>
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">候选知识点</p>
            <h2>本轮对话识别到的新知识点</h2>
            <span>优先展示最近回答抽取出的候选，确认后会进入课程知识库。</span>
          </div>
        </div>
        <div className="candidate-list">
          {visibleCandidateConcepts.map((candidate) => (
            <article key={candidate.id}>
              <strong>{candidate.canonicalName}</strong>
              <span>{ensureFinalKnowledgeCategory(candidate.suggestedCategory, classifyConceptFinalFallback(candidate.canonicalName, candidate.aliases))} · {candidate.source}</span>
              <p>{candidate.summary || candidate.reason || "等待确认后加入课程知识库。"}</p>
              <button className="secondary-button small" onClick={() => openCardWithGeneratedFallback(candidate.canonicalName, { category: candidate.suggestedCategory, source: "chat", sourceText: candidate.reason })}>
                查看卡片
              </button>
              <button
                className="secondary-button small"
                onClick={() => {
                  setCandidateMasteryPicker(candidate.normalizedKey);
                  setCandidateInitialScores((current) => ({ ...current, [candidate.normalizedKey]: current[candidate.normalizedKey] ?? 0.15 }));
                }}
              >
                是，加入知识库
              </button>
              <button className="secondary-button small" onClick={() => dismissCandidate(candidate)}>
                清除
              </button>
              {candidateMasteryPicker === candidate.normalizedKey && (
                <div className="candidate-confirm-panel">
                  <div className="candidate-confirm-title">设置加入知识库后的初始掌握度</div>
                  <div className="mastery-choice-grid">
                    {[
                      { score: 0.15, label: "陌生 / 需要重点复习" },
                      { score: 0.35, label: "听过但不稳定" },
                      { score: 0.55, label: "基本理解，可继续巩固" }
                    ].map((option) => (
                      <button
                        key={option.score}
                        className={candidateInitialScores[candidate.normalizedKey] === option.score ? "active" : ""}
                        onClick={() => setCandidateInitialScores((current) => ({ ...current, [candidate.normalizedKey]: option.score }))}
                      >
                        <span>{option.label}</span>
                        <small>{option.score.toFixed(2)}</small>
                      </button>
                    ))}
                  </div>
                  <div className="candidate-confirm-actions">
                    <button className="secondary-button small" onClick={() => setCandidateMasteryPicker(null)}>取消</button>
                    <button
                      className="primary-button small"
                      onClick={() =>
                        addCandidateToCourseKnowledge(
                          candidate.canonicalName,
                          candidate.suggestedCategory || "待分类",
                          candidate.reason || "",
                          candidateInitialScores[candidate.normalizedKey] ?? 0.15,
                          undefined,
                          (candidate.source === "document" ? "manual" : candidate.source)
                        )
                      }
                    >确认加入</button>
                  </div>
                </div>
              )}
            </article>
          ))}
          {hiddenCandidateConceptCount > 0 && (
            <article className="candidate-list-more">
              <strong>还有 {hiddenCandidateConceptCount} 个候选</strong>
              <p>可在资料与知识库的概念管理 / 知识卡片库中查看完整列表。</p>
            </article>
          )}
        </div>
      </section>
    );
  };

  const handleQuizSubmit = () => {
    if (quizSubmitted || quizSubmitLockedRef.current) return;
    quizSubmitLockedRef.current = true;
    let next = mastery;
    const changes: QuizResultChange[] = [];
    const newScored = new Set(scoredQuestionRef.current);
    let wrongCount = 0;
    let newMistakeCount = 0;
    let newReviewTaskCount = 0;
    quizQuestions.forEach((question) => {
      const scoreKey = `${quizAttemptId}:${question.id}`;
      if (newScored.has(scoreKey)) return;
      newScored.add(scoreKey);
      const correct = checkQuizAnswer(question, selectedAnswers[question.id]);
      const result = applyQuizResult(next, question.conceptNames, question.difficulty, correct);
      next = result.mastery;
      changes.push(...result.changes);
      if (!correct) {
        wrongCount += 1;
        if (addMistake(question, quizSource === "review_task" ? "review" : "diagnosis", true)) newMistakeCount += 1;
        question.conceptNames.forEach((conceptName) => {
          if (createReviewTask(conceptName, "quiz", { toast: false, navigate: false, reason: "检测答错后自动安排复习" })) newReviewTaskCount += 1;
        });
      }
    });
    scoredQuestionRef.current = newScored;
    writeLocal("scoredQuestionKeys", Array.from(newScored));
    setMastery(next);
    setQuizChanges(changes);
    setQuizSubmitted(true);
    const correctCount = quizQuestions.filter((question) => checkQuizAnswer(question, selectedAnswers[question.id])).length;
    const accuracy = quizQuestions.length > 0 ? correctCount / quizQuestions.length : 0;
    if (quizSource === "review_task" && activeReviewTaskId) {
      const passed = quizQuestions.length > 0 && accuracy >= 0.7;
      setReviewTasks((current) =>
        current.map((task) =>
          task.id === activeReviewTaskId
            ? {
                ...task,
                status: passed ? "done" : "pending",
                reason: passed ? "检测通过，复习任务已完成" : "检测未通过，建议再次复习",
                completedAt: passed ? now() : task.completedAt,
                lastCheckPassed: passed,
                lastCheckAt: now()
              }
            : task
        )
      );
      showToast(passed ? "检测完成，掌握度已更新" : "本次检测未通过，已安排复习");
    } else {
      showToast("检测完成，掌握度已更新");
    }
    setQuizSummary(`正确率 ${Math.round(accuracy * 100)}% · mastery 更新 ${changes.length} 项 · 新增错题 ${newMistakeCount} 道 · 新增复习 ${newReviewTaskCount} 项`);
    appendTraceSteps([
      { title: "Evaluator", type: "quiz", status: "success", detail: `Checked ${quizQuestions.length} questions, wrong ${wrongCount}` },
      { title: "Mastery Updater", type: "mastery", status: "success", detail: `Applied ${changes.length} mastery changes` },
      { title: "Mistake Collector", type: "mistake", status: "success", detail: `Added ${newMistakeCount} new mistake(s)` },
      { title: "Review Scheduler", type: "review", status: "success", detail: `Added ${newReviewTaskCount} review task(s)` },
      { title: "Reflector", type: "reflection", status: "success", detail: accuracy >= 0.7 ? "Quiz passed; continue to next weak concept" : "Quiz not passed; review task remains pending" }
    ]);
  };

  const restartQuiz = (questions = builtInQuizBank.slice(0, 3), answers: Record<string, QuizAnswer> = {}) => {
    quizSubmitLockedRef.current = false;
    setQuizAttemptId(`attempt_${Date.now()}`);
    setQuizQuestions(questions);
    setSelectedAnswers(answers);
    setQuizSubmitted(false);
    setQuizChanges([]);
    setQuizWarning("");
    setQuizDifficultyHint("");
    setQuizSummary("");
    setQuizGenerationProgress(null);
  };

  const handleMistakePracticeSubmit = (mistake: MistakeItem, answer: QuizAnswer) => {
    const correct = checkQuizAnswer(mistake.question, answer);
    const eventId = `mistake_practice:${mistake.id}:${Date.now()}`;
    let next = mastery;
    const result = applyQuizResult(next, mistake.conceptNames, mistake.difficulty, correct);
    next = result.mastery;
    setMastery(next);
    appliedEventRef.current.add(eventId);
    setAppliedMasteryEventIds(Array.from(appliedEventRef.current));
    setMistakes((current) =>
      current.map((item) =>
        item.id === mistake.id
          ? {
              ...item,
              wrongCount: correct ? item.wrongCount : item.wrongCount + 1,
              lastUserAnswer: answer,
              updatedAt: now()
            }
          : item
      )
    );
    showToast(correct ? "本次错题练习答对，请选择是否已掌握" : "本次仍答错，错题已保留");
    return correct;
  };

  const resolveMistake = (mistakeId: string, resolution: "understood" | "still_confused") => {
    setMistakes((current) =>
      current.map((item) =>
        item.id === mistakeId
          ? {
              ...item,
              status: resolution === "understood" ? "mastered" : "active",
              updatedAt: now()
            }
          : item
      )
    );
    showToast(resolution === "understood" ? "错题已标记掌握" : "错题已保留，稍后继续练习");
  };

  const handleGenerateQuiz = async (
    overrideConceptNames?: string[],
    overrideDifficulty?: QuizDifficultySelection
  ) => {
    if (selectedQuestionTypes.length === 0) {
      setQuizWarning("请至少选择一种题型后再生成题目。");
      return;
    }
    const requestedConceptNames = Array.isArray(overrideConceptNames) ? overrideConceptNames : selectedConceptNames;
    const requestedDifficulty = overrideDifficulty ?? quizDifficulty;
    const resolvedDifficulty = resolveQuizDifficulty(requestedDifficulty, requestedConceptNames);
    const targetConceptLabel = requestedConceptNames[0] ?? "当前知识范围";
    setQuizGenerating(true);
    setQuizGenerationProgress({ conceptName: targetConceptLabel, activeIndex: 0 });
    setQuizCollapsed(false);
    const requestedConceptSet = new Set(requestedConceptNames.map(normalizeConceptName));
    const scopedConcepts =
      requestedConceptNames.length > 0
        ? concepts.filter((concept) => requestedConceptSet.has(normalizeConceptName(concept.name)))
        : concepts.filter((concept) => quizCategory === "全部" || concept.category === quizCategory);
    try {
      appendTraceSteps([
        { title: "Context Reader", type: "context", status: "success", detail: `Prepared context for ${targetConceptLabel}` },
        { title: "Quiz Generator", type: "quiz", status: "running", detail: config.apiKey.trim() ? "Calling LLM quiz generator" : "No API key; using mock/demo questions" }
      ]);
      setQuizGenerationProgress({ conceptName: targetConceptLabel, activeIndex: 1, sourceLabel: config.apiKey.trim() ? "LLM" : "Mock/Demo" });
      const generated = await generateQuiz(
        config,
        scopedConcepts.length > 0 ? scopedConcepts : concepts,
        parsedDocument.chunks,
        mastery,
        resolvedDifficulty.effectiveDifficulty,
        Boolean(config.apiKey.trim()),
        requestedConceptNames,
        selectedQuestionTypes
      );
      setQuizGenerationProgress({ conceptName: targetConceptLabel, activeIndex: 2, sourceLabel: generated.questions[0]?.source ?? "unknown" });
      restartQuiz(generated.questions);
      const extraConceptCandidates = generated.questions.flatMap((question) =>
        (question.extraConcepts ?? []).map((concept) => ({
          name: concept.name,
          category: concept.category,
          reason: concept.reason || question.explanationMarkdown,
          shouldAddToCourse: true,
          confidence: 0.72,
          contextRole: "key_prerequisite" as const,
          candidateType: "concept" as const,
          educationalValue: 0.72,
          noiseRisk: 0.26,
          granularity: "good" as const
        }))
      );
      if (extraConceptCandidates.length > 0) {
        const extraExtraction = processConceptExtraction({
          sourceType: "quiz_explanation",
          rawText: generated.questions.map((question) => question.questionMarkdown).join("\n"),
          contextText: generated.questions.map((question) => question.explanationMarkdown).join("\n"),
          knownConcepts: concepts,
          pendingCandidates,
          llmCandidates: extraConceptCandidates
        });
        if (extraExtraction.acceptedCandidates.length > 0) {
          setPendingCandidates((current) => extraExtraction.acceptedCandidates.reduce((next, candidate) => upsertCandidateConcept(next, candidate, concepts), current));
          ensureTemporaryCardsForCandidates(extraExtraction.acceptedCandidates, {
            source: "quiz_explanation",
            sourceText: generated.questions.map((question) => question.explanationMarkdown).join("\n\n").slice(0, 1800)
          });
        }
      }
      setQuizGenerationProgress({ conceptName: targetConceptLabel, activeIndex: 3, sourceLabel: generated.questions[0]?.source ?? "unknown" });
      setQuizWarning(generated.warning ?? "");
      setQuizDifficultyHint(resolvedDifficulty.reason);
      appendTraceSteps([
        { title: "Quiz Parser", type: "quiz", status: "success", detail: `Loaded ${generated.questions.length} question(s)` },
        { title: "LLM / Mock Source", type: "quiz", status: "success", detail: generated.warning ? `Fallback/warning: ${generated.warning}` : `Question source: ${generated.questions[0]?.source ?? "unknown"}` },
        { title: "Task Router", type: "router", status: "success", detail: "QuizPanel updated" }
      ]);
      window.setTimeout(() => setQuizGenerationProgress({ conceptName: targetConceptLabel, activeIndex: 4, sourceLabel: generated.questions[0]?.source ?? "unknown" }), 80);
      window.setTimeout(() => setQuizGenerationProgress(null), 900);
    } finally {
      setQuizGenerating(false);
    }
  };

  const startKnowledgeCheck = async (conceptName: string, source: "knowledge_check" | "review_task" = "knowledge_check") => {
    const score = mastery.find((record) => normalizeConceptName(record.conceptName) === normalizeConceptName(conceptName))?.score;
    const difficulty = difficultyFromMastery(score);
    setActiveWorkspaceTab("quiz");
    setActiveCard(null);
    setSecondaryCard(null);
    setQuizSource(source);
    if (source !== "review_task") setActiveReviewTaskId(null);
    setSelectedConceptNames([conceptName]);
    setQuizDifficulty(difficulty);
    setConceptSelectorOpen(true);
    setQuizCollapsed(false);
    setQuizHighlight(true);
    showToast(`正在为「${conceptName}」生成检测题，难度：${difficulty}`);
    window.setTimeout(() => {
      window.document.querySelector(".quiz-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    await handleGenerateQuiz([conceptName], difficulty);
    window.setTimeout(() => setQuizHighlight(false), 1800);
  };

  const openPrimaryCard = (conceptName: string, currentQuizQuestion?: QuizQuestion) => {
    const canonical = canonicalizeConceptName(conceptName, [...concepts, ...pendingCandidates]);
    const exists = concepts.some((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) === canonical.normalizedKey);
    if (currentQuizQuestion && !exists) {
      const extra = currentQuizQuestion.extraConcepts?.find((item) => normalizeConceptName(item.name) === normalizeConceptName(conceptName));
      const pending = addPendingCandidate(
        {
          name: conceptName,
          category: extra?.category,
          reason: extra?.reason || currentQuizQuestion.explanationMarkdown,
          source: "quiz_explanation"
        },
        "quiz_explanation"
      );
      ensureTemporaryCardsForCandidates([pending], {
        source: "quiz_explanation",
        currentQuizQuestion,
        sourceText: currentQuizQuestion.explanationMarkdown
      });
    }
    void openCardWithGeneratedFallback(conceptName, {
      source: currentQuizQuestion ? "quiz_explanation" : "manual",
      currentQuizQuestion
    });
  };

  const handleDifficulty = (difficulty: "all" | "basic" | "medium" | "advanced") => {
    setQuizDifficulty(difficulty);
    const scopedNames = selectedConceptNames.length > 0 ? selectedConceptNames : concepts.filter((concept) => quizCategory === "全部" || concept.category === quizCategory).map((concept) => concept.name);
    restartQuiz(getBuiltInQuiz(scopedNames, difficulty, selectedQuestionTypes));
    setQuizDifficultyHint("");
  };

  const handleCategory = (category: string) => {
    setQuizCategory(category);
    setSelectedConceptNames([]);
    const scopedNames = concepts.filter((concept) => category === "全部" || concept.category === category).map((concept) => concept.name);
    restartQuiz(getBuiltInQuiz(scopedNames, quizDifficulty, selectedQuestionTypes));
    setQuizDifficultyHint("");
  };

  const renderExpertRightPanel = () => {
    if (spaceRightPanelMode === "default") {
      return (
        <>
          <AgentTracePanel trace={expertTrace} />
          <MasteryPanel mastery={scopedMastery} concepts={scopedConcepts} collapsed={false} onOpenCard={(conceptId) => openPrimaryCard(conceptId)} onToggleCollapsed={() => undefined} />
        </>
      );
    }
    if (spaceRightPanelMode === "mistakes") {
      return <MistakeBookPanel mistakes={mistakes} onOpenCard={(conceptId) => openPrimaryCard(conceptId)} onPracticeSubmit={handleMistakePracticeSubmit} onResolveMistake={resolveMistake} />;
    }
    if (spaceRightPanelMode === "review") {
      return <ReviewTaskPanel reviewTasks={reviewTasks} onOpenCard={(conceptId) => openPrimaryCard(conceptId)} onStartReviewCheck={startReviewTaskCheck} />;
    }
    if (spaceRightPanelMode === "diagnosis") {
      return (
        <QuizPanel
          concepts={scopedConcepts}
          questions={quizQuestions}
          selectedAnswers={selectedAnswers}
          submitted={quizSubmitted}
          difficulty={quizDifficulty}
          category={quizCategory}
          selectedConceptNames={selectedConceptNames}
          selectedQuestionTypes={selectedQuestionTypes}
          conceptSelectorOpen={conceptSelectorOpen}
          highlight={quizHighlight}
          generating={quizGenerating}
          changes={quizChanges}
          warning={quizWarning}
          difficultyHint={quizDifficultyHint}
          summary={quizSummary}
          generationProgress={quizGenerationProgress}
          collapsed={false}
          onAnswer={(questionId, answer) => {
            if (!quizSubmitted && !quizSubmitLockedRef.current) setSelectedAnswers((current) => ({ ...current, [questionId]: answer }));
          }}
          onSubmit={handleQuizSubmit}
          mistakeIds={mistakes.flatMap((item) => [item.id, item.questionId])}
          isQuestionInMistakeBook={isQuestionInMistakeBook}
          onAddMistake={(question) => addMistake(question, quizSource === "review_task" ? "review" : "diagnosis")}
          onCollectMistakes={collectWrongMistakes}
          onGenerate={() => {
            setQuizSource("diagnosis");
            setActiveReviewTaskId(null);
            handleGenerateQuiz();
          }}
          onDifficulty={handleDifficulty}
          onCategory={handleCategory}
          onConceptSelectorOpen={setConceptSelectorOpen}
          onSelectedConcepts={setSelectedConceptNames}
          onQuestionTypes={setSelectedQuestionTypes}
          onOpenCard={(conceptId, question) => openPrimaryCard(conceptId, question)}
          onToggleCollapsed={() => undefined}
          onOpenReview={() => handleWorkspaceTabChange("mistakes")}
          onOpenTrace={() => handleWorkspaceTabChange("trace")}
        />
      );
    }
    if (spaceRightPanelMode === "modelConfig") {
      return <ModelSettings config={config} connected={connected} status={modelStatus} lastError={lastModelError} onChange={handleConfigChange} onStatusChange={handleModelStatusChange} />;
    }
    return null;
  };

  const renderWorkbenchQuiz = () => (
    <QuizPanel
      concepts={concepts}
      questions={quizQuestions}
      selectedAnswers={selectedAnswers}
      submitted={quizSubmitted}
      difficulty={quizDifficulty}
      category={quizCategory}
      selectedConceptNames={selectedConceptNames}
      selectedQuestionTypes={selectedQuestionTypes}
      conceptSelectorOpen={conceptSelectorOpen}
      highlight={quizHighlight}
      generating={quizGenerating}
      changes={quizChanges}
      warning={quizWarning}
      difficultyHint={quizDifficultyHint}
      summary={quizSummary}
      generationProgress={quizGenerationProgress}
      collapsed={quizCollapsed}
      onAnswer={(questionId, answer) => {
        if (!quizSubmitted && !quizSubmitLockedRef.current) setSelectedAnswers((current) => ({ ...current, [questionId]: answer }));
      }}
      onSubmit={handleQuizSubmit}
      mistakeIds={mistakes.flatMap((item) => [item.id, item.questionId])}
      isQuestionInMistakeBook={isQuestionInMistakeBook}
      onAddMistake={(question) => addMistake(question, quizSource === "review_task" ? "review" : "diagnosis")}
      onCollectMistakes={collectWrongMistakes}
      onGenerate={() => {
        setQuizSource("diagnosis");
        setActiveReviewTaskId(null);
        handleGenerateQuiz();
      }}
      onDifficulty={handleDifficulty}
      onCategory={handleCategory}
      onConceptSelectorOpen={setConceptSelectorOpen}
      onSelectedConcepts={setSelectedConceptNames}
      onQuestionTypes={setSelectedQuestionTypes}
      onOpenCard={(conceptId, question) => openPrimaryCard(conceptId, question)}
      onToggleCollapsed={() => setQuizCollapsed((value) => !value)}
      onOpenReview={() => handleWorkspaceTabChange("mistakes")}
      onOpenTrace={() => handleWorkspaceTabChange("trace")}
    />
  );

  const renderWorkbenchContent = () => {
    if (activeWorkspaceTab === "dashboard") {
      return <DashboardPage document={parsedDocument} mastery={mastery} reviewTasks={reviewTasks} onNavigate={handleWorkspaceTabChange} />;
    }

    if (activeWorkspaceTab === "materials") {
      return (
        <MaterialsPage
          document={parsedDocument}
          concepts={concepts}
          pendingCandidates={pendingCandidates}
          cards={cards}
          temporaryCards={temporaryCards}
          mastery={mastery}
          lastRetrievalResults={lastRetrievalResults}
          onParsed={handleParsed}
          onNavigate={handleWorkspaceTabChange}
          onOpenCard={(conceptName) => openPrimaryCard(conceptName)}
          onStartKnowledgeCheck={startKnowledgeCheck}
          onAddReview={addReviewTask}
          onConfirmCandidate={confirmCandidateFromMaterials}
          onRejectCandidate={rejectCandidateConcept}
          onRemoveConcept={removeConceptFromMaterials}
          onRemoveCard={removeKnowledgeCardFromMaterials}
          onRestoreDemoDocument={restoreDemoDocument}
        />
      );
    }

    if (activeWorkspaceTab === "assistant") {
      return (
        <div className="workspace-tab-stack assistant-page">
          <section className="panel tab-page-header">
            <div>
              <p className="eyebrow">问 AI Agent</p>
              <h2>聊天问答与学习追问</h2>
              <span>复用原 ChatWindow 与 handleSend，回答会继续影响 Trace、候选知识点、反馈与复习入口。</span>
            </div>
          </section>
          <div className="feature-card-grid compact">
            <FeatureCard title="资料问答" description="围绕当前课程资料提问，支持查看来源、打开知识卡片和加入复习。" status="available" />
            <FeatureCard title="追问薄弱点" description="可让 Agent 解释薄弱知识点，并通过反馈更新掌握度画像。" status="available" />
            <FeatureCard title="课程 DDL 咨询" description="暂未接入真实 DDL 数据，可作为后续 Planner/Scheduler 的自然语言入口。" status="planned" />
          </div>
          <ChatWindow
            messages={messages}
            input={input}
            loading={loading}
            config={config}
            modelStatus={modelStatus}
            lastModelError={lastModelError}
            documentTitle={parsedDocument.fileName}
            chunkCount={parsedDocument.chunks.length}
            lastContextCount={lastRetrievalResults.length}
            usedFallbackContext={lastRetrievalResults.some((result) => result.fallback)}
            onInputChange={setInput}
            onSend={handleSend}
            onOpenCard={(conceptId) => openPrimaryCard(conceptId)}
            feedbackByMessageConcept={feedbackByMessageConcept}
            onFeedback={handleFeedback}
            onAddReview={addReviewTask}
            isInReview={isInReview}
          />
          {renderCandidatePanel("workspace")}
        </div>
      );
    }

    if (activeWorkspaceTab === "plan") {
      return (
        <div className="workspace-tab-stack">
          <section className="panel study-plan-placeholder">
            <div className="panel-header">
              <div>
                <p className="eyebrow">学习计划</p>
                <h2>DDL 驱动计划将在下一轮接入</h2>
                <span>第一轮先把计划入口独立出来，暂时复用今日复习任务作为可展示的任务进度。</span>
              </div>
              <CalendarCheck size={22} />
            </div>
            <div className="plan-placeholder-body">
              <div><strong>{reviewTasks.filter((task) => task.status === "pending").length}</strong><span>待完成复习任务</span></div>
              <div><strong>{reviewTasks.filter((task) => task.status === "done").length}</strong><span>已完成任务</span></div>
              <div><strong>{mastery.filter((item) => item.score < 0.4).length}</strong><span>薄弱知识点</span></div>
            </div>
          </section>
          <div className="feature-card-grid compact">
            <FeatureCard title="DDL 驱动排期" description="根据课程截止日期倒推每日任务，当前还未实现真实 DDL 输入。" status="planned" />
            <FeatureCard title="复习任务追踪" description="复用 ReviewTaskPanel 展示待复习知识点，并可启动复习检测。" status="available" />
            <FeatureCard title="动态重排计划" description="后续可根据完成情况和测验结果重新分配任务优先级。" status="wip" />
          </div>
          <ReviewTaskPanel reviewTasks={reviewTasks} onOpenCard={(conceptId) => openPrimaryCard(conceptId)} onStartReviewCheck={startReviewTaskCheck} />
        </div>
      );
    }

    if (activeWorkspaceTab === "quiz") {
      return (
        <div className="workspace-tab-stack">
          <div className="feature-card-grid compact">
            <FeatureCard title="诊断测验" description="支持按难度、题型和知识点生成或使用内置题库。" status="available" />
            <FeatureCard title="掌握度画像更新" description="提交测验后通过 masteryService 更新知识点掌握度。" status="available" />
            <FeatureCard title="个性化计划联动" description="测验结果已经能进入错题和复习，后续再接入 DDL 计划生成。" status="wip" />
          </div>
          {renderWorkbenchQuiz()}
        </div>
      );
    }

    if (activeWorkspaceTab === "mistakes") {
      return (
        <div className="workspace-tab-stack mistakes-workbench-page">
          <section className="panel tab-page-header">
            <div>
              <p className="eyebrow">错题本</p>
              <h2>Quiz 错题记录与订正回顾</h2>
              <span>这里收集 Quiz 判题后的错题，用于订正、重新练习和加入今日复习。</span>
            </div>
          </section>
          <div className="feature-card-grid compact">
            <FeatureCard title="错题记录" description={`${mistakes.filter((item) => item.status !== "mastered").length} 道待订正错题`} status="available" />
            <FeatureCard title="订正回顾" description="保留题干、我的答案、正确答案和解析，支持重新练习。" status="available" />
            <FeatureCard title="复习联动" description="可从错题加入今日复习，继续进入知识检测闭环。" status="wip" />
          </div>
          <MistakeBookPanel
            mistakes={mistakes}
            onOpenCard={(conceptId) => openPrimaryCard(conceptId)}
            onPracticeSubmit={handleMistakePracticeSubmit}
            onResolveMistake={resolveMistake}
            onAddReview={addReviewTask}
          />
        </div>
      );
    }

    if (activeWorkspaceTab === "review") {
      const pendingReviewCount = reviewTasks.filter((task) => task.status === "pending").length;
      const doneReviewCount = reviewTasks.filter((task) => task.status === "done").length;
      const weakConceptCount = mastery.filter((item) => item.score < 0.4).length;
      return (
        <div className="workspace-tab-stack today-review-page">
          <section className="panel tab-page-header">
            <div>
              <p className="eyebrow">今日复习</p>
              <h2>复习任务与知识检测</h2>
              <span>当前复习任务基于本地状态生成，用于中期演示。</span>
            </div>
          </section>
          <div className="materials-stat-grid">
            <div className="summary-card"><strong>{pendingReviewCount}</strong><span>今日待复习</span></div>
            <div className="summary-card"><strong>{doneReviewCount}</strong><span>已完成</span></div>
            <div className="summary-card"><strong>{weakConceptCount}</strong><span>薄弱知识点</span></div>
          </div>
          <ReviewTaskPanel reviewTasks={reviewTasks} onOpenCard={(conceptId) => openPrimaryCard(conceptId)} onStartReviewCheck={startReviewTaskCheck} />
        </div>
      );
    }

    if (activeWorkspaceTab === "trace") {
      return (
        <div className="workspace-tab-stack">
          <div className="feature-card-grid compact">
            <FeatureCard title="Planner" description="当前 Trace 展示规划步骤，但还不是独立可配置的 Planner 模块。" status="mock" />
            <FeatureCard title="Retriever" description="从资料片段和知识点中组织回答上下文，尚未接入向量库。" status="wip" />
            <FeatureCard title="Evaluator / Reflector" description="通过测验、反馈、复习记录沉淀状态，后续可用于动态调整计划。" status="wip" />
          </div>
          <AgentTracePanel trace={trace} />
        </div>
      );
    }

    if (activeWorkspaceTab === "settings") {
      return (
        <div className="workspace-tab-stack settings-page">
          <ModelSettings config={config} connected={connected} status={modelStatus} lastError={lastModelError} onChange={handleConfigChange} onStatusChange={handleModelStatusChange} />
          <div className="feature-card-grid compact">
            <FeatureCard title="模型配置" description="配置 OpenAI-compatible baseUrl、model、apiKey 和 mock fallback。" status="available" />
            <FeatureCard title="学习空间" description="保留原专题会话页面，适合作为多课程和科研方向入口。" status="wip" actionLabel="进入学习空间" onAction={() => navigatePage("learningSpace")} />
            <FeatureCard title="完整错题页" description="保留旧的完整 MistakesPage，用于更细的错题筛选和练习。" status="available" actionLabel="进入完整错题页" onAction={() => navigatePage("mistakes")} />
          </div>
        </div>
      );
    }

    return (
      <div className="workspace-tab-stack">
        <div className="feature-card-grid compact">
          <FeatureCard title="今日复习任务" description="查看待复习知识点，并可启动复习检测。" status="available" />
          <FeatureCard title="错题本摘要" description="保留 MistakeBookPanel，可查看错题、练习和标记解决。" status="available" />
          <FeatureCard title="完整错题工作台" description="旧 MistakesPage 未迁移，仍可从这里进入。" status="available" actionLabel="打开完整错题页" onAction={() => navigatePage("mistakes")} />
        </div>
        <div className="workspace-tab-grid two">
          <ReviewTaskPanel reviewTasks={reviewTasks} onOpenCard={(conceptId) => openPrimaryCard(conceptId)} onStartReviewCheck={startReviewTaskCheck} />
          <MistakeBookPanel mistakes={mistakes} onOpenCard={(conceptId) => openPrimaryCard(conceptId)} onPracticeSubmit={handleMistakePracticeSubmit} onResolveMistake={resolveMistake} />
        </div>
      </div>
    );
  };

  return (
    <div className="app-shell">
      {toast && <div className="toast">{toast}</div>}
      {appMenuOpen && appMenuRect && (
        <div onMouseEnter={() => openAppMenu(appMenuRect)} onMouseLeave={scheduleAppMenuClose}>
          <AppSwitchMenu activePage={activePage} rect={appMenuRect} onNavigate={navigatePage} onKeepOpen={() => openAppMenu(appMenuRect)} onClose={closeAppMenu} />
        </div>
      )}
      {activePage !== "workbench" && (
      <header className={`app-header ${activePage === "mistakes" ? "mistakes-header" : ""}`}>
        <div className="header-left">
          <div className="brand">
            <div
              className="app-logo-menu-wrap"
              onMouseEnter={(event) => openAppMenu(event.currentTarget.getBoundingClientRect())}
              onMouseLeave={scheduleAppMenuClose}
            >
              <button
                className="brand-icon app-logo-button"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  if (appMenuOpen) closeAppMenu();
                  else openAppMenu(rect);
                }}
                aria-label="切换页面"
              >
                <GraduationCap size={28} />
              </button>
            </div>
            <div>
              <h1>知阶 Agent</h1>
              <p>面向学生的自适应学习与复习助手 · 机器学习基础</p>
            </div>
          </div>
          {activePage !== "mistakes" && (
          <button
            className="page-switch-button"
            onClick={() => navigatePage("workbench")}
          >
            学习工作台
            {crossPageNotice.workbenchUnread && <span className="nav-notice-dot" />}
          </button>
          )}
        </div>
        <div className="header-status">
          <span>{parsedDocument.status === "ready" ? "资料已解析" : "资料部分可用"}</span>
          <span>知识点 {concepts.length} 个</span>
          <span className={connected ? "connection-label ok" : "connection-label"}>{connected ? "模型已配置" : "mock 可用"}</span>
                <div className={`nav-action-button nav-action-split mistake-nav-split-button ${(activePage === "mistakes" || spaceRightPanelMode === "mistakes") ? "active" : ""}`}>
            <button
              className={`mistake-nav-enter ${activePage === "mistakes" ? "exit-mode" : ""}`}
              title={activePage === "mistakes" ? "返回上一学习页面" : "进入错题本页面"}
              onClick={() => navigatePage(activePage === "mistakes" ? lastVisitedMainPage : "mistakes")}
            >
              {activePage === "mistakes" ? <LogOut size={15} /> : <BookOpenCheck size={15} />}
            </button>
            <button
              className="mistake-nav-toggle"
              onClick={() => {
                if (activePage === "mistakes") return;
                toggleSpaceRightPanel("mistakes");
              }}
            >
              错题本
            </button>
          </div>
          <button className={`secondary-button small nav-action-button ${(activePage === "mistakes" ? mistakesRightPanelMode === "review" : spaceRightPanelMode === "review") ? "active" : ""}`} onClick={() => (activePage === "mistakes" ? toggleMistakesRightPanel("review") : toggleSpaceRightPanel("review"))}>
            <CalendarCheck size={14} />
            复习任务
          </button>
          {(activePage === "learningSpace" || activePage === "mistakes") && (
            <button className={`secondary-button small nav-action-button ${(activePage === "mistakes" ? mistakesRightPanelMode === "diagnosis" : spaceRightPanelMode === "diagnosis") ? "active" : ""}`} onClick={() => (activePage === "mistakes" ? toggleMistakesRightPanel("diagnosis") : toggleSpaceRightPanel("diagnosis"))}>
              <Layers3 size={14} />
              诊断测验
            </button>
          )}
          <button className="secondary-button small" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {theme === "dark" ? "浅色模式" : "深色模式"}
          </button>
          <button className={`secondary-button small nav-action-button ${(activePage === "mistakes" ? mistakesRightPanelMode === "modelConfig" : spaceRightPanelMode === "modelConfig") ? "active" : ""}`} onClick={() => (activePage === "mistakes" ? toggleMistakesRightPanel("modelConfig") : toggleSpaceRightPanel("modelConfig"))}>
            <Settings size={14} />
            模型设置
          </button>
          <button className="secondary-button small" onClick={() => restartQuiz(builtInQuizBank.slice(0, 3), demoAnswers)}>
            <RotateCcw size={14} />
            恢复 Demo
          </button>
        </div>
      </header>
      )}

      {activePage === "workbench" ? (
        <AppShell
          header={
            <Header
              courseSummary={`${parsedDocument.fileName} · ${concepts.length} 个知识点`}
              goalSummary="目标：一周内完成反向传播与链式法则复习"
              connected={connected}
              theme={theme}
              onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
              onModelSettings={() => handleWorkspaceTabChange("settings")}
            />
          }
          sidebar={<Sidebar activeTab={activeWorkspaceTab} onTabChange={handleWorkspaceTabChange} />}
          rightPanel={
            <RightSummaryPanel
              mastery={mastery}
              reviewTasks={reviewTasks}
              trace={trace}
              connected={connected}
              onOpenReview={() => handleWorkspaceTabChange("review")}
              onOpenTrace={() => handleWorkspaceTabChange("trace")}
            />
          }
        >
          {renderWorkbenchContent()}
        </AppShell>
      ) : activePage === "mistakes" ? (
      <MistakesPage
        mistakes={mistakes}
        onOpenCard={(conceptId) => openPrimaryCard(conceptId)}
        onPracticeSubmit={handleMistakePracticeSubmit}
        onResolveMistake={resolveMistake}
        onAddReview={addReviewTask}
        isInReview={isInReview}
        onNavigate={navigatePage}
        onToggleRightPanel={toggleMistakesRightPanel}
        rightPanelMode={mistakesRightPanelMode}
        reviewTasks={reviewTasks}
        onStartReviewCheck={startReviewTaskCheck}
        config={config}
        connected={connected}
        onConfigChange={handleConfigChange}
        concepts={concepts}
        questions={quizQuestions}
        selectedAnswers={selectedAnswers}
        submitted={quizSubmitted}
        difficulty={quizDifficulty}
        category={quizCategory}
        selectedConceptNames={selectedConceptNames}
        selectedQuestionTypes={selectedQuestionTypes}
        generating={quizGenerating}
        changes={quizChanges}
        warning={quizWarning}
        difficultyHint={quizDifficultyHint}
        conceptSelectorOpen={conceptSelectorOpen}
        highlight={quizHighlight}
        collapsed={quizCollapsed}
        onAnswer={(questionId, answer) => {
          if (!quizSubmitted && !quizSubmitLockedRef.current) setSelectedAnswers((current) => ({ ...current, [questionId]: answer }));
        }}
        onSubmit={handleQuizSubmit}
        mistakeIds={mistakes.flatMap((item) => [item.id, item.questionId])}
        isQuestionInMistakeBook={isQuestionInMistakeBook}
        onAddMistake={(question) => addMistake(question, quizSource === "review_task" ? "review" : "diagnosis")}
        onCollectMistakes={collectWrongMistakes}
        onGenerate={() => {
          setQuizSource("diagnosis");
          setActiveReviewTaskId(null);
          handleGenerateQuiz();
        }}
        onDifficulty={handleDifficulty}
        onCategory={handleCategory}
        onConceptSelectorOpen={setConceptSelectorOpen}
        onSelectedConcepts={setSelectedConceptNames}
        onQuestionTypes={setSelectedQuestionTypes}
        onOpenCardWithQuestion={(conceptId, question) => openPrimaryCard(conceptId, question)}
        onToggleCollapsed={() => setQuizCollapsed((value) => !value)}
      />
      ) : (
      <main className="learning-space-page">
        <aside className="panel space-sidebar">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">学习空间</p>
              <h2>方向 / 专题会话</h2>
            </div>
            <Layers3 size={20} />
          </div>
          <div className="space-tree">
            {learningSpaces.map((space) => {
              const sessions = agentSessions.filter((session) => session.spaceId === space.id);
              const active = activeLearningSpace?.id === space.id;
              const hasSpaceUnread = sessions.some((session) => session.hasUnreadCompletion);
              return (
                <section className={`space-node ${active ? "active" : ""}`} key={space.id}>
                  <button className="space-button" onClick={() => selectLearningSpace(space.id)}>
                    <span className="space-icon">{space.icon ?? "S"}</span>
                    <span>
                      <strong>{space.name}</strong>
                      <small>{space.description}</small>
                    </span>
                    {hasSpaceUnread && <span className="nav-notice-dot space-dot" />}
                  </button>
                  {active && (
                    <div className="session-list">
                      {sessions.map((session) => {
                        const isDeleting = deletingSessionIds.includes(session.id);
                        const isActiveSession = activeSession?.id === session.id;
                        const sessionSpace = learningSpaces.find((item) => item.id === session.spaceId);
                        const canDeleteSession = !isOverviewSessionForSpace(session, sessionSpace);
                        return (
                          <div className={`space-session-item ${isActiveSession ? "active" : ""} ${isDeleting ? "is-deleting" : ""}`} key={session.id}>
                            <button className={`session-main-button ${isActiveSession ? "active" : ""}`} disabled={isDeleting} onClick={() => !isDeleting && switchSession(session.id)}>
                              <span className="session-title">{session.title}</span>
                              {session.hasUnreadCompletion && <span className="nav-notice-dot session-dot" />}
                            </button>
                            {canDeleteSession && (
                              <button
                                aria-label="删除专题会话"
                                className="session-delete-button"
                                disabled={isDeleting}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeSessionWithAnimation(session.id, "manual");
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <button className="session-add" onClick={() => createSessionInSpace(space.id)}>
                        <MessageSquarePlus size={14} />
                        新建专题会话
                      </button>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </aside>

        <section className="space-chat-column">
          <div className="panel space-session-header">
            <div>
              <p className="eyebrow">{activeLearningSpace?.name ?? "学习空间"}</p>
              <h2>{activeSession?.title ?? "专题会话"}</h2>
              <span>{activeSession?.focusConceptId ? `聚焦知识点：${activeSession.focusConceptId}` : "空间总览 Agent，共享全局画像和知识库"}</span>
            </div>
            {activeSession?.focusConceptId && (
              <button className="secondary-button small" onClick={() => openPrimaryCard(activeSession.focusConceptId ?? "")}>
                查看知识卡片
              </button>
            )}
          </div>
          <ChatWindow
            messages={sessionMessagesForActive}
            input={expertInput}
            loading={Boolean(activeSession?.isGenerating)}
            config={config}
            modelStatus={modelStatus}
            lastModelError={lastModelError}
            documentTitle={parsedDocument.fileName}
            chunkCount={parsedDocument.chunks.length}
            lastContextCount={lastRetrievalResults.length}
            usedFallbackContext={lastRetrievalResults.some((result) => result.fallback)}
            onInputChange={(value) => activeSession && setSessionInputs((current) => ({ ...current, [activeSession.id]: value }))}
            onSend={handleExpertSend}
            onOpenCard={(conceptId) => openPrimaryCard(conceptId)}
            feedbackByMessageConcept={feedbackByMessageConcept}
            onFeedback={handleFeedback}
            onAddReview={addReviewTask}
            isInReview={isInReview}
          />
          {renderCandidatePanel("space")}
        </section>

        <aside className="space-right-column">
          {renderExpertRightPanel()}
        </aside>
      </main>
      )}

      <KnowledgeCardDrawer
        conceptId={activeCard}
        secondaryConceptId={secondaryCard}
        cards={drawerCards}
        mastery={mastery}
        concepts={concepts}
        isInReview={isInReview}
        onClose={() => {
          setActiveCard(null);
          setSecondaryCard(null);
        }}
        onCloseSecondary={() => setSecondaryCard(null)}
        onOpenCard={(conceptId) => openPrimaryCard(conceptId)}
        onOpenRelated={(conceptId) => openSecondaryCardWithGeneratedFallback(conceptId, findAnyCard(activeCard ?? ""))}
        onAddReview={addReviewTask}
        onStartKnowledgeCheck={startKnowledgeCheck}
        onAddToKnowledgeBase={(name, category, reason, initialScore) => {
          const normalized = canonicalizeConceptName(name, [...concepts, ...pendingCandidates]).normalizedKey;
          void addCandidateToCourseKnowledge(name, category, reason, initialScore, activeCard ?? undefined, "related_concept").then(() => {
            setActiveCard((current) => {
              if (!current) return current;
              return canonicalizeConceptName(current, [...concepts, ...pendingCandidates]).normalizedKey === normalized ? name : current;
            });
            setSecondaryCard((current) => {
              if (!current) return current;
              const secondaryNormalized = canonicalizeConceptName(current, [...concepts, ...pendingCandidates]).normalizedKey;
              const primaryNormalized = activeCard ? canonicalizeConceptName(activeCard, [...concepts, ...pendingCandidates]).normalizedKey : "";
              if (secondaryNormalized === normalized && primaryNormalized === normalized) return null;
              return secondaryNormalized === normalized ? name : current;
            });
          });
        }}
        onRegenerateCard={(card) => {
          void ensureKnowledgeCard(card.name, {
            category: card.category,
            source: card.status === "temporary" ? "related_concept" : "manual",
            sourceText: card.source,
            force: true
          });
        }}
      />
    </div>
  );
}
