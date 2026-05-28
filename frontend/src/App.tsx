import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, BookOpenCheck, CalendarCheck, Compass, GraduationCap, LayoutDashboard, Layers3, LogOut, MessageSquarePlus, Moon, Plus, RotateCcw, Settings, Sun, Trash2 } from "lucide-react";
import { AgentTracePanel } from "./components/AgentTracePanel";
import { ChatWindow } from "./components/ChatWindow";
import { DocumentPanel } from "./components/DocumentPanel";
import { KnowledgeCardDrawer } from "./components/KnowledgeCardDrawer";
import { MasteryPanel } from "./components/MasteryPanel";
import { MistakeBookPanel } from "./components/MistakeBookPanel";
import { MistakesPage } from "./components/MistakesPage";
import { ModelSettings } from "./components/ModelSettings";
import { QuizPanel } from "./components/QuizPanel";
import { ReviewTaskPanel } from "./components/ReviewTaskPanel";
import { builtInDocument, builtInQuizBank, initialCards, initialConcepts, initialMastery } from "./data/demoCourse";
import { callLLMAgent, generateKnowledgeCardForConcept, getProviderDefaults } from "./services/llmClient";
import { isKnowledgeCardIncomplete, normalizeConceptName, upsertCards } from "./services/knowledgeCardService";
import { applyQuizResult, conceptIdFromName, getChatFeedbackDelta, updateConceptMastery, upsertMastery } from "./services/masteryService";
import { checkQuizAnswer, generateQuiz, getBuiltInQuiz } from "./services/quizService";
import type {
  AgentTraceStep,
  AgentSession,
  ChatMessage,
  CandidateConcept,
  KnowledgeCard,
  KnowledgeConcept,
  LearningSpace,
  LLMConfig,
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
  ThemeMode
} from "./types";
import { canonicalizeConceptName } from "./services/conceptIdentity";
import { classifyConceptFallback, reconcileKnowledgeState, toCandidateConcept, upsertCandidateConcept } from "./services/knowledgeStateService";

type RightPanelMode = "trace" | "mistakes" | "review" | "modelConfig";
type QuizDifficultySelection = "all" | QuizDifficulty;
type AppPage = "workbench" | "learningSpace" | "mistakes";
type SpaceRightPanelMode = "default" | "mistakes" | "review" | "modelConfig" | "diagnosis";
type MistakesRightPanelMode = "none" | "review" | "diagnosis" | "modelConfig";
type CrossPageNoticeState = {
  workbenchUnread: boolean;
  spacesUnread: boolean;
};

const demoQuestion = "为什么神经网络的反向传播需要用到链式法则？请用公式解释。";
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

const defaultConfig: LLMConfig = {
  provider: "openai-compatible",
  apiKey: "",
  baseUrl: getProviderDefaults("openai-compatible").baseUrl,
  model: "gpt-4o-mini",
  useMockFallback: true
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
  const [candidateMasteryPicker, setCandidateMasteryPicker] = useState<string | null>(null);
  const [candidateInitialScores, setCandidateInitialScores] = useState<Record<string, number>>({});
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("trace");
  const [activePage, setActivePageState] = useState<AppPage>(() => appPageFromPath(window.location.pathname));
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
  const [sessionTrace, setSessionTrace] = useState<Record<string, AgentTraceStep[]>>(() => readLocal("agentSessionTrace", {}));
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

  const [config, setConfig] = useState<LLMConfig>(defaultConfig);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "agent",
      text: "课程资料已加载。你可以上传资料、配置模型，也可以直接使用 mock fallback 演示。"
    }
  ]);
  const [trace, setTrace] = useState<AgentTraceStep[]>([]);
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

  const categories = useMemo(() => Array.from(new Set(cards.map((card) => card.category))), [cards]);
  const drawerCards = useMemo(() => upsertCards(cards, temporaryCards), [cards, temporaryCards]);
  const [activeCategory, setActiveCategory] = useState("全部");
  const visibleCards = activeCategory === "全部" ? cards : cards.filter((card) => card.category === activeCategory);

  const candidateConcepts = pendingCandidates
    .filter((candidate) => !dismissedCandidateNames.includes(candidate.normalizedKey))
    .filter((candidate) => !concepts.some((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) === candidate.normalizedKey));

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
      高等数学: ["导数", "链式法则", "函数", "矩阵", "概率"],
      机器学习基础: ["梯度", "损失函数", "过拟合", "正则化", "SVM", "PCA"],
      深度学习: ["CNN", "RNN", "反向传播", "梯度", "损失函数", "激活函数", "链式法则", "矩阵乘法", "Transformer"],
      强化学习: ["MDP", "Q-learning", "PPO", "策略", "价值函数", "强化学习"],
      计算机视觉: ["CNN", "卷积", "ResNet", "图像", "视觉"],
      自然语言处理: ["Transformer", "BERT", "GPT", "注意力", "语言模型"]
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

  const addPendingCandidate = (
    candidate: { name: string; category?: string; reason?: string; source?: CandidateConcept["source"] },
    source: CandidateConcept["source"] = "chat"
  ) => {
    const pending = toCandidateConcept(candidate, [...concepts, ...pendingCandidates], source);
    setPendingCandidates((current) => upsertCandidateConcept(current, pending, concepts));
    return pending;
  };

  const dismissCandidate = (candidate: CandidateConcept) => {
    setPendingCandidates((current) => current.filter((item) => item.normalizedKey !== candidate.normalizedKey));
    setTemporaryCards((current) => current.filter((card) => (card.normalizedKey || normalizeConceptName(card.name)) !== candidate.normalizedKey));
    setDismissedCandidateNames((current) => (current.includes(candidate.normalizedKey) ? current : [...current, candidate.normalizedKey]));
    setCandidateMasteryPicker(null);
    showToast("已清除候选知识点");
  };

  const toggleRightPanel = (mode: Exclude<RightPanelMode, "trace">) => {
    setRightPanelMode((current) => (current === mode ? "trace" : mode));
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

  const openCardWithGeneratedFallback = async (
    conceptName: string,
    options: Parameters<typeof ensureKnowledgeCard>[1] = {}
  ) => {
    const canonical = canonicalizeConceptName(conceptName, [...concepts, ...pendingCandidates]);
    const cardName = canonical.canonicalName;
    const existingOfficial = cards.some((card) => (card.normalizedKey || normalizeConceptName(card.name)) === canonical.normalizedKey);
    if (!existingOfficial) {
      showToast(`正在生成「${conceptName}」知识卡...`);
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
      showToast(`正在生成「${conceptName}」知识卡...`);
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

  const addMistake = (question: QuizQuestion, source: "diagnosis" | "review" | "practice" = "diagnosis") => {
    const selected = selectedAnswers[question.id];
    const item = buildMistakeItemFromQuestion(question, selected, source);
    mistakeIdsRef.current.add(item.id);
    mistakeIdsRef.current.add(item.questionId);
    setMistakes((current) => {
      const next = upsertMistake(current, item);
      writeLocal("mistakeBook", next);
      return next;
    });
    showToast("已收入错题本");
    return true;
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
    return reviewTasks.some((task) => (normalizeConceptName(task.conceptName) === normalized && task.dueDate === dueDate) || `${normalized}:${dueDate}` === task.id);
  };

  const addReviewTask = (conceptName: string, source: "knowledge_card" | "chat_suggestion" | "quiz") => {
    const canonical = canonicalizeConceptName(conceptName, [...concepts, ...pendingCandidates]);
    const confirmed = concepts.some((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) === canonical.normalizedKey);
    if (!confirmed) {
      addPendingCandidate({ name: conceptName, reason: "加入复习前需要先确认入库", source: "chat" }, "chat");
      showToast("请先确认加入知识库，再加入复习任务");
      return;
    }
    const canonicalName = canonical.canonicalName;
    const dueDate = today();
    const key = `${canonical.normalizedKey}:${dueDate}`;
    if (reviewTaskIdsRef.current.has(key)) {
      showToast("已在今日复习中");
      return;
    }
    reviewTaskIdsRef.current.add(key);
    const category = cards.find((card) => (card.normalizedKey || normalizeConceptName(card.name)) === canonical.normalizedKey)?.category || concepts.find((concept) => (concept.normalizedKey || normalizeConceptName(concept.name)) === canonical.normalizedKey)?.category;
    const task: ReviewTask = {
      id: key,
      conceptName: canonicalName,
      category,
      dueDate,
      source,
      status: "pending",
      createdAt: now(),
      masteryApplied: false
    };
    setReviewTasks((current) => (current.some((item) => item.id === key) ? current : [task, ...current]));
    showToast("已加入今日复习");
  };

  const startReviewTaskCheck = async (taskId: string) => {
    const task = reviewTasks.find((item) => item.id === taskId);
    if (!task || task.status === "done") return;
    openDiagnosisPanelForCurrentPage();
    setQuizSource("review_task");
    setActiveReviewTaskId(taskId);
    await startKnowledgeCheck(task.conceptName, "review_task");
  };

  const handleParsed = (parsed: ParsedDocument) => {
    setParsedDocument(parsed);
    setConcepts((current) => {
      const byName = new Map(current.map((concept) => [concept.normalizedKey || normalizeConceptName(concept.name), concept]));
      parsed.concepts.forEach((concept) => {
        const canonical = canonicalizeConceptName(concept.name, Array.from(byName.values()));
        byName.set(canonical.normalizedKey, {
          ...concept,
          id: conceptIdFromName(canonical.canonicalName),
          name: canonical.canonicalName,
          canonicalName: canonical.canonicalName,
          aliases: canonical.aliases,
          normalizedKey: canonical.normalizedKey,
          status: "existing",
          cardId: conceptIdFromName(canonical.canonicalName),
          createdAt: concept.createdAt || now()
        });
      });
      return Array.from(byName.values());
    });
    parsed.concepts.forEach((concept) => {
      const canonical = canonicalizeConceptName(concept.name, concepts);
      applyMasteryEvent({
        id: `concept_init:${canonical.normalizedKey}`,
        conceptName: canonical.canonicalName,
        delta: 0,
        reason: "上传资料抽取知识点，初始化画像",
        source: "concept_init",
        createdAt: now()
      });
    });
    setTrace([
      {
        id: `upload_${Date.now()}`,
        title: "资料上传解析",
        type: "document_parse",
        status: parsed.status === "failed" ? "failed" : "success",
        detail: `${parsed.fileName}：提取 ${parsed.chunks.length} 个片段，抽取 ${parsed.concepts.length} 个知识点。`
      }
    ]);
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
      const result = await callLLMAgent(config, question, parsedDocument.chunks, concepts, mastery);
      setTrace(result.trace);
      const confirmedKeys = new Set(concepts.map((concept) => concept.normalizedKey || normalizeConceptName(concept.name)));
      const officialCards = result.cards.filter((card) => confirmedKeys.has(card.normalizedKey || normalizeConceptName(card.name)));
      const temporaryResultCards = result.cards.filter((card) => !confirmedKeys.has(card.normalizedKey || normalizeConceptName(card.name)));
      if (officialCards.length > 0) setCards((current) => upsertCards(current, officialCards.map((card) => ({ ...card, status: "confirmed" }))));
      if (temporaryResultCards.length > 0) setTemporaryCards((current) => upsertCards(current, temporaryResultCards.map((card) => ({ ...card, status: "temporary" }))));
      setMessages((current) => [...current, { id: agentId, role: "agent", answer: result.answer }]);
      setConnected(result.answer.mode === "llm" || Boolean(config.apiKey.trim()));
      result.answer.detectedConcepts.forEach((concept) => {
        const canonical = canonicalizeConceptName(concept.name, [...concepts, ...pendingCandidates]);
        const exists = concepts.some((item) => (item.normalizedKey || normalizeConceptName(item.name)) === canonical.normalizedKey);
        if (!exists || concept.status === "candidate") {
          addPendingCandidate({ name: concept.name, category: concept.category, reason: concept.reason, source: "chat" }, "chat");
        }
      });
      result.answer.newConceptCandidates.forEach((candidate) => {
        if (candidate.shouldAddToCourse) {
          addPendingCandidate({ name: candidate.name, category: candidate.category, reason: candidate.reason, source: "chat" }, "chat");
        }
      });
    } catch (error) {
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
      setSessionTrace((current) => ({ ...current, [sessionId]: result.trace }));
      setSessionMessages((current) => ({
        ...current,
        [sessionId]: [...(current[sessionId] ?? []), { id: agentId, role: "agent", answer: result.answer }]
      }));
      setConnected(result.answer.mode === "llm" || Boolean(config.apiKey.trim()));
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
                text: `这个问题似乎不属于当前的${activeLearningSpace?.name ?? "学习空间"}方向。你可以切换到更匹配的学习空间，或继续提出与当前方向相关的专题问题。`
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
      result.answer.detectedConcepts.forEach((concept) => {
        const canonical = canonicalizeConceptName(concept.name, [...concepts, ...pendingCandidates]);
        const exists = concepts.some((item) => (item.normalizedKey || normalizeConceptName(item.name)) === canonical.normalizedKey);
        if (!exists || concept.status === "candidate") {
          addPendingCandidate({ name: concept.name, category: concept.category, reason: concept.reason, source: "chat" }, "chat");
        }
      });
      result.answer.newConceptCandidates.forEach((candidate) => {
        if (candidate.shouldAddToCourse) {
          addPendingCandidate({ name: candidate.name, category: candidate.category, reason: candidate.reason, source: "chat" }, "chat");
        }
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
    const finalCategory =
      category && category !== "待确认新概念" && category !== "待分类"
        ? category
        : pending?.suggestedCategory && pending.suggestedCategory !== "待确认新概念"
          ? pending.suggestedCategory
          : classifyConceptFallback(canonical.canonicalName, canonical.aliases);
    const fullCard = await ensureKnowledgeCard(canonical.canonicalName, {
      category: finalCategory,
      source,
      sourceText: reason || pending?.reason,
      relatedConcept,
      force: isKnowledgeCardIncomplete(findAnyCard(canonical.canonicalName))
    });
    const cardCategory = fullCard.category && fullCard.category !== "待确认新概念" && fullCard.category !== "待分类" ? fullCard.category : finalCategory;
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

  const handleQuizSubmit = () => {
    if (quizSubmitted || quizSubmitLockedRef.current) return;
    quizSubmitLockedRef.current = true;
    let next = mastery;
    const changes: QuizResultChange[] = [];
    const newScored = new Set(scoredQuestionRef.current);
    quizQuestions.forEach((question) => {
      const scoreKey = `${quizAttemptId}:${question.id}`;
      if (newScored.has(scoreKey)) return;
      newScored.add(scoreKey);
      const correct = checkQuizAnswer(question, selectedAnswers[question.id]);
      const result = applyQuizResult(next, question.conceptNames, question.difficulty, correct);
      next = result.mastery;
      changes.push(...result.changes);
    });
    scoredQuestionRef.current = newScored;
    writeLocal("scoredQuestionKeys", Array.from(newScored));
    setMastery(next);
    setQuizChanges(changes);
    setQuizSubmitted(true);
    if (quizSource === "review_task" && activeReviewTaskId) {
      const correctCount = quizQuestions.filter((question) => checkQuizAnswer(question, selectedAnswers[question.id])).length;
      const passed = quizQuestions.length > 0 && correctCount / quizQuestions.length >= 0.6;
      setReviewTasks((current) =>
        current.map((task) =>
          task.id === activeReviewTaskId
            ? {
                ...task,
                status: passed ? "done" : "pending",
                completedAt: passed ? now() : task.completedAt,
                lastCheckPassed: passed,
                lastCheckAt: now()
              }
            : task
        )
      );
      showToast(passed ? "复习检测通过，任务已完成" : "本次检测未通过，建议稍后再复习");
    }
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
    setQuizGenerating(true);
    setQuizCollapsed(false);
    const requestedConceptSet = new Set(requestedConceptNames.map(normalizeConceptName));
    const scopedConcepts =
      requestedConceptNames.length > 0
        ? concepts.filter((concept) => requestedConceptSet.has(normalizeConceptName(concept.name)))
        : concepts.filter((concept) => quizCategory === "全部" || concept.category === quizCategory);
    try {
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
      restartQuiz(generated.questions);
      setQuizWarning(generated.warning ?? "");
      setQuizDifficultyHint(resolvedDifficulty.reason);
    } finally {
      setQuizGenerating(false);
    }
  };

  const startKnowledgeCheck = async (conceptName: string, source: "knowledge_check" | "review_task" = "knowledge_check") => {
    const score = mastery.find((record) => normalizeConceptName(record.conceptName) === normalizeConceptName(conceptName))?.score;
    const difficulty = difficultyFromMastery(score);
    openDiagnosisPanelForCurrentPage();
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
      addPendingCandidate(
        {
          name: conceptName,
          category: extra?.category,
          reason: extra?.reason || currentQuizQuestion.explanationMarkdown,
          source: "quiz_explanation"
        },
        "quiz_explanation"
      );
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
        />
      );
    }
    if (spaceRightPanelMode === "modelConfig") {
      return <ModelSettings config={config} connected={connected} onChange={(next) => { setConfig(next); setConnected(Boolean(next.apiKey.trim())); }} />;
    }
    return null;
  };

  return (
    <div className="app-shell">
      {toast && <div className="toast">{toast}</div>}
      {appMenuOpen && appMenuRect && (
        <div onMouseEnter={() => openAppMenu(appMenuRect)} onMouseLeave={scheduleAppMenuClose}>
          <AppSwitchMenu activePage={activePage} rect={appMenuRect} onNavigate={navigatePage} onKeepOpen={() => openAppMenu(appMenuRect)} onClose={closeAppMenu} />
        </div>
      )}
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
            onClick={() => navigatePage(activePage === "workbench" ? "learningSpace" : "workbench")}
          >
            {activePage === "workbench" ? "进入学习空间" : "进入学习工作区"}
            {(activePage === "workbench" ? spacesHasUnread || crossPageNotice.spacesUnread : crossPageNotice.workbenchUnread) && <span className="nav-notice-dot" />}
          </button>
          )}
        </div>
        <div className="header-status">
          <span>{parsedDocument.status === "ready" ? "资料已解析" : "资料部分可用"}</span>
          <span>知识点 {concepts.length} 个</span>
          <span className={connected ? "connection-label ok" : "connection-label"}>{connected ? "模型已配置" : "mock 可用"}</span>
                <div className={`nav-action-button nav-action-split mistake-nav-split-button ${(activePage === "mistakes" || (activePage === "workbench" ? rightPanelMode === "mistakes" : spaceRightPanelMode === "mistakes")) ? "active" : ""}`}>
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
                activePage === "workbench" ? toggleRightPanel("mistakes") : toggleSpaceRightPanel("mistakes");
              }}
            >
              错题本
            </button>
          </div>
          <button className={`secondary-button small nav-action-button ${(activePage === "workbench" ? rightPanelMode === "review" : activePage === "mistakes" ? mistakesRightPanelMode === "review" : spaceRightPanelMode === "review") ? "active" : ""}`} onClick={() => (activePage === "workbench" ? toggleRightPanel("review") : activePage === "mistakes" ? toggleMistakesRightPanel("review") : toggleSpaceRightPanel("review"))}>
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
          <button className={`secondary-button small nav-action-button ${(activePage === "workbench" ? rightPanelMode === "modelConfig" : activePage === "mistakes" ? mistakesRightPanelMode === "modelConfig" : spaceRightPanelMode === "modelConfig") ? "active" : ""}`} onClick={() => (activePage === "workbench" ? toggleRightPanel("modelConfig") : activePage === "mistakes" ? toggleMistakesRightPanel("modelConfig") : toggleSpaceRightPanel("modelConfig"))}>
            <Settings size={14} />
            模型配置
          </button>
          <button className="secondary-button small" onClick={() => restartQuiz(builtInQuizBank.slice(0, 3), demoAnswers)}>
            <RotateCcw size={14} />
            恢复 Demo
          </button>
        </div>
      </header>

      {activePage === "workbench" ? (
      <main className="dashboard">
        <div className="left-column">
          <DocumentPanel document={parsedDocument} onParsed={handleParsed} onOpenCard={(conceptId) => openPrimaryCard(conceptId)} />
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
          />
        </div>

        <div className="center-column">
          <ChatWindow
            messages={messages}
            input={input}
            loading={loading}
            config={config}
            onInputChange={setInput}
            onSend={handleSend}
            onOpenCard={(conceptId) => openPrimaryCard(conceptId)}
            feedbackByMessageConcept={feedbackByMessageConcept}
            onFeedback={handleFeedback}
            onAddReview={addReviewTask}
            isInReview={isInReview}
          />

          <section className="panel cards-panel">
            <div className="panel-header compact collapsible-header">
              <div>
                <p className="eyebrow">知识卡片库</p>
                <h2>按分类查看卡片</h2>
                {cardsCollapsed && <span className="collapse-summary">知识卡片库：{cards.length} 张卡片，{categories.length} 个分类</span>}
              </div>
              <button className="icon-button" onClick={() => setCardsCollapsed((value) => !value)} aria-label="切换知识卡片库">
                <Plus size={18} />
              </button>
            </div>
            {!cardsCollapsed && (
              <>
                <div className="category-tabs">
                  {["全部", ...categories].map((category) => (
                    <button className={activeCategory === category ? "active" : ""} key={category} onClick={() => setActiveCategory(category)}>
                      {category}
                    </button>
                  ))}
                </div>
                <div className="card-list">
                  {visibleCards.map((card) => (
                    <button className="mini-card" key={card.id} onClick={() => openPrimaryCard(card.name)}>
                      <strong>{card.name}</strong>
                      <span>{card.category}</span>
                      <p>{card.summary}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          {candidateConcepts.length > 0 && (
            <section className="panel candidate-panel">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">候选知识点</p>
                  <h2>可加入当前课程</h2>
                </div>
              </div>
              <div className="candidate-list">
                {candidateConcepts.map((candidate) => (
                  <article key={candidate.id}>
                    <strong>{candidate.canonicalName}</strong>
                    {candidate.aliases.length > 0 && <span>别名：{candidate.aliases.join("、")}</span>}
                    <span>{candidate.suggestedCategory || "待确认分类"} · 来自{candidate.source === "chat" ? "问答" : candidate.source === "quiz_explanation" ? "习题解析" : "新概念识别"}</span>
                    <p>{candidate.summary || candidate.reason || "系统识别到的待确认新知识点，请确认后再加入正式知识库。"}</p>
                    <button
                      className="secondary-button small"
                      onClick={() =>
                        openCardWithGeneratedFallback(candidate.canonicalName, {
                          category: candidate.suggestedCategory,
                          source: "chat",
                          sourceText: candidate.reason
                        })
                      }
                    >
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
                      否，清除
                    </button>
                    {candidateMasteryPicker === candidate.normalizedKey && (
                      <div className="candidate-confirm-panel">
                        <div className="candidate-confirm-title">你目前对这个知识点的掌握情况是？</div>
                        <div className="mastery-choice-grid">
                          {[
                            { score: 0.15, label: "没听过 / 基本不了解" },
                            { score: 0.35, label: "听过但不太会用" },
                            { score: 0.55, label: "基本理解，想加入复习" }
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
                          <button className="secondary-button small" onClick={() => setCandidateMasteryPicker(null)}>
                            取消
                          </button>
                          <button
                            className="primary-button small"
                            onClick={() =>
                              addCandidateToCourseKnowledge(
                                candidate.canonicalName,
                                candidate.suggestedCategory || "待分类",
                                candidate.reason || "",
                                candidateInitialScores[candidate.normalizedKey] ?? 0.15,
                                undefined,
                                candidate.source
                              )
                            }
                          >
                            确认加入
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          <MasteryPanel
            mastery={mastery}
            concepts={concepts}
            collapsed={masteryCollapsed}
            onOpenCard={(conceptId) => openPrimaryCard(conceptId)}
            onToggleCollapsed={() => setMasteryCollapsed((value) => !value)}
          />
        </div>

        {rightPanelMode === "mistakes" ? (
          <MistakeBookPanel
            mistakes={mistakes}
            onOpenCard={(conceptId) => openPrimaryCard(conceptId)}
            onPracticeSubmit={handleMistakePracticeSubmit}
            onResolveMistake={resolveMistake}
          />
        ) : rightPanelMode === "review" ? (
          <ReviewTaskPanel reviewTasks={reviewTasks} onOpenCard={(conceptId) => openPrimaryCard(conceptId)} onStartReviewCheck={startReviewTaskCheck} />
        ) : rightPanelMode === "modelConfig" ? (
          <ModelSettings config={config} connected={connected} onChange={(next) => { setConfig(next); setConnected(Boolean(next.apiKey.trim())); }} />
        ) : (
          <AgentTracePanel trace={trace} />
        )}
      </main>
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
        onConfigChange={(next) => { setConfig(next); setConnected(Boolean(next.apiKey.trim())); }}
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
            onInputChange={(value) => activeSession && setSessionInputs((current) => ({ ...current, [activeSession.id]: value }))}
            onSend={handleExpertSend}
            onOpenCard={(conceptId) => openPrimaryCard(conceptId)}
            feedbackByMessageConcept={feedbackByMessageConcept}
            onFeedback={handleFeedback}
            onAddReview={addReviewTask}
            isInReview={isInReview}
          />
          {candidateConcepts.length > 0 && (
            <section className="panel space-candidates">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">候选知识点</p>
                  <h2>待确认后进入共享知识库</h2>
                </div>
              </div>
              <div className="candidate-list">
                {candidateConcepts.slice(0, 4).map((candidate) => (
                  <article key={candidate.id}>
                    <strong>{candidate.canonicalName}</strong>
                    <p>{candidate.summary || candidate.reason || "待确认新知识点"}</p>
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
                        <div className="candidate-confirm-title">你目前对这个知识点的掌握情况是？</div>
                        <div className="mastery-choice-grid">
                          {[
                            { score: 0.15, label: "没听过 / 基本不了解" },
                            { score: 0.35, label: "听过但不太会用" },
                            { score: 0.55, label: "基本理解，想加入复习" }
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
                                candidate.source
                              )
                            }
                          >确认加入</button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
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
