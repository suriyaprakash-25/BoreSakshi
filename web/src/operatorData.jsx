// operatorData.jsx — signed-in operator logs, assignments and Phase 9 trust profile.
import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "./auth.jsx";
import { addBorewellFollowUp, getMyBorewells, getAssignments, getOperatorTrust, logBorewell, requestSubmissionReview, uploadRigEvidence } from "./api.js";
import { enqueueDrillLog, listQueued, removeQueued, sendQueued } from "./offlineQueue.js";

const OperatorDataContext = createContext(null);

export function OperatorDataProvider({ children }) {
  const { operator } = useAuth();
  const [logs, setLogs] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [trust, setTrust] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [queued, setQueued] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncStop, setSyncStop] = useState(null);
  const syncRunning = useRef(false);

  const refreshAssignments = useCallback(() => {
    if (!operator) return Promise.resolve();
    return getAssignments().then(setAssignments).catch(() => {});
  }, [operator]);

  const refreshTrust = useCallback(() => {
    if (!operator || operator.role === "admin") return Promise.resolve();
    return getOperatorTrust().then(setTrust).catch(() => {});
  }, [operator]);

  const refresh = useCallback(() => {
    if (!operator) {
      setLogs([]);
      setAssignments([]);
      setTrust(null);
      return Promise.resolve();
    }
    setLoading(true);
    setError(false);
    const requests = [
      getMyBorewells().then(setLogs),
      getAssignments().then(setAssignments),
    ];
    if (operator.role !== "admin") requests.push(getOperatorTrust().then(setTrust));
    return Promise.all(requests)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [operator]);

  useEffect(() => { refresh(); }, [refresh]);

  const addLog = useCallback((record) => {
    setLogs((prev) => [record, ...prev]);
    refreshAssignments();
    refreshTrust();
  }, [refreshAssignments, refreshTrust]);

  const refreshQueue = useCallback(() => (
    typeof indexedDB === "undefined" ? Promise.resolve() : listQueued().then(setQueued).catch(() => {})
  ), []);

  const syncQueue = useCallback(async () => {
    if (syncRunning.current || !operator || operator.role === "admin") return;
    syncRunning.current = true;
    setSyncing(true);
    try {
      const { stopped } = await sendQueued({ uploadFile: uploadRigEvidence, submitLog: logBorewell, onSent: addLog });
      setSyncStop(stopped);
    } catch {
      setSyncStop("offline");
    } finally {
      syncRunning.current = false;
      setSyncing(false);
      await refreshQueue();
    }
  }, [operator, addLog, refreshQueue]);

  const queueLog = useCallback(async (entry) => {
    await enqueueDrillLog(entry);
    await refreshQueue();
  }, [refreshQueue]);

  const discardQueued = useCallback(async (localId) => {
    await removeQueued(localId);
    await refreshQueue();
  }, [refreshQueue]);

  // Send on sign-in and whenever signal returns.
  useEffect(() => {
    refreshQueue().then(() => { if (navigator.onLine) syncQueue(); });
    window.addEventListener("online", syncQueue);
    return () => window.removeEventListener("online", syncQueue);
  }, [refreshQueue, syncQueue]);

  const addFollowUp = useCallback(async (id, payload) => {
    const updated = await addBorewellFollowUp(id, payload);
    setLogs((prev) => prev.map((item) => item.id === id ? updated : item));
  }, []);

  const requestReview = useCallback(async (id, note) => {
    const updated = await requestSubmissionReview(id, note);
    setLogs((prev) => prev.map((item) => item.id === id ? { ...item, ...updated } : item));
    await refreshTrust();
    return updated;
  }, [refreshTrust]);

  const value = {
    logs,
    assignments,
    trust,
    loading,
    error,
    refresh,
    refreshAssignments,
    refreshTrust,
    addLog,
    addFollowUp,
    requestReview,
    queued,
    syncing,
    syncStop,
    syncQueue,
    queueLog,
    discardQueued,
  };
  return <OperatorDataContext.Provider value={value}>{children}</OperatorDataContext.Provider>;
}

export function useOperatorData() {
  const ctx = useContext(OperatorDataContext);
  if (!ctx) throw new Error("useOperatorData must be used inside <OperatorDataProvider>");
  return ctx;
}
