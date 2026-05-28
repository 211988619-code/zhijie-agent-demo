import { UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import type { ParsedDocument, UploadState } from "../types";
import { parseDocumentFile } from "../services/documentParser";

type Props = {
  onParsed: (document: ParsedDocument) => void;
};

export function FileUploader({ onParsed }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<UploadState>({ progress: 0, status: "idle", message: "支持 PDF、DOCX、图片、Markdown、TXT" });

  const handleFile = async (file?: File) => {
    if (!file) return;
    setState({ progress: 4, status: "reading", message: `读取 ${file.name}` });
    try {
      const parsed = await parseDocumentFile(file, setState);
      onParsed(parsed);
    } catch (error) {
      setState({ progress: 100, status: "failed", message: error instanceof Error ? error.message : "解析失败" });
    }
  };

  return (
    <div
      className={`upload-zone ${dragging ? "dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void handleFile(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.md,.txt"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <button className="upload-button" onClick={() => inputRef.current?.click()}>
        <UploadCloud size={19} />
        选择或拖拽上传资料
      </button>
      <p>{state.message}</p>
      <div className="upload-progress">
        <span className={state.status === "failed" ? "level-red" : state.status === "partial" ? "level-orange" : "level-green"} style={{ width: `${state.progress}%` }} />
      </div>
    </div>
  );
}
