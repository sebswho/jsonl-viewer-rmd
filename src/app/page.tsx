"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, type ListImperativeAPI } from "react-window";
import styles from "./page.module.css";
import {
  AlertCircle,
  ArrowDown,
  ArrowDownAz,
  ArrowUp,
  ArrowUpAz,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  FileUp,
  FolderOpen,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  parseViewerFile,
  ViewerFileParseError,
  type ViewerFile,
  type ViewerFileSource,
} from "@/lib/viewer-file";
import {
  clearViewerSession,
  loadViewerSession,
  saveViewerSession,
  type PersistedViewerFile,
  type ViewerViewTab,
} from "@/lib/session-store";

const FILE_ACCEPT = ".jsonl,.json,.log,.txt";

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle[]>;
};

interface Notice {
  kind: "error" | "info";
  message: string;
}

function createFileId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function unescapeString(str: string): string {
  if (typeof str !== "string") return String(str);
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function getValuePreview(value: unknown, maxLen: number = 50): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const preview =
      value.length > maxLen ? value.substring(0, maxLen) + "..." : value;
    return `"${preview}"`;
  }
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return `{${keys.length} keys}`;
  }
  return String(value);
}

function getValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

interface TreeNodeProps {
  keyName: string;
  value: unknown;
  depth: number;
  path: string;
  selectedPath: string | null;
  onSelect: (path: string, value: unknown) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
}

function TreeNode({
  keyName,
  value,
  depth,
  path,
  selectedPath,
  onSelect,
  expandedPaths,
  onToggleExpand,
}: TreeNodeProps) {
  const isExpandable = value !== null && typeof value === "object";
  const isExpanded = expandedPaths.has(path);
  const isSelected = selectedPath === path;
  const valueType = getValueType(value);

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onSelect(path, value);
  };

  const handleToggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (isExpandable) {
      onToggleExpand(path);
    }
  };

  return (
    <div className={styles.treeNode}>
      <div
        className={`${styles.treeNodeRow} ${isSelected ? styles.treeNodeSelected : ""}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={handleClick}
      >
        {isExpandable ? (
          <button className={styles.treeToggle} onClick={handleToggle}>
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className={styles.treeTogglePlaceholder} />
        )}
        <span className={`${styles.treeKey} mono`}>{keyName}</span>
        <span className={styles.treeSeparator}>:</span>
        <span
          className={`${styles.treeValue} ${styles[`treeValue_${valueType}`]} mono`}
        >
          {getValuePreview(value)}
        </span>
      </div>
      {isExpandable && isExpanded && (
        <div>
          {Array.isArray(value)
            ? value.map((item, index) => (
                <TreeNode
                  key={index}
                  keyName={`[${index}]`}
                  value={item}
                  depth={depth + 1}
                  path={`${path}[${index}]`}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  expandedPaths={expandedPaths}
                  onToggleExpand={onToggleExpand}
                />
              ))
            : Object.entries(value as Record<string, unknown>).map(([k, v]) => (
                <TreeNode
                  key={k}
                  keyName={k}
                  value={v}
                  depth={depth + 1}
                  path={`${path}.${k}`}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  expandedPaths={expandedPaths}
                  onToggleExpand={onToggleExpand}
                />
              ))}
        </div>
      )}
    </div>
  );
}

function collectAllPaths(value: unknown, path: string = "root"): string[] {
  const paths: string[] = [path];
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        paths.push(...collectAllPaths(item, `${path}[${index}]`));
      });
    } else {
      Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
        paths.push(...collectAllPaths(v, `${path}.${k}`));
      });
    }
  }
  return paths;
}

function getValueAtPath(data: unknown, path: string): unknown | undefined {
  if (path === "root") return data;

  const parts: string[] = [];
  let current = path.replace(/^root\.?/, "");

  while (current.length > 0) {
    const arrayMatch = current.match(/^\[(\d+)\]/);
    const propMatch = current.match(/^\.?([^.[]+)/);

    if (arrayMatch) {
      parts.push(arrayMatch[1]);
      current = current.slice(arrayMatch[0].length);
    } else if (propMatch) {
      parts.push(propMatch[1]);
      current = current.slice(propMatch[0].length);
    } else {
      break;
    }
  }

  let result: unknown = data;
  for (const part of parts) {
    if (result === null || typeof result !== "object") {
      return undefined;
    }
    if (Array.isArray(result)) {
      const index = Number.parseInt(part, 10);
      if (Number.isNaN(index) || index < 0 || index >= result.length) {
        return undefined;
      }
      result = result[index];
    } else {
      if (!(part in (result as Record<string, unknown>))) {
        return undefined;
      }
      result = (result as Record<string, unknown>)[part];
    }
  }
  return result;
}

interface TreeViewProps {
  data: unknown;
  externalSelectedPath?: string | null;
  onPathChange?: (path: string | null) => void;
}

function TreeView({ data, externalSelectedPath, onPathChange }: TreeViewProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<unknown>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    new Set(["root"]),
  );
  const [copied, setCopied] = useState(false);
  const [isAllExpanded, setIsAllExpanded] = useState(false);

  useEffect(() => {
    if (externalSelectedPath) {
      const value = getValueAtPath(data, externalSelectedPath);
      if (value !== undefined) {
        setSelectedPath(externalSelectedPath);
        setSelectedValue(value);

        const pathParts: string[] = [];
        let current = externalSelectedPath;
        while (current && current !== "root") {
          pathParts.unshift(current);
          const lastDot = current.lastIndexOf(".");
          const lastBracket = current.lastIndexOf("[");
          const lastSeparator = Math.max(lastDot, lastBracket);
          if (lastSeparator > 0) {
            current = current.substring(0, lastSeparator);
          } else {
            current = "root";
          }
        }

        setExpandedPaths((previous) => {
          const next = new Set(previous);
          next.add("root");
          pathParts.forEach((pathPart) => {
            let parent = pathPart;
            while (parent && parent !== "root") {
              const lastDot = parent.lastIndexOf(".");
              const lastBracket = parent.lastIndexOf("[");
              const lastSeparator = Math.max(lastDot, lastBracket);
              if (lastSeparator > 0) {
                parent = parent.substring(0, lastSeparator);
                next.add(parent);
              } else {
                break;
              }
            }
          });
          return next;
        });
      } else {
        setSelectedPath(null);
        setSelectedValue(null);
        onPathChange?.(null);
      }
    }
  }, [data, externalSelectedPath, onPathChange]);

  const handleSelect = useCallback(
    (path: string, value: unknown) => {
      setSelectedPath(path);
      setSelectedValue(value);
      onPathChange?.(path);
    },
    [onPathChange],
  );

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleExpandCollapseAll = useCallback(() => {
    if (isAllExpanded) {
      setExpandedPaths(new Set(["root"]));
      setIsAllExpanded(false);
    } else {
      setExpandedPaths(new Set(collectAllPaths(data)));
      setIsAllExpanded(true);
    }
  }, [data, isAllExpanded]);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }, []);

  const formattedValue = useMemo(() => {
    if (selectedValue === null) return "null";
    if (selectedValue === undefined) return "undefined";
    if (typeof selectedValue === "string") {
      return unescapeString(selectedValue);
    }
    if (typeof selectedValue === "object") {
      try {
        return unescapeString(JSON.stringify(selectedValue, null, 2));
      } catch {
        return String(selectedValue);
      }
    }
    return String(selectedValue);
  }, [selectedValue]);

  if (data === null || typeof data !== "object") {
    return <div className={styles.treeEmpty}>当前值不是对象或数组</div>;
  }

  return (
    <div className={styles.treeViewContainer}>
      <div className={styles.treePanel}>
        <div className={styles.treePanelHeader}>
          <span>结构</span>
          <button
            className={styles.expandCollapseBtn}
            onClick={handleExpandCollapseAll}
            title={isAllExpanded ? "全部收起" : "全部展开"}
          >
            {isAllExpanded ? (
              <ListChevronsUpDown size={14} />
            ) : (
              <ListChevronsDownUp size={14} />
            )}
          </button>
        </div>
        <div className={styles.treePanelContent}>
          <TreeNode
            keyName="root"
            value={data}
            depth={0}
            path="root"
            selectedPath={selectedPath}
            onSelect={handleSelect}
            expandedPaths={expandedPaths}
            onToggleExpand={handleToggleExpand}
          />
        </div>
      </div>
      <div className={styles.treeValuePanel}>
        <div className={styles.treePanelHeader}>
          <span>
            值
            {selectedPath && (
              <span className={`${styles.treePathLabel} mono`}>
                {selectedPath}
              </span>
            )}
          </span>
          {selectedValue !== null && (
            <button
              className={`${styles.copyBtn} ${copied ? styles.copied : ""}`}
              onClick={() => handleCopy(formattedValue)}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "已复制" : "复制"}
            </button>
          )}
        </div>
        <div className={styles.treeValueContent}>
          {selectedValue !== null ? (
            <pre className={`${styles.treeValuePre} mono`}>
              {formattedValue}
            </pre>
          ) : (
            <div className={styles.treeValueEmpty}>点击左侧节点查看值</div>
          )}
        </div>
      </div>
    </div>
  );
}

function JsonSyntaxHighlight({ json }: { json: string }) {
  const highlightJson = (text: string) => {
    const tokens: { type: string; value: string }[] = [];
    let index = 0;

    while (index < text.length) {
      const char = text[index];

      if (/\s/.test(char)) {
        let whitespace = "";
        while (index < text.length && /\s/.test(text[index])) {
          whitespace += text[index++];
        }
        tokens.push({ type: "whitespace", value: whitespace });
        continue;
      }

      if (char === '"') {
        let str = '"';
        index++;
        while (index < text.length && text[index] !== '"') {
          if (text[index] === "\\" && index + 1 < text.length) {
            str += text[index++];
          }
          str += text[index++];
        }
        if (index < text.length) str += text[index++];

        let lookahead = index;
        while (lookahead < text.length && /\s/.test(text[lookahead])) {
          lookahead++;
        }
        tokens.push({
          type: text[lookahead] === ":" ? "key" : "string",
          value: str,
        });
        continue;
      }

      if (/[-\d]/.test(char)) {
        let numberToken = "";
        while (index < text.length && /[-\d.eE+]/.test(text[index])) {
          numberToken += text[index++];
        }
        tokens.push({ type: "number", value: numberToken });
        continue;
      }

      if (text.slice(index, index + 4) === "true") {
        tokens.push({ type: "boolean", value: "true" });
        index += 4;
        continue;
      }
      if (text.slice(index, index + 5) === "false") {
        tokens.push({ type: "boolean", value: "false" });
        index += 5;
        continue;
      }
      if (text.slice(index, index + 4) === "null") {
        tokens.push({ type: "null", value: "null" });
        index += 4;
        continue;
      }

      if ("{}[],:".includes(char)) {
        tokens.push({ type: "punctuation", value: char });
        index++;
        continue;
      }

      tokens.push({ type: "other", value: char });
      index++;
    }

    return tokens;
  };

  const tokens = highlightJson(json);

  return (
    <pre className={`${styles.prettyContent} mono`}>
      {tokens.map((token, index) => (
        <span
          key={index}
          className={
            styles[
              `token${token.type.charAt(0).toUpperCase() + token.type.slice(1)}`
            ]
          }
        >
          {token.value}
        </span>
      ))}
    </pre>
  );
}

function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return "无法格式化当前记录";
  }
}

function createNoticeMessage(name: string, error: unknown): string {
  if (error instanceof ViewerFileParseError) {
    return `${name} 打开失败：${error.message}`;
  }
  return `${name} 打开失败，请重试。`;
}

async function createViewerFileFromFile(
  file: File,
  source: ViewerFileSource,
): Promise<ViewerFile> {
  const content = await file.text();
  return parseViewerFile({
    id: createFileId(),
    name: file.name,
    content,
    source,
  });
}

async function createViewerFileFromHandle(
  handle: FileSystemFileHandle,
  source: ViewerFileSource,
  id?: string,
): Promise<ViewerFile> {
  const file = await handle.getFile();
  const content = await file.text();
  return parseViewerFile({
    id: id ?? createFileId(),
    name: file.name,
    content,
    source,
    handle,
  });
}

export default function Home() {
  const [files, setFiles] = useState<ViewerFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [viewTab, setViewTab] = useState<ViewerViewTab>("pretty");
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [rememberSession, setRememberSession] = useState(true);
  const [showLineSize, setShowLineSize] = useState(true);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [listHeight, setListHeight] = useState(400);
  const [treePath, setTreePath] = useState<string | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const splitViewRef = useRef<HTMLDivElement>(null);
  const detailContentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<ListImperativeAPI>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isResizing = useRef(false);

  const activeFile = useMemo(
    () => files.find((file) => file.id === activeFileId) ?? null,
    [files, activeFileId],
  );
  const lines = activeFile?.lines ?? [];
  const filter = activeFile?.filter ?? "";
  const sortOrder = activeFile?.sortOrder ?? "asc";

  const restorableFiles = useMemo(
    () =>
      files.filter(
        (file): file is ViewerFile & { handle: FileSystemFileHandle } =>
          file.isRestorable && file.handle !== undefined,
      ),
    [files],
  );

  const displayLines = useMemo(() => {
    let result = lines;
    if (filter.trim()) {
      const lowerFilter = filter.toLowerCase();
      result = lines.filter((line) => line.raw.toLowerCase().includes(lowerFilter));
    }
    if (sortOrder === "desc") {
      result = [...result].reverse();
    }
    return result;
  }, [filter, lines, sortOrder]);

  const currentIndex = useMemo(() => {
    if (selectedId === null) return -1;
    return displayLines.findIndex((line) => line.id === selectedId);
  }, [displayLines, selectedId]);

  const selectedLine = useMemo(() => {
    if (selectedId === null) return null;
    return lines.find((line) => line.id === selectedId) ?? null;
  }, [lines, selectedId]);

  const isAtFirst = currentIndex <= 0;
  const isAtLast =
    currentIndex === -1 || currentIndex >= displayLines.length - 1;

  const showNotice = useCallback((kind: Notice["kind"], message: string) => {
    setNotice({ kind, message });
  }, []);

  const appendOpenedFiles = useCallback((openedFiles: ViewerFile[]) => {
    if (openedFiles.length === 0) return;
    setFiles((previous) => [...previous, ...openedFiles]);
    setActiveFileId(openedFiles[openedFiles.length - 1].id);
    setSelectedId(null);
    setTreePath(null);
  }, []);

  const openEphemeralFiles = useCallback(
    async (browserFiles: File[], source: "drop" | "input") => {
      const openedFiles: ViewerFile[] = [];
      const errors: string[] = [];

      for (const file of browserFiles) {
        try {
          openedFiles.push(await createViewerFileFromFile(file, source));
        } catch (error) {
          errors.push(createNoticeMessage(file.name, error));
        }
      }

      appendOpenedFiles(openedFiles);
      if (errors.length > 0) {
        showNotice("error", errors.join("；"));
      }
    },
    [appendOpenedFiles, showNotice],
  );

  const openPickerFiles = useCallback(async () => {
    const pickerWindow = window as FilePickerWindow;
    if (!pickerWindow.showOpenFilePicker) {
      showNotice("error", "当前浏览器不支持原生文件恢复，请使用 Chromium 浏览器。");
      return;
    }

    try {
      const handles = await pickerWindow.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "JSON 数据文件",
            accept: {
              "application/json": [".json", ".jsonl"],
              "text/plain": [".log", ".txt"],
            },
          },
        ],
      });

      const openedFiles: ViewerFile[] = [];
      const errors: string[] = [];

      for (const handle of handles) {
        try {
          openedFiles.push(await createViewerFileFromHandle(handle, "picker"));
        } catch (error) {
          errors.push(createNoticeMessage(handle.name, error));
        }
      }

      appendOpenedFiles(openedFiles);
      if (errors.length > 0) {
        showNotice("error", errors.join("；"));
      }
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }
      showNotice("error", "打开文件失败，请重试。");
    }
  }, [appendOpenedFiles, showNotice]);

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const inputFiles = Array.from(event.target.files ?? []);
      event.target.value = "";
      void openEphemeralFiles(inputFiles, "input");
    },
    [openEphemeralFiles],
  );

  const closeFile = useCallback(
    (fileId: string, event: React.MouseEvent) => {
      event.stopPropagation();
      setFiles((previous) => {
        const newFiles = previous.filter((file) => file.id !== fileId);
        if (activeFileId === fileId) {
          const currentFileIndex = previous.findIndex((file) => file.id === fileId);
          if (newFiles.length > 0) {
            const nextActiveIndex = Math.min(currentFileIndex, newFiles.length - 1);
            setActiveFileId(newFiles[nextActiveIndex].id);
          } else {
            setActiveFileId(null);
          }
          setSelectedId(null);
          setTreePath(null);
        }
        return newFiles;
      });
    },
    [activeFileId],
  );

  const setFilter = useCallback(
    (nextFilter: string) => {
      setFiles((previous) =>
        previous.map((file) =>
          file.id === activeFileId ? { ...file, filter: nextFilter } : file,
        ),
      );
    },
    [activeFileId],
  );

  const setSortOrder = useCallback(
    (nextOrder: "asc" | "desc") => {
      setFiles((previous) =>
        previous.map((file) =>
          file.id === activeFileId ? { ...file, sortOrder: nextOrder } : file,
        ),
      );
    },
    [activeFileId],
  );

  const navigateSelection = useCallback(
    (direction: "up" | "down") => {
      if (displayLines.length === 0) return;

      const selectedIndex =
        selectedId !== null
          ? displayLines.findIndex((line) => line.id === selectedId)
          : -1;

      let nextIndex = -1;
      if (direction === "down") {
        nextIndex =
          selectedIndex < displayLines.length - 1
            ? selectedIndex + 1
            : selectedIndex;
        if (selectedIndex === -1) nextIndex = 0;
      } else {
        nextIndex = selectedIndex > 0 ? selectedIndex - 1 : selectedIndex;
        if (selectedIndex === -1) nextIndex = 0;
      }

      if (nextIndex !== -1 && nextIndex !== selectedIndex) {
        setSelectedId(displayLines[nextIndex].id);
        listRef.current?.scrollToRow({ index: nextIndex });
      }
    },
    [displayLines, selectedId],
  );

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }, []);

  const handleResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleResizeMove = (event: MouseEvent) => {
      if (!isResizing.current || !splitViewRef.current) return;
      const rect = splitViewRef.current.getBoundingClientRect();
      const newWidth = event.clientX - rect.left;
      const minWidth = 250;
      const maxWidth = rect.width * 0.5;
      setLeftPanelWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
    };

    const handleResizeEnd = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
    return () => {
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", handleResizeEnd);
    };
  }, []);

  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setListHeight(rect.height > 0 ? rect.height : 400);
      }
    };

    const resizeObserver = new ResizeObserver(updateHeight);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    const timer = setTimeout(updateHeight, 50);

    window.addEventListener("resize", updateHeight);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateHeight);
      resizeObserver.disconnect();
    };
  }, [activeFileId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "a") {
        if (
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement
        ) {
          return;
        }

        const preElement = detailContentRef.current?.querySelector("pre");
        if (preElement) {
          event.preventDefault();
          const range = document.createRange();
          range.selectNodeContents(preElement);
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
        } else if (viewTab === "tree") {
          event.preventDefault();
        }
        return;
      }

      if (event.key === "ArrowDown") {
        if (document.activeElement instanceof HTMLInputElement) return;
        event.preventDefault();
        navigateSelection("down");
      } else if (event.key === "ArrowUp") {
        if (document.activeElement instanceof HTMLInputElement) return;
        event.preventDefault();
        navigateSelection("up");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigateSelection, viewTab]);

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      setIsRestoring(true);

      try {
        const snapshot = await loadViewerSession();
        if (cancelled) return;

        setRememberSession(snapshot.rememberSession);
        setShowLineSize(snapshot.showLineSize);
        setViewTab(snapshot.viewTab);

        if (!snapshot.rememberSession || snapshot.files.length === 0) {
          return;
        }

        const restoredFiles: ViewerFile[] = [];
        const failedFiles: string[] = [];

        for (const persistedFile of snapshot.files) {
          try {
            const restored = await createViewerFileFromHandle(
              persistedFile.handle,
              "restored",
              persistedFile.id,
            );
            restoredFiles.push({
              ...restored,
              id: persistedFile.id,
              filter: persistedFile.filter,
              sortOrder: persistedFile.sortOrder,
            });
          } catch {
            failedFiles.push(persistedFile.name);
          }
        }

        if (cancelled) return;

        setFiles(restoredFiles);
        setActiveFileId(
          restoredFiles.some((file) => file.id === snapshot.activeFileId)
            ? snapshot.activeFileId
            : (restoredFiles[0]?.id ?? null),
        );

        if (failedFiles.length > 0) {
          showNotice(
            "error",
            `以下文件未能恢复：${failedFiles.join("、")}`,
          );
        }
      } catch {
        if (!cancelled) {
          showNotice("error", "读取会话失败，已跳过恢复。");
        }
      } finally {
        if (!cancelled) {
          setIsRestoring(false);
          setIsSessionReady(true);
        }
      }
    };

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [showNotice]);

  useEffect(() => {
    if (!isSessionReady) return;

    if (!rememberSession) {
      void clearViewerSession(false).catch(() => {
        showNotice("error", "关闭会话恢复失败，请重试。");
      });
      return;
    }

    const persistedFiles: PersistedViewerFile[] = restorableFiles.map((file) => ({
      id: file.id,
      name: file.name,
      filter: file.filter,
      sortOrder: file.sortOrder,
      handle: file.handle,
    }));

    const persistedActiveFileId = persistedFiles.some(
      (file) => file.id === activeFileId,
    )
      ? activeFileId
      : (persistedFiles[0]?.id ?? null);

    void saveViewerSession({
      rememberSession: true,
      activeFileId: persistedActiveFileId,
      viewTab,
      showLineSize,
      files: persistedFiles,
    }).catch(() => {
      showNotice("error", "保存会话失败，请重试。");
    });
  }, [
    activeFileId,
    isSessionReady,
    rememberSession,
    restorableFiles,
    showLineSize,
    showNotice,
    viewTab,
  ]);

  const handleClearSession = useCallback(() => {
    setRememberSession(false);
    showNotice("info", "已关闭会话恢复，并清除浏览器中的恢复记录。");
  }, [showNotice]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (event.currentTarget === event.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      void openEphemeralFiles(Array.from(event.dataTransfer.files), "drop");
    },
    [openEphemeralFiles],
  );

  return (
    <main
      className={styles.main}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className={styles.dragOverlay}>
          <div className={styles.dragOverlayContent}>
            <FileUp size={48} />
            <p>释放文件以导入当前会话</p>
          </div>
        </div>
      )}

      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.logo}>
            <span className={styles.logoIcon}>{"{}"}</span>
            <span>JSON 查看器</span>
          </h1>
        </div>

        <div className={styles.headerRight}>
          <button className={styles.addFileBtn} onClick={() => void openPickerFiles()}>
            <FolderOpen size={16} />
            打开文件
          </button>

          <label className={styles.addFileBtn}>
            <FileUp size={16} />
            导入临时文件
            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_ACCEPT}
              onChange={handleFileInput}
              multiple
              style={{ display: "none" }}
            />
          </label>

          <button
            className={styles.lineSizeToggle}
            onClick={() => setRememberSession((previous) => !previous)}
            title={rememberSession ? "关闭会话恢复" : "开启会话恢复"}
            aria-pressed={rememberSession}
          >
            <span className={styles.lineSizeToggleLabel}>记住会话</span>
            <span
              className={`${styles.lineSizeToggleTrack} ${rememberSession ? styles.lineSizeToggleTrackOn : ""}`}
            >
              <span className={styles.lineSizeToggleThumb} />
            </span>
          </button>

          {rememberSession && (
            <button
              className={styles.clearBtn}
              onClick={handleClearSession}
              title="清除会话恢复记录"
            >
              <Trash2 size={14} />
              清除恢复
            </button>
          )}

          {files.length > 0 && (
            <button
              className={styles.lineSizeToggle}
              onClick={() => setShowLineSize((previous) => !previous)}
              title={showLineSize ? "隐藏行大小" : "显示行大小"}
              aria-pressed={showLineSize}
            >
              <span className={styles.lineSizeToggleLabel}>显示行大小</span>
              <span
                className={`${styles.lineSizeToggleTrack} ${showLineSize ? styles.lineSizeToggleTrackOn : ""}`}
              >
                <span className={styles.lineSizeToggleThumb} />
              </span>
            </button>
          )}

          <a
            href="https://github.com/Sylinko/jsonl-viewer"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.githubLink}
            title="查看原始仓库"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </a>
        </div>
      </header>

      {notice && (
        <div
          className={`${styles.noticeBar} ${notice.kind === "error" ? styles.noticeBarError : styles.noticeBarInfo}`}
        >
          <div className={styles.noticeContent}>
            <AlertCircle size={16} />
            <span>{notice.message}</span>
          </div>
          <button
            className={styles.noticeClose}
            onClick={() => setNotice(null)}
            title="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {files.length > 0 && (
        <div className={styles.tabBar}>
          {files.map((file) => (
            <div
              key={file.id}
              className={`${styles.fileTab} ${file.id === activeFileId ? styles.fileTabActive : ""}`}
              onClick={() => {
                setActiveFileId(file.id);
                setSelectedId(null);
                setTreePath(null);
              }}
            >
              <span className={styles.fileTabName}>{file.name}</span>
              <div className={styles.fileTabMeta}>
                <span className={styles.fileTabCount}>{file.lines.length}</span>
                {file.isRestored ? (
                  <span className={`${styles.fileTabStatus} ${styles.fileTabStatusRestored}`}>
                    已恢复
                  </span>
                ) : file.isRestorable ? (
                  <span className={`${styles.fileTabStatus} ${styles.fileTabStatusPersistent}`}>
                    可恢复
                  </span>
                ) : (
                  <span className={styles.fileTabStatus}>临时</span>
                )}
              </div>
              <button
                className={styles.fileTabClose}
                onClick={(event) => closeFile(file.id, event)}
                title="关闭标签页"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.content}>
        {files.length === 0 ? (
          <div
            className={`${styles.dropZone} ${isDragging ? styles.dropZoneActive : ""}`}
          >
            <div className={styles.dropContent}>
              <div className={styles.dropIcon}>
                <FileUp size={56} />
              </div>
              <p className={styles.dropText}>拖放 .json 或 .jsonl 文件到这里</p>
              <p className={styles.dropSubtext}>或</p>
              <div className={styles.emptyActions}>
                <button className={styles.browseBtn} onClick={() => void openPickerFiles()}>
                  打开文件
                </button>
                <label className={styles.secondaryActionBtn}>
                  导入临时文件
                  <input
                    type="file"
                    accept={FILE_ACCEPT}
                    onChange={handleFileInput}
                    multiple
                    style={{ display: "none" }}
                  />
                </label>
              </div>
              {isRestoring && (
                <p className={styles.restoreHint}>正在恢复上次会话...</p>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.splitView} ref={splitViewRef}>
            <div
              className={styles.leftPanel}
              style={leftPanelWidth !== null ? { width: leftPanelWidth } : undefined}
            >
              <div className={styles.panelHeader}>
                <span>记录</span>
                <div className={styles.leftPanelControls}>
                  <div className={styles.filterBarInline}>
                    <Search size={14} />
                    <input
                      type="text"
                      className={styles.filterInputInline}
                      placeholder="筛选内容"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                    />
                    {filter && (
                      <button
                        className={styles.clearFilterInline}
                        onClick={() => setFilter("")}
                        title="清空筛选"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <span className={styles.filterCountInline}>
                    {displayLines.length}/{lines.length}
                  </span>
                  <button
                    className={styles.sortBtn}
                    onClick={() =>
                      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
                    }
                    title={sortOrder === "asc" ? "倒序排列" : "正序排列"}
                  >
                    {sortOrder === "asc" ? (
                      <ArrowDownAz size={16} />
                    ) : (
                      <ArrowUpAz size={16} />
                    )}
                  </button>
                </div>
              </div>
              <div className={styles.listContainer} ref={containerRef}>
                <List
                  listRef={listRef}
                  style={{ height: listHeight }}
                  rowCount={displayLines.length}
                  rowHeight={36}
                  rowComponent={({
                    index,
                    style,
                  }: {
                    index: number;
                    style: React.CSSProperties;
                    ariaAttributes: {
                      "aria-posinset": number;
                      "aria-setsize": number;
                      role: "listitem";
                    };
                  }) => {
                    const line = displayLines[index];
                    const isSelected = selectedId === line.id;

                    return (
                      <div
                        style={style}
                        className={`${styles.listItem} ${isSelected ? styles.listItemSelected : ""} ${line.error ? styles.listItemError : ""}`}
                        onClick={() => setSelectedId(line.id)}
                      >
                        <span className={styles.listItemId}>{line.id}</span>
                        <span className={`${styles.listItemContent} mono`}>
                          {line.raw.length > 200
                            ? line.raw.substring(0, 200) + "..."
                            : line.raw}
                        </span>
                        {showLineSize && (
                          <span className={styles.listItemSize}>
                            {formatBytes(line.size)}
                          </span>
                        )}
                      </div>
                    );
                  }}
                  rowProps={{}}
                  overscanCount={10}
                />
              </div>
            </div>

            <div className={styles.resizer} onMouseDown={handleResizeStart} />

            <div className={styles.rightPanel}>
              {selectedLine ? (
                <>
                  <div className={styles.panelHeader}>
                    <div className={styles.tabs}>
                      <button
                        className={`${styles.tab} ${viewTab === "pretty" ? styles.tabActive : ""}`}
                        onClick={() => setViewTab("pretty")}
                      >
                        格式化
                      </button>
                      <button
                        className={`${styles.tab} ${viewTab === "raw" ? styles.tabActive : ""}`}
                        onClick={() => setViewTab("raw")}
                      >
                        原始
                      </button>
                      <button
                        className={`${styles.tab} ${viewTab === "tree" ? styles.tabActive : ""}`}
                        onClick={() => setViewTab("tree")}
                      >
                        树形
                      </button>
                    </div>
                    <div className={styles.headerRight}>
                      <div className={styles.navigationButtons}>
                        <button
                          className={`${styles.copyBtn} ${isAtFirst ? styles.disabledBtn : ""}`}
                          style={{ padding: "6px" }}
                          onClick={() => navigateSelection("up")}
                          disabled={isAtFirst}
                          title="上一条"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          className={`${styles.copyBtn} ${isAtLast ? styles.disabledBtn : ""}`}
                          style={{ padding: "6px" }}
                          onClick={() => navigateSelection("down")}
                          disabled={isAtLast}
                          title="下一条"
                        >
                          <ArrowDown size={14} />
                        </button>
                      </div>
                      {viewTab !== "tree" && (
                        <button
                          className={`${styles.copyBtn} ${copied ? styles.copied : ""}`}
                          onClick={() =>
                            void handleCopy(
                              viewTab === "raw"
                                ? selectedLine.raw
                                : formatJson(selectedLine.parsed),
                            )
                          }
                        >
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                          {copied ? "已复制" : "复制"}
                        </button>
                      )}
                      <span className={styles.detailId}>记录 #{selectedLine.id}</span>
                    </div>
                  </div>
                  <div className={styles.detailContent} ref={detailContentRef}>
                    {selectedLine.error ? (
                      <div className={styles.errorMessage}>
                        <span className={styles.errorIcon}>
                          <AlertCircle size={16} />
                        </span>
                        <span>{selectedLine.error}</span>
                        <pre className={`${styles.rawContent} mono`}>
                          {selectedLine.raw}
                        </pre>
                      </div>
                    ) : viewTab === "raw" ? (
                      <pre className={`${styles.rawContent} mono`}>
                        {selectedLine.raw}
                      </pre>
                    ) : viewTab === "tree" ? (
                      <TreeView
                        data={selectedLine.parsed}
                        externalSelectedPath={treePath}
                        onPathChange={setTreePath}
                      />
                    ) : (
                      <JsonSyntaxHighlight json={formatJson(selectedLine.parsed)} />
                    )}
                  </div>
                </>
              ) : (
                <div className={styles.emptyDetail}>
                  <File size={64} />
                  <p>选择一条记录查看详情</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
