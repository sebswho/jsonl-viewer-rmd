export type ViewerFileSource = "picker" | "input" | "drop" | "restored";
export type ViewerFileFormat = "json" | "jsonl";
export type ViewerSortOrder = "asc" | "desc";

export interface ViewerRecord {
  id: number;
  raw: string;
  parsed: unknown | null;
  size: number;
  error?: string;
}

export interface ViewerFile {
  id: string;
  name: string;
  format: ViewerFileFormat;
  source: ViewerFileSource;
  isRestorable: boolean;
  isRestored: boolean;
  handle?: FileSystemFileHandle;
  jsonIsArray?: boolean;
  isDirty?: boolean;
  lines: ViewerRecord[];
  filter: string;
  sortOrder: ViewerSortOrder;
}

export interface ParseViewerFileInput {
  id: string;
  name: string;
  content: string;
  source: ViewerFileSource;
  handle?: FileSystemFileHandle;
}

export class ViewerFileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViewerFileParseError";
  }
}

function detectViewerFileFormat(name: string): ViewerFileFormat {
  return name.toLowerCase().endsWith(".json") &&
    !name.toLowerCase().endsWith(".jsonl")
    ? "json"
    : "jsonl";
}

function toJsonRecords(parsed: unknown): ViewerRecord[] {
  if (Array.isArray(parsed)) {
    return parsed.map((value, index) => formatJsonRecord(index + 1, value));
  }

  return [formatJsonRecord(1, parsed)];
}

function formatJsonRecord(id: number, value: unknown): ViewerRecord {
  const raw = JSON.stringify(value);
  return {
    id,
    raw,
    parsed: value,
    size: new TextEncoder().encode(raw).length,
  };
}

function parseJsonlRecords(content: string): ViewerRecord[] {
  const encoder = new TextEncoder();

  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((raw, index) => {
      const size = encoder.encode(raw).length;

      try {
        return {
          id: index + 1,
          raw,
          parsed: JSON.parse(raw),
          size,
        };
      } catch {
        return {
          id: index + 1,
          raw,
          parsed: null,
          size,
          error: "无效 JSON",
        };
      }
    });
}

export function parseViewerFile(input: ParseViewerFileInput): ViewerFile {
  const format = detectViewerFileFormat(input.name);
  let lines: ViewerRecord[];
  let jsonIsArray = false;

  if (format === "json") {
    try {
      const parsed = JSON.parse(input.content);
      jsonIsArray = Array.isArray(parsed);
      lines = toJsonRecords(parsed);
    } catch {
      throw new ViewerFileParseError("JSON 文件解析失败");
    }
  } else {
    lines = parseJsonlRecords(input.content);
  }

  return {
    id: input.id,
    name: input.name,
    format,
    source: input.source,
    isRestorable:
      (input.source === "picker" || input.source === "restored") &&
      input.handle !== undefined,
    isRestored: input.source === "restored",
    handle: input.handle,
    jsonIsArray: format === "json" ? jsonIsArray : undefined,
    lines,
    filter: "",
    sortOrder: "asc",
  };
}

export function reparseRecord(raw: string): {
  parsed: unknown | null;
  error: string | undefined;
} {
  try {
    return { parsed: JSON.parse(raw), error: undefined };
  } catch (error) {
    return {
      parsed: null,
      error: error instanceof Error ? error.message : "无效 JSON",
    };
  }
}

export function serializeViewerFile(file: ViewerFile): string {
  if (file.format === "jsonl") {
    return file.lines.map((line) => line.raw).join("\n");
  }

  const values = file.lines.map((line) => line.parsed);
  return JSON.stringify(file.jsonIsArray ? values : (values[0] ?? null), null, 2);
}
