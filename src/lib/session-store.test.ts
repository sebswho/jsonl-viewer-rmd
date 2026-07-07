import { beforeEach, describe, expect, it } from "vitest";

import {
  clearViewerSession,
  DEFAULT_VIEWER_SESSION,
  loadViewerSession,
  saveViewerSession,
  type ViewerSessionSnapshot,
} from "./session-store";

describe("viewer session store", () => {
  beforeEach(async () => {
    indexedDB.deleteDatabase("json-viewer-session");
    await clearViewerSession(true).catch(() => undefined);
  });

  it("round-trips restorable file handles and UI state", async () => {
    const snapshot: ViewerSessionSnapshot = {
      rememberSession: true,
      activeFileId: "file-1",
      viewTab: "tree",
      showLineSize: false,
      files: [
        {
          id: "file-1",
          name: "records.jsonl",
          filter: "trace",
          sortOrder: "desc",
          handle: {
            kind: "file",
            name: "records.jsonl",
          } as FileSystemFileHandle,
        },
      ],
    };

    await saveViewerSession(snapshot);

    await expect(loadViewerSession()).resolves.toEqual(snapshot);
  });

  it("clears persisted files while preserving the remember-session preference", async () => {
    await saveViewerSession({
      rememberSession: true,
      activeFileId: "file-1",
      viewTab: "raw",
      showLineSize: false,
      files: [
        {
          id: "file-1",
          name: "records.json",
          filter: "",
          sortOrder: "asc",
          handle: {
            kind: "file",
            name: "records.json",
          } as FileSystemFileHandle,
        },
      ],
    });

    await clearViewerSession(false);

    await expect(loadViewerSession()).resolves.toEqual({
      ...DEFAULT_VIEWER_SESSION,
      rememberSession: false,
    });
  });
});
