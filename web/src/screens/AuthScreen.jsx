// AuthScreen.jsx — operator sign in / sign up (phone + password).
import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { HardHat, Phone, Lock, ArrowRight, Copy, ShieldCheck } from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import { useAuth } from "../auth.jsx";
import { signin, signup } from "../api.js";
import { validateAuthForm } from "../authValidation.js";
import { roleHome } from "../authState.js";
import { useI18n } from "../i18n.jsx";
import { CONSENT_VERSION } from "../strings.js";
import LegalFooter from "../components/LegalFooter.jsx";

export default function AuthScreen({ mode }) {
  const isSignup = mode === "signup";
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();
  const { t } = useI18n();
  const [consent, setConsent] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [continueTo, setContinueTo] = useState("/dashboard");

  const from = location.state?.from?.pathname;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const validationError = validateAuthForm({ mode, name, phone, password, confirmPassword });
    if (validationError) return setError(validationError);
    if (isSignup && !consent) return setError(t("form.consentRequired"));

    setBusy(true);
    try {
      const data = isSignup
        ? await signup({ name, phone, password, confirmPassword, consentAccepted: true, consentVersion: CONSENT_VERSION })
        : await signin({ phone, password });
      signIn(data); // AuthContext persists only the safe operator profile.
      const home = roleHome(data.operator);
      if (isSignup && data.recoveryCode) {
        setRecoveryCode(data.recoveryCode);
        setContinueTo(from || home);
      } else {
        navigate(from || home, { replace: true });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyRecovery() {
    try { await navigator.clipboard.writeText(recoveryCode); }
    catch { /* user can still select/copy the visible code */ }
  }

  if (recoveryCode) {
    return (
      <div className="op">
        <AppHeader subtitle="Secure account recovery" />
        <div className="auth-wrap op-anim">
          <div className="auth-card">
            <div className="auth-mark"><ShieldCheck size={34} /></div>
            <h1 className="auth-title">Save your recovery code</h1>
            <p className="auth-sub">
              BoreSakshi does not store this code in plaintext. You will need it if you forget your password.
              Store it somewhere private before continuing.
            </p>
            <div className="card" style={{ padding: 18, margin: "18px 0", textAlign: "center" }}>
              <code style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1.2, wordBreak: "break-word" }}>{recoveryCode}</code>
            </div>
            <button type="button" className="btn btn-secondary btn-block" onClick={copyRecovery}>
              <Copy size={17} /> Copy recovery code
            </button>
            <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={() => navigate(continueTo, { replace: true })}>
              I saved it securely <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="op">
      <AppHeader subtitle="Rig operator access" />
      <div className="auth-wrap op-anim">
        <div className="auth-card">
          <div className="auth-mark">
            <img src="/logo.png" alt="BoreSakshi Logo" style={{ width: "100%", height: "100%", objectFit: "contain", transform: "scale(1.8)" }} />
          </div>
          <h1 className="auth-title">{t(isSignup ? "signup.title" : "signin.title")}</h1>
          <p className="auth-sub">
            {t(isSignup ? "signup.sub" : "signin.sub")}
          </p>

          <form onSubmit={handleSubmit} className="auth-form">
            {isSignup && (
              <label className="auth-field">
                <span className="auth-label"><HardHat size={15} strokeWidth={2.2} /> {t("form.name")}</span>
                <input className="op-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Murugan Borewells" autoComplete="name" />
              </label>
            )}

            <label className="auth-field">
              <span className="auth-label"><Phone size={15} strokeWidth={2.2} /> {t("form.phone")}</span>
              <input className="op-input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 98765 43210" autoComplete="tel" />
            </label>

            <label className="auth-field">
              <span className="auth-label"><Lock size={15} strokeWidth={2.2} /> {t("form.password")}</span>
              <input className="op-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t(isSignup ? "form.passwordHint" : "form.yourPassword")} autoComplete={isSignup ? "new-password" : "current-password"} />
            </label>

            {isSignup && (
              <label className="auth-field">
                <span className="auth-label"><Lock size={15} strokeWidth={2.2} /> {t("form.confirm")}</span>
                <input className="op-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t("form.reenter")} autoComplete="new-password" />
              </label>
            )}

            {isSignup && (
              <label className="auth-consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span><ConsentText /></span>
              </label>
            )}

            {error && <div className="op-error">{error}</div>}

            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? t("form.wait") : <>{t(isSignup ? "form.create" : "auth.signIn")} <ArrowRight size={18} strokeWidth={2.2} /></>}
            </button>
          </form>

          <div className="auth-switch">
            {isSignup ? (
              <>{t("form.haveAccount")} <Link to="/signin" state={location.state}>{t("auth.signIn")}</Link></>
            ) : (
              <>{t("form.newOperator")} <Link to="/signup" state={location.state}>{t("form.createLink")}</Link></>
            )}
          </div>
          {!isSignup && <div className="auth-switch"><Link to="/reset-password">{t("form.forgot")}</Link></div>}
        </div>

        <p className="auth-foot">{t("form.farmerNote")} <Link to="/map">{t("form.farmerMap")}</Link></p>
        <LegalFooter />
      </div>
    </div>
  );
}

function ConsentText() {
  const { t } = useI18n();
  const marker = "\u0000";
  const parts = t("form.consent", { terms: marker, privacy: marker }).split(marker);
  return (
    <>
      {parts[0]}<Link to="/terms">{t("footer.terms")}</Link>{parts[1]}<Link to="/privacy">{t("footer.privacy")}</Link>{parts[2]}
    </>
  );
}
