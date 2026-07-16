// adminData.jsx — platform-wide shared state for admins: every operator and every
// log, plus moderation mutators. Loaded only when the signed-in account is an admin.
// Mutations patch the backend then update local state, so all admin views (dashboard,
// operators table, detail, flagged list, map) reflect a change immediately.
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useAuth } from "./auth.jsx";
import {
  adminGetOperators, adminGetLogs, adminPatchOperator, adminPatchLog,
} from "./api.js";

const AdminDataContext = createContext(null);

export function AdminDataProvider({ children }) {
  const { operator } = useAuth();
  const isAdmin = operator?.role === "admin";

  const [operators, setOperators] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    if (!isAdmin) { setOperators([]); setLogs([]); return Promise.resolve(); }
    setLoading(true);
    setError(false);
    return Promise.all([
      adminGetOperators().then(setOperators),
      adminGetLogs().then(setLogs),
    ])
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  const replaceOperator = (op) => setOperators((prev) => prev.map((o) => (o.id === op.id ? { ...o, ...op } : o)));
  const replaceLog = (log) => setLogs((prev) => prev.map((l) => (l.id === log.id ? { ...l, ...log } : l)));

  // --- operator moderation ---
  const setOperatorStatus = useCallback(async (id, status) => {
    replaceOperator(await adminPatchOperator(id, { status }));
  }, []);
  const setOperatorVerified = useCallback(async (id, verified) => {
    replaceOperator(await adminPatchOperator(id, { verified }));
  }, []);

  // --- log moderation ---
  const flagLog = useCallback(async (id, reason) => {
    replaceLog(await adminPatchLog(id, { flagged: true, flagReason: reason || "" }));
  }, []);
  const clearFlag = useCallback(async (id) => {
    replaceLog(await adminPatchLog(id, { flagged: false }));
  }, []);
  const setLogVerified = useCallback(async (id, verified) => {
    replaceLog(await adminPatchLog(id, { verified }));
  }, []);

  const value = {
    operators, logs, loading, error, refresh,
    setOperatorStatus, setOperatorVerified,
    flagLog, clearFlag, setLogVerified,
  };
  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}

export function useAdminData() {
  const ctx = useContext(AdminDataContext);
  if (!ctx) throw new Error("useAdminData must be used inside <AdminDataProvider>");
  return ctx;
}
