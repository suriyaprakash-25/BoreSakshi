import { useI18n } from "../i18n.jsx";

export default function LanguageToggle() {
  const { lang, setLang } = useI18n();
  const next = lang === "ta" ? "en" : "ta";
  return (
    <button
      type="button"
      className="lang-toggle"
      onClick={() => setLang(next)}
      aria-label={next === "ta" ? "தமிழுக்கு மாற்று" : "Switch to English"}
    >
      {next === "ta" ? "தமிழ்" : "English"}
    </button>
  );
}
