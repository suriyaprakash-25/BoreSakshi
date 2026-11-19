// helpContext.jsx — lets the map screen share the result it is showing, so the help
// assistant can explain it. Without a provider the helper simply has no result.
import { createContext, useContext, useMemo, useState } from "react";

const HelpContext = createContext({ result: null, setResult: () => {} });

export function HelpProvider({ children }) {
  const [result, setResult] = useState(null);
  const value = useMemo(() => ({ result, setResult }), [result]);
  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export function useHelp() {
  return useContext(HelpContext);
}
