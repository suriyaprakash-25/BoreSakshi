// auth.jsx — operator session context. Backed by localStorage (see api.js).
// Farmers never hit this; only the /log flow reads it.
import { createContext, useContext, useState, useCallback } from "react";
import { getAuth, setAuth as persist, clearAuth } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuthState] = useState(getAuth); // { token, operator } | null

  const signIn = useCallback((data) => { persist(data); setAuthState(data); }, []);
  const signOut = useCallback(() => { clearAuth(); setAuthState(null); }, []);

  const value = {
    token: auth?.token || null,
    operator: auth?.operator || null,
    signIn,
    signOut,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
