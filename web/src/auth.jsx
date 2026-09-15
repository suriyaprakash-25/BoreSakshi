// auth.jsx — operator session context. The browser stores only the safe operator
// profile; authentication itself is the HttpOnly server session cookie.
import { createContext, useContext, useState, useCallback } from "react";
import { getAuth, setAuth as persist, clearAuth, signout as apiSignout } from "./api.js";
import { safeAuthState } from "./authState.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuthState] = useState(getAuth);

  const signIn = useCallback((data) => {
    const safe = safeAuthState(data);
    if (safe) persist(safe);
    else clearAuth();
    setAuthState(safe);
  }, []);

  const signOut = useCallback(() => {
    apiSignout();
    clearAuth();
    setAuthState(null);
  }, []);

  const value = {
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
