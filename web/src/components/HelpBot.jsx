// HelpBot.jsx — side help assistant for farmers and rig operators. It answers from fixed
// Tamil/English text (helpBot.js + strings.js) and never calls an AI service, so it
// can't make up a number. Admin pages are English-only tools and don't show it.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageCircleQuestion, SendHorizontal, X } from "lucide-react";
import { useI18n } from "../i18n.jsx";
import { useHelp } from "../helpContext.jsx";
import { SUGGESTED, matchTopic, replyFor } from "../helpBot.js";

export default function HelpBot() {
  const { t } = useI18n();
  const { result } = useHelp();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const launcherRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  if (pathname.startsWith("/admin")) return null;

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  function ask(question, topic) {
    const text = question.trim();
    if (!text) return;
    const reply = replyFor(topic ?? matchTopic(text), t, result);
    setMessages((list) => [...list, { from: "user", text }, { from: "bot", text: reply }]);
    setDraft("");
  }

  return (
    <div className="helpbot">
      {open && (
        <section
          className="helpbot-panel card"
          role="dialog"
          aria-label={t("help.title")}
          onKeyDown={(event) => { if (event.key === "Escape") close(); }}
        >
          <header className="helpbot-head">
            <span className="helpbot-avatar" aria-hidden="true"><MessageCircleQuestion size={18} strokeWidth={2.2} /></span>
            <div className="helpbot-heading">
              <strong>{t("help.title")}</strong>
              <span>{t("help.subtitle")}</span>
            </div>
            <button type="button" className="helpbot-close" onClick={close} aria-label={t("help.close")}>
              <X size={18} strokeWidth={2.2} />
            </button>
          </header>

          <div className="helpbot-list" ref={listRef} aria-live="polite">
            <p className="helpbot-msg bot">{t("help.a.greet")}</p>
            {messages.map((message, index) => (
              <p key={index} className={`helpbot-msg ${message.from}`}>{message.text}</p>
            ))}
          </div>

          <div className="helpbot-chips" aria-label={t("help.suggest")}>
            {SUGGESTED.map((topic) => (
              <button key={topic} type="button" className="helpbot-chip" onClick={() => ask(t(`help.q.${topic}`), topic)}>
                {t(`help.q.${topic}`)}
              </button>
            ))}
          </div>

          <form className="helpbot-form" onSubmit={(event) => { event.preventDefault(); ask(draft); }}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("help.placeholder")}
              aria-label={t("help.placeholder")}
              maxLength={300}
            />
            <button type="submit" className="btn btn-primary helpbot-send" aria-label={t("help.send")} disabled={!draft.trim()}>
              <SendHorizontal size={17} strokeWidth={2.2} />
            </button>
          </form>
        </section>
      )}

      <button
        ref={launcherRef}
        type="button"
        className="helpbot-launcher"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label={open ? t("help.close") : t("help.open")}
      >
        {open ? <X size={22} strokeWidth={2.2} /> : <MessageCircleQuestion size={22} strokeWidth={2.2} />}
        {!open && <span className="helpbot-launcher-label">{t("help.open")}</span>}
      </button>
    </div>
  );
}
