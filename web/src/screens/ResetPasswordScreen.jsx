import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, Lock, Phone, ArrowRight, Copy } from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import { resetPassword } from "../api.js";

export default function ResetPasswordScreen() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [replacementCode, setReplacementCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 10) return setError("Password must be at least 10 characters.");
    if (newPassword !== confirmPassword) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const result = await resetPassword({ phone, recoveryCode, newPassword, confirmPassword });
      setReplacementCode(result.recoveryCode || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (replacementCode) {
    return (
      <div className="op">
        <AppHeader subtitle="Password recovery complete" />
        <div className="auth-wrap op-anim">
          <div className="auth-card">
            <div className="auth-mark"><KeyRound size={34} /></div>
            <h1 className="auth-title">Password reset successful</h1>
            <p className="auth-sub">All previous sessions were revoked. Your old recovery code is also invalid now. Save this new code before signing in.</p>
            <div className="card" style={{ padding: 18, margin: "18px 0", textAlign: "center" }}>
              <code style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1.2, wordBreak: "break-word" }}>{replacementCode}</code>
            </div>
            <button type="button" className="btn btn-secondary btn-block" onClick={() => navigator.clipboard?.writeText(replacementCode)}>
              <Copy size={17} /> Copy new recovery code
            </button>
            <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={() => navigate("/signin", { replace: true })}>
              Continue to sign in <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="op">
      <AppHeader subtitle="Secure password recovery" />
      <div className="auth-wrap op-anim">
        <div className="auth-card">
          <div className="auth-mark"><KeyRound size={34} /></div>
          <h1 className="auth-title">Reset password</h1>
          <p className="auth-sub">Enter the recovery code you saved when it was issued. A successful reset revokes all existing sessions and rotates the recovery code.</p>
          <form className="auth-form" onSubmit={submit}>
            <label className="auth-field">
              <span className="auth-label"><Phone size={15} /> Phone</span>
              <input className="op-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            </label>
            <label className="auth-field">
              <span className="auth-label"><KeyRound size={15} /> Recovery code</span>
              <input className="op-input" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())} placeholder="BSK-XXXXX-XXXXX-XXXXX-XXXXX" autoComplete="off" />
            </label>
            <label className="auth-field">
              <span className="auth-label"><Lock size={15} /> New password</span>
              <input className="op-input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </label>
            <label className="auth-field">
              <span className="auth-label"><Lock size={15} /> Confirm new password</span>
              <input className="op-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
            </label>
            {error && <div className="op-error">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Resetting…" : "Reset password"}</button>
          </form>
          <div className="auth-switch"><Link to="/signin">Back to sign in</Link></div>
        </div>
      </div>
    </div>
  );
}
