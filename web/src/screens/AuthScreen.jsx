// AuthScreen.jsx — operator sign in / sign up (phone + password).
// One component serves both /signin and /signup via the `mode` prop.
import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { HardHat, Phone, Lock, ArrowRight, Droplets } from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import { useAuth } from "../auth.jsx";
import { signin, signup } from "../api.js";

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

  // where the visitor was originally headed (set by a route guard), if any
  const from = location.state?.from?.pathname;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    // client-side checks give instant feedback; the server re-validates anyway
    if (isSignup) {
      if (password.length < 6) return setError("Password must be at least 6 characters.");
      if (password !== confirmPassword) return setError("Passwords do not match.");
    }

    setBusy(true);
    try {
      const data = isSignup
        ? await signup({ name, phone, password, confirmPassword })
        : await signin({ phone, password });
      signIn(data);
      // back to where they were headed, else role-appropriate home
      const home = data.operator?.role === "admin" ? "/admin" : "/dashboard";
      navigate(from || home, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="op">
      <AppHeader subtitle="Rig operator access" />
      <div className="auth-wrap op-anim">
        <div className="auth-card">
          <div className="auth-mark"><Droplets size={26} strokeWidth={2} /></div>
          <h1 className="auth-title">{isSignup ? "Create operator account" : "Operator sign in"}</h1>
          <p className="auth-sub">
            {isSignup
              ? "Log your completed borewells and build a job history tied to your name — plus free job reports."
              : "Sign in to log completed borewells and access your job tools."}
          </p>

          <form onSubmit={handleSubmit} className="auth-form">
            {isSignup && (
              <label className="auth-field">
                <span className="auth-label"><HardHat size={15} strokeWidth={2.2} /> Name / rig</span>
                <input
                  className="op-input" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Murugan Borewells" autoComplete="name"
                />
              </label>
            )}

            <label className="auth-field">
              <span className="auth-label"><Phone size={15} strokeWidth={2.2} /> Phone</span>
              <input
                className="op-input" type="tel" inputMode="tel" value={phone}
                onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 98765 43210"
                autoComplete="tel"
              />
            </label>

            <label className="auth-field">
              <span className="auth-label"><Lock size={15} strokeWidth={2.2} /> Password</span>
              <input
                className="op-input" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? "At least 6 characters" : "Your password"}
                autoComplete={isSignup ? "new-password" : "current-password"}
              />
            </label>

            {isSignup && (
              <label className="auth-field">
                <span className="auth-label"><Lock size={15} strokeWidth={2.2} /> Confirm password</span>
                <input
                  className="op-input" type="password" value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                />
              </label>
            )}

            {error && <div className="op-error">{error}</div>}

            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Please wait…" : (
                <>{isSignup ? "Create account" : "Sign in"} <ArrowRight size={18} strokeWidth={2.2} /></>
              )}
            </button>
          </form>

          <div className="auth-switch">
            {isSignup ? (
              <>Already registered? <Link to="/signin" state={location.state}>Sign in</Link></>
            ) : (
              <>New operator? <Link to="/signup" state={location.state}>Create an account</Link></>
            )}
          </div>
        </div>

        <p className="auth-foot">
          Just checking a location? The <Link to="/">farmer map</Link> is open — no account needed.
        </p>
      </div>
    </div>
  );
}
