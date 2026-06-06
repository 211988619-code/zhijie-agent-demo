import type { CourseChunk, KnowledgeConcept, ParsedDocument, UploadState } from "../types";
import { initialConcepts } from "../data/demoCourse";
import { processConceptExtraction } from "./conceptExtractionService";
import { conceptIdFromName } from "./masteryService";

const supportedTextTypes = [".md", ".txt"];
const supportedImageTypes = [".png", ".jpg", ".jpeg"];
const textDecoder = new TextDecoder("utf-8", { fatal: false });

export function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

export function isSupportedFile(fileName: string): boolean {
  return [".pdf", ".docx", ".doc", ...supportedImageTypes, ...supportedTextTypes].includes(getFileExtension(fileName));
}

function extractKeywords(text: string, conceptMap: KnowledgeConcept[]): string[] {
  const conceptNames = conceptMap.filter((concept) => text.includes(concept.name)).map((concept) => concept.name);
  const terms = Array.from(text.matchAll(/[A-Za-z][A-Za-z0-9-]{2,}|[\u4e00-\u9fa5]{2,8}/g))
    .map((match) => match[0])
    .filter((term) => !/^(the|and|for|with|this|that|from|into|一个|这个|以及|可以|进行|当前)$/.test(term.toLowerCase()));
  return Array.from(new Set([...conceptNames, ...terms])).slice(0, 12);
}

export function splitIntoChunks(text: string, fileName: string, conceptMap: KnowledgeConcept[]): CourseChunk[] {
  const sections = text
    .split(/\n(?=#{1,3}\s+)/g)
    .map((section) => section.trim())
    .filter(Boolean);
  const rawSections = sections.length > 0 ? sections : [text.trim()];
  const fallbackSections = rawSections.flatMap((section) => section.match(/[\s\S]{1,900}/g) ?? []).slice(0, 80);
  return fallbackSections.map((section, index) => {
    const titleMatch = section.match(/^#{1,3}\s+(.+)$/m);
    const title = titleMatch?.[1]?.trim() || `片段 ${index + 1}`;
    const concepts = conceptMap
      .filter((concept) => section.includes(concept.name))
      .map((concept) => concept.id)
      .slice(0, 8);
    return {
      id: `${fileName.replace(/\W+/g, "_")}_chunk_${index + 1}`,
      index,
      section: title,
      content: section,
      text: section,
      sourceTitle: fileName,
      concepts,
      keywords: extractKeywords(section, conceptMap),
      source: { document: fileName, section: title, chunkId: `${fileName}_chunk_${index + 1}` }
    };
  });
}

export function extractConcepts(text: string): KnowledgeConcept[] {
  const concepts = new Map<string, KnowledgeConcept>();
  initialConcepts.forEach((concept) => {
    const names = [concept.name, concept.canonicalName, ...(concept.aliases ?? [])].filter((name): name is string => Boolean(name));
    if (names.some((name) => text.includes(name))) concepts.set(concept.normalizedKey || concept.name, concept);
  });

  const headingMatches = Array.from(text.matchAll(/^#{1,3}\s+(.+)$/gm)).map((match) => match[1].trim());
  const quotedMatches = Array.from(text.matchAll(/[\u201c"\u300a《]([^\u201d"\u300b》]{2,18})[\u201d"\u300b》]/g)).map((match) => match[1].trim());
  const llmCandidates = [...headingMatches, ...quotedMatches]
    .filter((name) => name && name.length <= 40)
    .map((name) => ({
      name,
      confidence: 0.62,
      shouldAddToCourse: true,
      reason: "从上传资料标题或强调文本中抽取",
      contextRole: "main_topic" as const,
      candidateType: "concept" as const,
      educationalValue: 0.62,
      noiseRisk: 0.32,
      granularity: "good" as const
    }));

  const extraction = processConceptExtraction({
    sourceType: "document",
    rawText: text,
    contextText: text.slice(0, 6000),
    knownConcepts: initialConcepts,
    pendingCandidates: [],
    llmCandidates
  });

  extraction.acceptedCandidates.forEach((candidate) => {
    if (!concepts.has(candidate.normalizedKey)) {
      concepts.set(candidate.normalizedKey, {
        id: conceptIdFromName(candidate.canonicalName),
        name: candidate.canonicalName,
        canonicalName: candidate.canonicalName,
        aliases: candidate.aliases,
        normalizedKey: candidate.normalizedKey,
        category: candidate.suggestedCategory || "待确认新概念",
        status: "candidate",
        confidence: candidate.extractionConfidence ?? 0.62,
        reason: candidate.reason
      });
    }
  });

  return Array.from(concepts.values()).slice(0, 24);
}
function decodePdfLiteral(value: string) {
  return value
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\\d{1,3}/g, " ")
    .trim();
}

function decodePdfHex(value: string) {
  const clean = value.replace(/\s+/g, "");
  const bytes = clean.match(/.{1,2}/g)?.map((part) => Number.parseInt(part, 16)).filter((item) => Number.isFinite(item)) ?? [];
  return textDecoder.decode(new Uint8Array(bytes)).trim();
}

async function parsePdfFile(file: File): Promise<string> {
  const latin = new TextDecoder("latin1").decode(await file.arrayBuffer());
  const literalText = Array.from(latin.matchAll(/\(([^()]{3,})\)\s*Tj/g)).map((match) => decodePdfLiteral(match[1]));
  const arrayText = Array.from(latin.matchAll(/\[((?:.|\n){10,}?)\]\s*TJ/g)).flatMap((match) =>
    Array.from(match[1].matchAll(/\(([^()]{2,})\)|<([A-Fa-f0-9\s]{4,})>/g)).map((item) => (item[1] ? decodePdfLiteral(item[1]) : decodePdfHex(item[2])))
  );
  const hexText = Array.from(latin.matchAll(/<([A-Fa-f0-9\s]{6,})>\s*Tj/g)).map((match) => decodePdfHex(match[1]));
  const text = [...literalText, ...arrayText, ...hexText].join(" ").replace(/\s+/g, " ").trim();
  if (text.length < 30) throw new Error("该 PDF 可能是扫描版、加密文件，或文本经过压缩编码，未提取到可用文本。");
  return `# ${file.name}\n\n${text}`;
}

function readUInt32LE(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function readUInt16LE(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

async function inflateRaw(bytes: Uint8Array) {
  if (typeof DecompressionStream === "undefined") throw new Error("当前浏览器不支持 DOCX 解压，请换用现代浏览器或上传 txt/md。");
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(buffer: ArrayBuffer, targetName: string): Promise<string | null> {
  const view = new DataView(buffer);
  let offset = 0;
  while (offset + 30 < buffer.byteLength) {
    if (readUInt32LE(view, offset) !== 0x04034b50) break;
    const compression = readUInt16LE(view, offset + 8);
    const compressedSize = readUInt32LE(view, offset + 18);
    const uncompressedSize = readUInt32LE(view, offset + 22);
    const nameLength = readUInt16LE(view, offset + 26);
    const extraLength = readUInt16LE(view, offset + 28);
    const nameStart = offset + 30;
    const name = textDecoder.decode(new Uint8Array(buffer, nameStart, nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    if (name === targetName) {
      const compressed = new Uint8Array(buffer, dataStart, compressedSize);
      const data = compression === 0 ? compressed : compression === 8 ? await inflateRaw(compressed) : null;
      if (!data) throw new Error("DOCX 使用了当前不支持的压缩方式。");
      if (uncompressedSize && data.length === 0) throw new Error("DOCX 解压失败，未读取到正文。");
      return textDecoder.decode(data);
    }
    offset = dataStart + compressedSize;
  }
  return null;
}

function xmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

async function parseDocxFile(file: File): Promise<string> {
  const documentXml = await readZipEntry(await file.arrayBuffer(), "word/document.xml");
  if (!documentXml) throw new Error("DOCX 解析失败，未找到正文 document.xml。");
  const paragraphs = documentXml
    .split(/<\/w:p>/)
    .map((paragraph) =>
      Array.from(paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
        .map((match) => xmlText(match[1]))
        .join("")
        .trim()
    )
    .filter(Boolean);
  const text = paragraphs.join("\n\n").trim();
  if (text.length < 20) throw new Error("DOCX 解析完成，但未提取到足够的正文内容。");
  return `# ${file.name}\n\n${text}`;
}

export async function parseDocumentFile(file: File, onState?: (state: UploadState) => void): Promise<ParsedDocument> {
  const extension = getFileExtension(file.name);
  if (!isSupportedFile(file.name)) throw new Error("暂不支持该文件类型，请上传 txt/md/pdf/docx。");
  if (extension === ".doc") throw new Error("暂不支持 .doc，请转换为 .docx 后上传。");
  if (supportedImageTypes.includes(extension)) throw new Error("暂不支持图片文字识别，请上传 txt/md/pdf/docx，或先将图片内容转为文字。");

  onState?.({ progress: 12, status: "reading", message: "正在读取文件..." });
  let text = "";

  try {
    if (supportedTextTypes.includes(extension)) {
      text = await file.text();
    } else if (extension === ".pdf") {
      onState?.({ progress: 32, status: "parsing", message: "正在解析 PDF 文本..." });
      text = await parsePdfFile(file);
    } else if (extension === ".docx") {
      onState?.({ progress: 35, status: "parsing", message: "正在解析 Word 文档..." });
      text = await parseDocxFile(file);
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "文件解析失败。");
  }

  if (!text.trim()) throw new Error("文件解析完成，但没有提取到文本内容。");

  onState?.({ progress: 72, status: "parsing", message: "正在抽取知识点并切分片段..." });
  const concepts = extractConcepts(text);
  const chunks = splitIntoChunks(text, file.name, concepts.length > 0 ? concepts : initialConcepts);
  if (chunks.length === 0) throw new Error("已提取文本，但未能生成可用片段。");
  onState?.({ progress: 100, status: "ready", message: `解析成功：生成 ${chunks.length} 个片段，抽取 ${concepts.length} 个知识点。` });

  return {
    id: `doc_${Date.now()}`,
    fileName: file.name,
    fileType: extension.replace(".", ""),
    status: "ready",
    text,
    chunks,
    concepts,
    updatedAt: new Date().toLocaleString()
  };
}

