// api.js — all backend calls in one place.
const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

// ---- operator session (localStorage) ---------------------------------------
const AUTH_KEY = "boresakshi_auth"; // { token, operator: { id, name, phone } }

export function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch { return null; }
}
export function setAuth(auth) { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); }
export function clearAuth() { localStorage.removeItem(AUTH_KEY); }

function authHeader() {
  const a = getAuth();
  return a?.token ? { Authorization: `Bearer ${a.token}` } : {};
}

async function readError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  const err = new Error(body.error || fallback);
  err.status = res.status;
  return err;
}

// ---- farmer flow (open, no auth) -------------------------------------------
export async function getPrediction(lat, lng) {
  const res = await fetch(`${API}/api/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng }),
  });
  if (!res.ok) throw new Error("Prediction failed");
  return res.json();
}

export async function getBorewells() {
  const res = await fetch(`${API}/api/borewells`);
  if (!res.ok) throw new Error("Could not load borewells");
  return res.json();
}

export async function getLedger() {
  const res = await fetch(`${API}/api/ledger`);
  if (!res.ok) throw new Error("Could not load ledger");
  return res.json();
}

// ---- operator auth ---------------------------------------------------------
export async function signup({ name, phone, password, confirmPassword }) {
  const res = await fetch(`${API}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, phone, password, confirmPassword }),
  });
  if (!res.ok) throw await readError(res, "Could not create account");
  return res.json(); // { token, operator }
}

export async function signin({ phone, password }) {
  const res = await fetch(`${API}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  if (!res.ok) throw await readError(res, "Could not sign in");
  return res.json(); // { token, operator }
}

// ---- operator flow (auth required) -----------------------------------------
// Rig operator logs a completed drill (a verified outcome). This is what feeds
// the accountability ledger — every log scores any open predictions nearby.
export async function logBorewell(payload) {
  const res = await fetch(`${API}/api/borewells`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res, "Could not save the drill log");
  return res.json();
}

// this operator's own logs (newest first) — dashboard + history
export async function getMyBorewells() {
  const res = await fetch(`${API}/api/borewells/mine`, { headers: { ...authHeader() } });
  if (!res.ok) throw await readError(res, "Could not load your logs");
  return res.json();
}

// this operator's assigned sites still awaiting a log
export async function getAssignments() {
  const res = await fetch(`${API}/api/assignments`, { headers: { ...authHeader() } });
  if (!res.ok) throw await readError(res, "Could not load assigned sites");
  return res.json();
}

// ---- admin (auth + admin role required) ------------------------------------
export async function adminGetOperators() {
  const res = await fetch(`${API}/api/admin/operators`, { headers: { ...authHeader() } });
  if (!res.ok) throw await readError(res, "Could not load operators");
  return res.json();
}

export async function adminGetLogs() {
  const res = await fetch(`${API}/api/admin/logs`, { headers: { ...authHeader() } });
  if (!res.ok) throw await readError(res, "Could not load logs");
  return res.json();
}

export async function adminPatchOperator(id, patch) {
  const res = await fetch(`${API}/api/admin/operators/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res, "Could not update operator");
  return res.json();
}

export async function adminPatchLog(id, patch) {
  const res = await fetch(`${API}/api/admin/logs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res, "Could not update log");
  return res.json();
}

export { API };
