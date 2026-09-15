// adminData.jsx — shared admin state for moderation + Phase 9 verification review.
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useAuth } from "./auth.jsx";
import {
  adminGetOperators,
  adminGetLogs,
  adminPatchOperator,
  adminPatchLog,
  adminGetReviewQueue,
  adminGetReviewStats,
  adminStartReview,
  adminReviewDecision,
  adminReopenReview,
} from "./api.js";

const AdminDataContext = createContext(null);

export function AdminDataProvider({ children }) {
  const { operator } = useAuth();
  const isAdmin = operator?.role === "admin";

  const [operators, setOperators] = useState([]);
  const [logs, setLogs] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reviewStats, setReviewStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    if (!isAdmin) {
      setOperators([]);
      setLogs([]);
      setReviewQueue([]);
      setReviewStats(null);
      return Promise.resolve();
    }
    setLoading(true);
    setError(false);
    return Promise.all([
      adminGetOperators().then(setOperators),
      adminGetLogs().then(setLogs),
      adminGetReviewQueue().then(setReviewQueue),
      adminGetReviewStats().then(setReviewStats),
    ])
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  const replaceOperator = (op) => setOperators((prev) => prev.map((o) => (o.id === op.id ? { ...o, ...op } : o)));
  const replaceLog = (log) => setLogs((prev) => prev.map((l) => (l.id === log.id ? { ...l, ...log } : l)));
  const replaceQueueLog = (log) => setReviewQueue((prev) => prev.map((l) => (l.id === log.id ? { ...l, ...log } : l)));

  const refreshReview = useCallback(async () => {
    if (!isAdmin) return;
    const [queue, stats] = await Promise.all([adminGetReviewQueue(), adminGetReviewStats()]);
    setReviewQueue(queue);
    setReviewStats(stats);
  }, [isAdmin]);

  const setOperatorStatus = useCallback(async (id, status) => {
    replaceOperator(await adminPatchOperator(id, { status }));
  }, []);
  const setOperatorVerified = useCallback(async (id, verified) => {
    replaceOperator(await adminPatchOperator(id, { verified }));
  }, []);

  const flagLog = useCallback(async (id, reason) => {
    const updated = await adminPatchLog(id, { flagged: true, flagReason: reason || "" });
    replaceLog(updated);
    replaceQueueLog(updated);
    await refreshReview();
    return updated;
  }, [refreshReview]);

  const clearFlag = useCallback(async (id) => {
    const updated = await adminPatchLog(id, { flagged: false });
    replaceLog(updated);
    replaceQueueLog(updated);
    await refreshReview();
    return updated;
  }, [refreshReview]);

  // Legacy imported-data helper only. Phase 9 operator outcomes use start/decide/reopen.
  const setLogVerified = useCallback(async (id, verified) => {
    const updated = await adminPatchLog(id, { verified });
    replaceLog(updated);
    return updated;
  }, []);

  const startReview = useCallback(async (id, note = "") => {
    const updated = await adminStartReview(id, note);
    replaceLog(updated);
    replaceQueueLog(updated);
    await refreshReview();
    return updated;
  }, [refreshReview]);

  const decideReview = useCallback(async (id, payload) => {
    const result = await adminReviewDecision(id, payload);
    replaceLog(result.record);
    setReviewQueue((prev) => prev.filter((item) => item.id !== id));
    await refresh();
    return result;
  }, [refresh]);

  const reopenReview = useCallback(async (id, reason) => {
    const result = await adminReopenReview(id, reason);
    replaceLog(result.record);
    await refresh();
    return result;
  }, [refresh]);

  const value = {
    operators,
    logs,
    reviewQueue,
    reviewStats,
    loading,
    error,
    refresh,
    refreshReview,
    setOperatorStatus,
    setOperatorVerified,
    flagLog,
    clearFlag,
    setLogVerified,
    startReview,
    decideReview,
    reopenReview,
  };
  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}

export function useAdminData() {
  const ctx = useContext(AdminDataContext);
  if (!ctx) throw new Error("useAdminData must be used inside <AdminDataProvider>");
  return ctx;
}
