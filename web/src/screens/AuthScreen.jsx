// AuthScreen.jsx — operator sign in / sign up (phone + password).
import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { HardHat, Phone, Lock, ArrowRight, Copy, ShieldCheck } from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import { useAuth } from "../auth.jsx";
import { signin, signup } from "../api.js";
import { validateAuthForm } from "../authValidation.js";
import { roleHome } from "../authState.js";

export default function AuthScreen({ mode }) {
  const isSignup = mode === "signup";
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();

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

    setBusy(true);
    try {
      const data = isSignup
        ? await signup({ name, phone, password, confirmPassword })
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
          <h1 className="auth-title">{isSignup ? "Create operator account" : "Operator sign in"}</h1>
          <p className="auth-sub">
            {isSignup
              ? "Create a protected operator account. An administrator must verify the account before field evidence can be submitted."
              : "Sign in to log completed borewells and access your job tools."}
          </p>

          <form onSubmit={handleSubmit} className="auth-form">
            {isSignup && (
              <label className="auth-field">
                <span className="auth-label"><HardHat size={15} strokeWidth={2.2} /> Name / rig</span>
                <input className="op-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Murugan Borewells" autoComplete="name" />
              </label>
            )}

            <label className="auth-field">
              <span className="auth-label"><Phone size={15} strokeWidth={2.2} /> Phone</span>
              <input className="op-input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 98765 43210" autoComplete="tel" />
            </label>

            <label className="auth-field">
              <span className="auth-label"><Lock size={15} strokeWidth={2.2} /> Password</span>
              <input className="op-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isSignup ? "Min 10 chars, A-Z, 0-9, symbol" : "Your password"} autoComplete={isSignup ? "new-password" : "current-password"} />
            </label>

            {isSignup && (
              <label className="auth-field">
                <span className="auth-label"><Lock size={15} strokeWidth={2.2} /> Confirm password</span>
                <input className="op-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" autoComplete="new-password" />
              </label>
            )}

            {error && <div className="op-error">{error}</div>}

            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Please wait…" : <>{isSignup ? "Create account" : "Sign in"} <ArrowRight size={18} strokeWidth={2.2} /></>}
            </button>
          </form>

          <div className="auth-switch">
            {isSignup ? (
              <>Already registered? <Link to="/signin" state={location.state}>Sign in</Link></>
            ) : (
              <>New operator? <Link to="/signup" state={location.state}>Create an account</Link></>
            )}
          </div>
          {!isSignup && <div className="auth-switch"><Link to="/reset-password">Forgot password? Use your recovery code</Link></div>}
        </div>

        <p className="auth-foot">Just checking a location? The <Link to="/">farmer map</Link> is open — no account needed.</p>
      </div>
    </div>
  );
}
