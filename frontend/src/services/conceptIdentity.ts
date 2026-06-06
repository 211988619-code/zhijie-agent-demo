import type { CandidateConcept, ConfirmedConcept, KnowledgeConcept } from "../types";
import { conceptIdFromName } from "./masteryService";

const abbreviationAliases: Record<string, string[]> = {
  cnn: ["\u5377\u79ef\u795e\u7ecf\u7f51\u7edc", "Convolutional Neural Network"],
  rnn: ["\u5faa\u73af\u795e\u7ecf\u7f51\u7edc", "Recurrent Neural Network"],
  lstm: ["\u957f\u77ed\u671f\u8bb0\u5fc6\u7f51\u7edc", "Long Short-Term Memory", "Long Short Term Memory"],
  gru: ["\u95e8\u63a7\u5faa\u73af\u5355\u5143", "Gated Recurrent Unit"],
  svm: ["\u652f\u6301\u5411\u91cf\u673a", "Support Vector Machine"],
  pca: ["\u4e3b\u6210\u5206\u5206\u6790", "Principal Component Analysis"],
  gan: ["\u751f\u6210\u5bf9\u6297\u7f51\u7edc", "Generative Adversarial Network"],
  bert: ["Bidirectional Encoder Representations from Transformers"],
  gpt: ["Generative Pre-trained Transformer", "Generative Pretrained Transformer"],
  resnet: ["\u6b8b\u5dee\u7f51\u7edc", "Residual Network"],
  mdp: ["\u9a6c\u5c14\u53ef\u592b\u51b3\u7b56\u8fc7\u7a0b", "Markov Decision Process"],
  dqn: ["\u6df1\u5ea6 Q \u7f51\u7edc", "\u6df1\u5ea6Q\u7f51\u7edc", "Deep Q-Network", "Deep Q Network"],
  ppo: ["\u8fd1\u7aef\u7b56\u7565\u4f18\u5316", "Proximal Policy Optimization"],
  a2c: ["\u4f18\u52bf\u884c\u52a8\u8005\u8bc4\u8bba\u5bb6", "Advantage Actor-Critic", "Advantage Actor Critic"],
  "q-learning": ["Q \u5b66\u4e60", "Q\u5b66\u4e60", "Q Learning"],
  yolo: ["You Only Look Once"],
  vit: ["\u89c6\u89c9 Transformer", "Vision Transformer"]
};

const preferredCase: Record<string, string> = {
  cnn: "CNN",
  rnn: "RNN",
  lstm: "LSTM",
  gru: "GRU",
  svm: "SVM",
  pca: "PCA",
  gan: "GAN",
  bert: "BERT",
  gpt: "GPT",
  resnet: "ResNet",
  mdp: "MDP",
  dqn: "DQN",
  ppo: "PPO",
  a2c: "A2C",
  "q-learning": "Q-learning",
  yolo: "YOLO",
  vit: "ViT",
  transformer: "Transformer"
};

export type CanonicalConcept = {
  canonicalName: string;
  aliases: string[];
  normalizedKey: string;
  displayName: string;
};

function cleanName(name: string) {
  return String(name ?? "")
    .trim()
    .replace(/[\uff08]/g, "(")
    .replace(/[\uff09]/g, ")")
    .replace(/[\u3010\uff3b\uff5b]/g, "(")
    .replace(/[\u3011\uff3d\uff5d]/g, ")")
    .replace(/[\uff1a]/g, ":")
    .replace(/[\uff0c\u3001\uff1b]/g, ",")
    .replace(/[\uff0f]/g, "/")
    .replace(/\s+/g, " ")
    .replace(/^[-\u2013\u2014:\uff1a,\uff0c\u3001;\uff1b\s]+|[-\u2013\u2014:\uff1a,\uff0c\u3001;\uff1b\s]+$/g, "");
}

export function normalizeConceptKey(name: string) {
  return cleanName(name)
    .toLowerCase()
    .replace(/[\u201c\u201d"'`]/g, "")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*([()/,:])\s*/g, "$1")
    .replace(/[.\u3002!\uff01?\uff1f]/g, "")
    .trim();
}

function unique(values: string[], canonicalName: string) {
  const seen = new Set<string>();
  const canonicalKey = normalizeConceptKey(canonicalName);
  return values
    .map(cleanName)
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeConceptKey(value);
      if (key === canonicalKey || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function aliasOwnerFor(value: string) {
  const key = normalizeConceptKey(value);
  if (abbreviationAliases[key]) return key;
  return Object.entries(abbreviationAliases).find(([, values]) => values.some((alias) => normalizeConceptKey(alias) === key))?.[0];
}

function looksLikeAbbreviation(value: string) {
  const trimmed = cleanName(value);
  const key = normalizeConceptKey(trimmed);
  return /^[A-Za-z][A-Za-z0-9-]{1,15}$/.test(trimmed) && (trimmed === trimmed.toUpperCase() || Boolean(preferredCase[key]));
}

function preferredName(value: string) {
  const cleaned = cleanName(value);
  const key = normalizeConceptKey(cleaned);
  return preferredCase[key] ?? (looksLikeAbbreviation(cleaned) ? cleaned.toUpperCase() : cleaned);
}

function splitParen(input: string): { outer: string; inner: string } | null {
  const normalized = cleanName(input);
  const match = normalized.match(/^(.+?)\((.+?)\)$/);
  if (!match) return null;
  return { outer: cleanName(match[1]), inner: cleanName(match[2]) };
}

function splitComposite(input: string) {
  const raw = cleanName(input);
  const paren = splitParen(raw);
  if (paren) return [paren.outer, paren.inner, raw];
  const parts = raw.split(/\s*(?:\/|:|\uff1a|,|\uff0c|\u3001|;|\uff1b)\s*/).map(cleanName).filter(Boolean);
  return parts.length > 1 ? [...parts, raw] : [raw];
}

function getConceptName(concept: KnowledgeConcept | ConfirmedConcept | CandidateConcept) {
  if ("canonicalName" in concept && concept.canonicalName) return concept.canonicalName;
  return "name" in concept ? concept.name : "";
}

export function resolveKnownConcept(
  input: string,
  knownConcepts: Array<KnowledgeConcept | ConfirmedConcept | CandidateConcept> = []
) {
  const inputKeys = splitComposite(input).map(normalizeConceptKey);
  return knownConcepts.find((concept) => {
    const canonicalName = getConceptName(concept);
    const normalizedKey = "normalizedKey" in concept && concept.normalizedKey ? concept.normalizedKey : normalizeConceptKey(canonicalName);
    const aliases = "aliases" in concept ? concept.aliases ?? [] : [];
    const keys = [normalizedKey, normalizeConceptKey(canonicalName), ...aliases.map(normalizeConceptKey)];
    return inputKeys.some((key) => keys.includes(key));
  });
}

export function canonicalizeConceptName(
  input: string,
  knownConcepts: Array<KnowledgeConcept | ConfirmedConcept | CandidateConcept> = []
): CanonicalConcept {
  const raw = cleanName(input);
  const known = resolveKnownConcept(raw, knownConcepts);
  if (known) {
    const canonicalName = getConceptName(known);
    const aliases = "aliases" in known ? known.aliases ?? [] : [];
    return {
      canonicalName,
      aliases: unique([raw, ...splitComposite(raw), ...aliases], canonicalName),
      normalizedKey: "normalizedKey" in known && known.normalizedKey ? known.normalizedKey : normalizeConceptKey(canonicalName),
      displayName: canonicalName
    };
  }

  let canonicalName = raw;
  const aliases: string[] = [];
  const parts = splitComposite(raw);
  const owner = parts.map(aliasOwnerFor).find(Boolean);
  if (owner) {
    canonicalName = preferredCase[owner] ?? owner.toUpperCase();
    aliases.push(...parts, ...(abbreviationAliases[owner] ?? []));
  } else {
    const abbreviationPart = parts.find(looksLikeAbbreviation);
    if (abbreviationPart) {
      canonicalName = preferredName(abbreviationPart);
      aliases.push(...parts);
    } else {
      canonicalName = parts[0] ?? raw;
      aliases.push(...parts.slice(1), raw);
    }
  }

  const key = normalizeConceptKey(canonicalName);
  return {
    canonicalName,
    aliases: unique([...(abbreviationAliases[key] ?? []), ...aliases], canonicalName),
    normalizedKey: key,
    displayName: canonicalName
  };
}

export function conceptIdFromCanonical(input: string, knownConcepts: Array<KnowledgeConcept | ConfirmedConcept | CandidateConcept> = []) {
  return conceptIdFromName(canonicalizeConceptName(input, knownConcepts).canonicalName);
}

export function mergeAliases(current: string[] = [], incoming: string[] = [], canonicalName: string) {
  return unique([...current, ...incoming], canonicalName);
}
