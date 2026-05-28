import type { CourseChunk, KnowledgeConcept, ParsedDocument, UploadState } from "../types";
import { initialConcepts } from "../data/demoCourse";
import { conceptIdFromName } from "./masteryService";

const supportedTextTypes = [".md", ".txt"];
const supportedImageTypes = [".png", ".jpg", ".jpeg"];

export function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

export function isSupportedFile(fileName: string): boolean {
  return [".pdf", ".docx", ".doc", ...supportedImageTypes, ...supportedTextTypes].includes(getFileExtension(fileName));
}

export function splitIntoChunks(text: string, fileName: string, conceptMap: KnowledgeConcept[]): CourseChunk[] {
  const sections = text
    .split(/\n(?=#{1,3}\s+)/g)
    .map((section) => section.trim())
    .filter(Boolean);
  const fallbackSections = sections.length > 0 ? sections : text.match(/[\s\S]{1,900}/g) ?? [];
  return fallbackSections.map((section, index) => {
    const titleMatch = section.match(/^#{1,3}\s+(.+)$/m);
    const title = titleMatch?.[1]?.trim() || `片段 ${index + 1}`;
    const concepts = conceptMap
      .filter((concept) => section.includes(concept.name))
      .map((concept) => concept.id)
      .slice(0, 8);
    return {
      id: `${fileName.replace(/\W+/g, "_")}_chunk_${index + 1}`,
      section: title,
      content: section,
      concepts,
      source: { document: fileName, section: title, chunkId: `${fileName}_chunk_${index + 1}` }
    };
  });
}

export function extractConcepts(text: string): KnowledgeConcept[] {
  const concepts = new Map<string, KnowledgeConcept>();
  initialConcepts.forEach((concept) => {
    if (text.includes(concept.name)) concepts.set(concept.name, concept);
  });

  const headingMatches = Array.from(text.matchAll(/^#{1,3}\s+(.+)$/gm)).map((match) => match[1].trim());
  const quotedMatches = Array.from(text.matchAll(/[“"《]([^”"》]{2,18})[”"》]/g)).map((match) => match[1].trim());
  [...headingMatches, ...quotedMatches].forEach((name) => {
    if (!name || name.length > 20) return;
    if (!concepts.has(name)) {
      concepts.set(name, {
        id: conceptIdFromName(name),
        name,
        category: "待确认新概念",
        status: "candidate",
        confidence: 0.62,
        reason: "从上传资料标题或强调文本中抽取"
      });
    }
  });

  return Array.from(concepts.values()).slice(0, 24);
}

async function parsePdf(file: File): Promise<{ text: string; partial: boolean }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const latin = new TextDecoder("latin1").decode(bytes);
  const chunks = Array.from(latin.matchAll(/\(([^()]{8,})\)\s*Tj/g)).map((match) => match[1]);
  const arrays = Array.from(latin.matchAll(/\[((?:.|\n){10,}?)\]\s*TJ/g)).flatMap((match) =>
    Array.from(match[1].matchAll(/\(([^()]{3,})\)/g)).map((item) => item[1])
  );
  const text = [...chunks, ...arrays]
    .join(" ")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 30) {
    return {
      partial: true,
      text: `# ${file.name}\n\nPDF 文件已上传。当前 Demo 使用浏览器端轻量解析，未能稳定提取正文。建议同时上传 Markdown/TXT，或在后续版本启用后端 pdfplumber/pypdf。`
    };
  }
  return { partial: false, text: `# ${file.name}\n\n${text}` };
}

async function parseDocx(file: File): Promise<{ text: string; partial: boolean }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const extracted = Array.from(text.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) => match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"))
    .join("");
  if (extracted.trim().length < 20) {
    return {
      partial: true,
      text: `# ${file.name}\n\nDOCX 文件已上传。当前无 mammoth 依赖，轻量解析未能稳定提取正文。建议另存为 TXT/Markdown 上传；后续可接入 mammoth 或 Python 后端 python-docx。`
    };
  }
  return { partial: false, text: `# ${file.name}\n\n${extracted}` };
}

async function parseImage(file: File): Promise<{ text: string; partial: boolean }> {
  return {
    partial: true,
    text: `# ${file.name}\n\n图片已上传。当前版本无额外 OCR 依赖，已记录为资料文件；建议补充 Markdown/TXT，或在模型设置中使用支持视觉能力的 Provider 做后续识别。`
  };
}

export async function parseDocumentFile(file: File, onState?: (state: UploadState) => void): Promise<ParsedDocument> {
  const extension = getFileExtension(file.name);
  if (!isSupportedFile(file.name)) {
    throw new Error("暂不支持该文件类型，请上传 PDF、DOCX、PNG/JPG、Markdown 或 TXT。");
  }
  if (extension === ".doc") {
    throw new Error("浏览器端暂不支持旧版 .doc 解析，请将文件另存为 .docx 后上传。");
  }

  onState?.({ progress: 12, status: "reading", message: "正在读取文件..." });
  let text = "";
  let partial = false;

  try {
    if (supportedTextTypes.includes(extension)) {
      text = await file.text();
    } else if (extension === ".pdf") {
      onState?.({ progress: 32, status: "parsing", message: "正在解析 PDF 文本..." });
      const result = await parsePdf(file);
      text = result.text;
      partial = result.partial;
    } else if (extension === ".docx") {
      onState?.({ progress: 35, status: "parsing", message: "正在解析 Word 文档..." });
      const result = await parseDocx(file);
      text = result.text;
      partial = result.partial;
    } else if (supportedImageTypes.includes(extension)) {
      onState?.({ progress: 35, status: "parsing", message: "正在记录图片资料..." });
      const result = await parseImage(file);
      text = result.text;
      partial = result.partial;
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "文件解析失败。");
  }

  if (!text.trim()) throw new Error("文件解析完成，但没有提取到文本内容。");

  onState?.({ progress: 72, status: "parsing", message: "正在抽取知识点并切分片段..." });
  const concepts = extractConcepts(text);
  const chunks = splitIntoChunks(text, file.name, concepts.length > 0 ? concepts : initialConcepts);
  onState?.({ progress: 100, status: partial ? "partial" : "ready", message: partial ? "上传成功，部分解析可用" : "解析成功" });

  return {
    id: `doc_${Date.now()}`,
    fileName: file.name,
    fileType: extension.replace(".", ""),
    status: partial ? "partial" : "ready",
    text,
    chunks,
    concepts,
    updatedAt: new Date().toLocaleString()
  };
}
