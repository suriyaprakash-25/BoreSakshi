// operatorData.jsx — signed-in operator logs, assignments and Phase 9 trust profile.
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useAuth } from "./auth.jsx";
import { getMyBorewells, getAssignments, getOperatorTrust, requestSubmissionReview } from "./api.js";

const OperatorDataContext = createContext(null);

export function OperatorDataProvider({ children }) {
  const { operator } = useAuth();
  const [logs, setLogs] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [trust, setTrust] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

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
    requestReview,
  };
  return <OperatorDataContext.Provider value={value}>{children}</OperatorDataContext.Provider>;
}

export function useOperatorData() {
  const ctx = useContext(OperatorDataContext);
  if (!ctx) throw new Error("useOperatorData must be used inside <OperatorDataProvider>");
  return ctx;
}
