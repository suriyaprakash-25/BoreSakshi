// operatorData.jsx — shared source of truth for the signed-in operator's logs and
// assigned sites. Dashboard + History read from here; the Log screen calls addLog()
// on submit so a new outcome shows up everywhere immediately (no manual refresh).
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useAuth } from "./auth.jsx";
import { getMyBorewells, getAssignments } from "./api.js";

const OperatorDataContext = createContext(null);

export function OperatorDataProvider({ children }) {
  const { operator } = useAuth();
  const [logs, setLogs] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refreshAssignments = useCallback(() => {
    if (!operator) return Promise.resolve();
    return getAssignments().then(setAssignments).catch(() => {});
  }, [operator]);

  const refresh = useCallback(() => {
    if (!operator) { setLogs([]); setAssignments([]); return Promise.resolve(); }
    setLoading(true);
    setError(false);
    return Promise.all([
      getMyBorewells().then(setLogs),
      getAssignments().then(setAssignments),
    ])
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [operator]);

  // (re)load whenever the signed-in operator changes (incl. sign-in / sign-out)
  useEffect(() => { refresh(); }, [refresh]);

  // called by the Log screen after a successful submit — instant local update,
  // then re-pull assignments in case this log closed an assigned site.
  const addLog = useCallback((record) => {
    setLogs((prev) => [record, ...prev]);
    refreshAssignments();
  }, [refreshAssignments]);

  const value = { logs, assignments, loading, error, refresh, refreshAssignments, addLog };
  return <OperatorDataContext.Provider value={value}>{children}</OperatorDataContext.Provider>;
}

export function useOperatorData() {
  const ctx = useContext(OperatorDataContext);
  if (!ctx) throw new Error("useOperatorData must be used inside <OperatorDataProvider>");
  return ctx;
}
