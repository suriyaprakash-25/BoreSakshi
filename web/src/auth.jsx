// auth.jsx — cookie-backed operator session context.
// The browser never stores JWTs or account data in localStorage.
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { getSession, signout as apiSignout } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [operator, setOperator] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let active = true;
    getSession()
      .then((currentOperator) => {
        if (active) setOperator(currentOperator);
      })
      .catch(() => {
        if (active) setOperator(null);
      })
      .finally(() => {
        if (active) setSessionReady(true);
      });
    return () => { active = false; };
  }, []);

  const signIn = useCallback((data) => {
    setOperator(data?.operator || null);
    setSessionReady(true);
  }, []);

  const signOut = useCallback(async () => {
    await apiSignout();
    setOperator(null);
    setSessionReady(true);
  }, []);

  const value = { token: null, operator, sessionReady, signIn, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
