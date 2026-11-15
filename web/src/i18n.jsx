// i18n.jsx — language context. Tamil is the default for new visitors because the
// pilot serves Tamil-speaking farmers. Without a provider (tests) it renders English.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { STRINGS } from "./strings.js";

const LANGUAGE_KEY = "boresakshi_language";

function format(text, vars) {
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

function translator(lang) {
  return (key, vars = {}) => format(STRINGS[lang][key] ?? STRINGS.en[key] ?? key, vars);
}

const LanguageContext = createContext({ lang: "en", setLang: () => {}, t: translator("en") });

function savedLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    return saved === "en" || saved === "ta" ? saved : "ta";
  } catch {
    return "ta";
  }
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(savedLanguage);

  const setLang = useCallback((next) => {
    setLangState(next);
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* still works this session */ }
  }, []);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t: translator(lang) }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  return useContext(LanguageContext);
}
