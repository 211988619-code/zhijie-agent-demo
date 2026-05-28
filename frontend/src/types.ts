export type ConceptId = string;

export type SourceRef = {
  document: string;
  section: string;
  chunkId?: string;
};

export type CourseChunk = {
  id: string;
  section: string;
  content: string;
  concepts: ConceptId[];
  source: SourceRef;
};

export type KnowledgeConcept = {
  id: ConceptId;
  name: string;
  category: string;
  status: "existing" | "candidate";
  confidence?: number;
  reason?: string;
  canonicalName?: string;
  aliases?: string[];
  normalizedKey?: string;
  cardId?: string;
  createdAt?: string;
};

export type CandidateConcept = {
  id: string;
  canonicalName: string;
  aliases: string[];
  normalizedKey: string;
  suggestedCategory?: string;
  summary?: string;
  reason?: string;
  source: "chat" | "quiz" | "quiz_explanation" | "related_concept";
  status: "pending";
  createdAt: string;
};

export type ConfirmedConcept = {
  id: string;
  canonicalName: string;
  aliases: string[];
  normalizedKey: string;
  category: string;
  cardId: string;
  createdAt: string;
};

export type KnowledgeCard = {
  id: ConceptId;
  name: string;
  canonicalName?: string;
  aliases?: string[];
  normalizedKey?: string;
  category: string;
  summary: string;
  intuition: string;
  formula: string;
  example: string;
  commonMistakes: string[];
  prerequisites: string[];
  relatedConcepts: string[];
  source: string;
  masterySuggestion?: string;
  status?: "temporary" | "confirmed";
  generatedBy?: "llm" | "fallback" | "manual";
  createdAt?: string;
  updatedAt?: string;
};

export type MasteryRecord = {
  conceptId: ConceptId;
  conceptName: string;
  score: number;
  lastEvent?: string;
};

export type ParsedDocument = {
  id: string;
  fileName: string;
  fileType: string;
  status: "ready" | "partial" | "failed";
  text: string;
  chunks: CourseChunk[];
  concepts: KnowledgeConcept[];
  updatedAt: string;
  error?: string;
};

export type UploadState = {
  progress: number;
  status: "idle" | "reading" | "parsing" | "ready" | "partial" | "failed";
  message: string;
};

export type LLMProvider = "openai" | "deepseek" | "dashscope" | "zhipu" | "openai-compatible";

export type LLMConfig = {
  provider: LLMProvider;
  apiKey: string;
  baseUrl?: string;
  model: string;
  useMockFallback: boolean;
};

export type DetectedConcept = {
  name: string;
  category: string;
  status: "existing" | "candidate";
  masteryScore?: number;
  reason?: string;
};

export type NewConceptCandidate = {
  name: string;
  category: string;
  confidence: number;
  shouldAddToCourse: boolean;
  reason: string;
};

export type AgentTraceStep = {
  id: string;
  title: string;
  type: string;
  tool?: string;
  status: "pending" | "running" | "success" | "failed";
  detail: string;
  data?: string[];
};

export type AgentAnswer = {
  mode: "llm" | "mock";
  taskType: string;
  answerMarkdown: string;
  concepts: ConceptId[];
  detectedConcepts: DetectedConcept[];
  newConceptCandidates: NewConceptCandidate[];
  sourceRefs: SourceRef[];
  reviewSuggestions: string[];
};

export type ChatMessage = {
  id: string;
  role: "student" | "agent";
  text?: string;
  answer?: AgentAnswer;
  error?: string;
};

export type QuizDifficulty = "basic" | "medium" | "advanced";
export type QuestionType = "single_choice" | "multiple_choice" | "true_false";

export type QuizQuestion = {
  id: string;
  type: QuestionType;
  difficulty: QuizDifficulty;
  conceptNames: string[];
  extraConcepts?: {
    name: string;
    category?: string;
    reason?: string;
    source?: "quiz_explanation" | "llm";
  }[];
  questionMarkdown: string;
  options: { id: "A" | "B" | "C" | "D"; textMarkdown: string }[];
  answer: string | string[];
  explanationMarkdown: string;
  source: "built-in" | "llm" | "fallback";
};

export type QuizAnswer = string | string[];

export type QuizResultChange = {
  conceptName: string;
  oldScore: number;
  newScore: number;
  correct: boolean;
  delta?: number;
  note?: string;
};

export type ReviewTask = {
  id: string;
  conceptName: string;
  category?: string;
  dueDate: string;
  source: "knowledge_card" | "chat_suggestion" | "quiz";
  status: "pending" | "done";
  createdAt: string;
  completedAt?: string;
  masteryApplied?: boolean;
  lastCheckPassed?: boolean;
  lastCheckAt?: string;
};

export type MasteryEvent = {
  id: string;
  conceptName: string;
  delta: number;
  reason: string;
  source: "quiz" | "chat_feedback" | "review" | "concept_init" | "mistake";
  createdAt: string;
};

export type ThemeMode = "light" | "dark";

export type LearningSpace = {
  id: string;
  name: string;
  description?: string;
  parentId?: string | null;
  icon?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentSession = {
  id: string;
  studentId: string;
  spaceId: string;
  focusConceptId?: string;
  focusConceptName?: string;
  title: string;
  mode: "space" | "concept" | "diagnosis" | "review" | "homework";
  status?: "draft" | "confirmed" | "unresolved";
  isGenerating?: boolean;
  hasUnreadCompletion?: boolean;
  hasBeenViewedAfterCompletion?: boolean;
  needsTitleResolution?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SpaceConcept = {
  spaceId: string;
  conceptId: string;
  role: "core" | "prerequisite" | "related" | "optional";
  categoryInSpace?: string;
  importance?: number;
};

export type MistakeItem = {
  id: string;
  questionId: string;
  question: QuizQuestion;
  conceptNames: string[];
  difficulty: QuizDifficulty;
  category?: string;
  wrongCount: number;
  lastUserAnswer?: string | string[];
  status: "active" | "mastered";
  source: "diagnosis" | "review" | "practice";
  createdAt: string;
  updatedAt: string;
};

export type MistakePracticeAttempt = {
  id: string;
  mistakeId: string;
  userAnswer: string | string[];
  isCorrect: boolean;
  masteryApplied: boolean;
  resolved?: "understood" | "still_confused";
  createdAt: string;
};
