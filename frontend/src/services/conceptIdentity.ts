import type { CandidateConcept, ConfirmedConcept, KnowledgeConcept } from "../types";
import { conceptIdFromName } from "./masteryService";

const abbreviationAliases: Record<string, string[]> = {
  cnn: ["卷积神经网络", "Convolutional Neural Network"],
  rnn: ["循环神经网络", "Recurrent Neural Network"],
  lstm: ["长短期记忆网络", "Long Short-Term Memory"],
  svm: ["支持向量机", "Support Vector Machine"],
  pca: ["主成分分析", "Principal Component Analysis"],
  gan: ["生成对抗网络", "Generative Adversarial Network"],
  bert: ["Bidirectional Encoder Representations from Transformers"],
  gpt: ["Generative Pre-trained Transformer"],
  resnet: ["残差网络", "Residual Network"]
};

const preferredCase: Record<string, string> = {
  cnn: "CNN",
  rnn: "RNN",
  lstm: "LSTM",
  svm: "SVM",
  pca: "PCA",
  gan: "GAN",
  bert: "BERT",
  gpt: "GPT",
  resnet: "ResNet"
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
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, " ");
}

export function normalizeConceptKey(name: string) {
  return cleanName(name).toLowerCase();
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

function looksLikeAbbreviation(value: string) {
  const trimmed = cleanName(value);
  const key = trimmed.toLowerCase();
  return /^[A-Za-z]{2,12}$/.test(trimmed) && (trimmed === trimmed.toUpperCase() || Boolean(preferredCase[key]));
}

function preferredName(value: string) {
  const cleaned = cleanName(value);
  return preferredCase[cleaned.toLowerCase()] ?? (looksLikeAbbreviation(cleaned) ? cleaned.toUpperCase() : cleaned);
}

function splitParen(input: string): { outer: string; inner: string } | null {
  const normalized = cleanName(input);
  const match = normalized.match(/^(.+?)\((.+?)\)$/);
  if (!match) return null;
  return { outer: cleanName(match[1]), inner: cleanName(match[2]) };
}

function getConceptName(concept: KnowledgeConcept | ConfirmedConcept | CandidateConcept) {
  if ("canonicalName" in concept && concept.canonicalName) return concept.canonicalName;
  return "name" in concept ? concept.name : "";
}

function findKnown(input: string, knownConcepts: Array<KnowledgeConcept | ConfirmedConcept | CandidateConcept> = []) {
  const inputKey = normalizeConceptKey(input);
  return knownConcepts.find((concept) => {
    const canonicalName = getConceptName(concept);
    const normalizedKey = "normalizedKey" in concept && concept.normalizedKey ? concept.normalizedKey : normalizeConceptKey(canonicalName);
    const aliases = "aliases" in concept ? concept.aliases ?? [] : [];
    return normalizedKey === inputKey || normalizeConceptKey(canonicalName) === inputKey || aliases.some((alias) => normalizeConceptKey(alias) === inputKey);
  });
}

export function canonicalizeConceptName(
  input: string,
  knownConcepts: Array<KnowledgeConcept | ConfirmedConcept | CandidateConcept> = []
): CanonicalConcept {
  const raw = cleanName(input);
  const known = findKnown(raw, knownConcepts);
  if (known) {
    const canonicalName = getConceptName(known);
    const aliases = "aliases" in known ? known.aliases ?? [] : [];
    return {
      canonicalName,
      aliases: unique([raw, ...aliases], canonicalName),
      normalizedKey: "normalizedKey" in known && known.normalizedKey ? known.normalizedKey : normalizeConceptKey(canonicalName),
      displayName: canonicalName
    };
  }

  const paren = splitParen(raw);
  let canonicalName = raw;
  const aliases: string[] = [];
  const aliasOwner = Object.entries(abbreviationAliases).find(([, values]) => values.some((alias) => normalizeConceptKey(alias) === normalizeConceptKey(raw)));
  if (aliasOwner) {
    canonicalName = preferredCase[aliasOwner[0]] ?? aliasOwner[0].toUpperCase();
    aliases.push(raw);
  } else if (paren) {
    aliases.push(paren.outer, paren.inner, raw);
    if (looksLikeAbbreviation(paren.outer)) canonicalName = preferredName(paren.outer);
    else if (looksLikeAbbreviation(paren.inner)) canonicalName = preferredName(paren.inner);
    else canonicalName = paren.outer;
  } else if (looksLikeAbbreviation(raw)) {
    canonicalName = preferredName(raw);
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
