import type { ViewerSortOrder } from "./viewer-file";

export type ViewerViewTab = "raw" | "pretty" | "tree";

const DB_NAME = "json-viewer-session";
const STORE_NAME = "viewer-state";
const SESSION_KEY = "session";

export interface PersistedViewerFile {
  id: string;
  name: string;
  filter: string;
  sortOrder: ViewerSortOrder;
  handle: FileSystemFileHandle;
}

export interface ViewerSessionSnapshot {
  rememberSession: boolean;
  activeFileId: string | null;
  viewTab: ViewerViewTab;
  showLineSize: boolean;
  files: PersistedViewerFile[];
}

export const DEFAULT_VIEWER_SESSION: ViewerSessionSnapshot = {
  rememberSession: true,
  activeFileId: null,
  viewTab: "pretty",
  showLineSize: true,
  files: [],
};

function openViewerSessionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openViewerSessionDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = action(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function loadViewerSession(): Promise<ViewerSessionSnapshot> {
  const snapshot = await withStore<ViewerSessionSnapshot | undefined>(
    "readonly",
    (store) => store.get(SESSION_KEY),
  );

  return snapshot ?? DEFAULT_VIEWER_SESSION;
}

export async function saveViewerSession(
  snapshot: ViewerSessionSnapshot,
): Promise<void> {
  await withStore<IDBValidKey>("readwrite", (store) =>
    store.put(snapshot, SESSION_KEY),
  );
}

export async function clearViewerSession(
  rememberSession: boolean,
): Promise<void> {
  await saveViewerSession({
    ...DEFAULT_VIEWER_SESSION,
    rememberSession,
  });
}
