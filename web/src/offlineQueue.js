// offlineQueue.js — drill records saved on the phone until there is signal.
// Each entry holds the form payload plus the photo/video files themselves, because
// evidence can only be uploaded online. Tokens for files that already reached the
// server are kept alongside them.
const DB_NAME = "boresakshi-offline";
const STORE = "drillLogs";

function openQueue() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "localId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const database = await openQueue();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const result = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(result.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export const listQueued = () => withStore("readonly", (store) => store.getAll());
export const removeQueued = (localId) => withStore("readwrite", (store) => store.delete(localId));
export const saveQueued = (entry) => withStore("readwrite", (store) => store.put(entry));

export function enqueueDrillLog({ payload, tokens, files }) {
  return saveQueued({
    localId: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    payload,
    tokens,
    files,
    lastError: null,
  });
}

export function isNetworkError(error) {
  return error instanceof TypeError;
}

// Sends entries oldest first. Stops at a lost connection or expired session, since
// every later entry would fail the same way. A rejected entry stays on the phone
// with its error so the operator's work is never silently lost.
export async function sendQueued({ uploadFile, submitLog, onSent }) {
  const entries = (await listQueued()).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  for (const entry of entries) {
    const tokens = [...entry.tokens];
    try {
      for (const file of entry.files) tokens.push((await uploadFile(file)).token);
      const record = await submitLog({ ...entry.payload, evidenceTokens: tokens });
      await removeQueued(entry.localId);
      onSent(record);
    } catch (error) {
      if (isNetworkError(error)) return { stopped: "offline" };
      if (error.status === 401) return { stopped: "signin" };
      await saveQueued({ ...entry, lastError: error.message });
    }
  }
  return { stopped: null };
}
