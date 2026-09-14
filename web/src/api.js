// api.js — all backend calls in one place.
const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
let csrfToken = null;

const csrfHeaders = () => csrfToken ? { "X-CSRF-Token": csrfToken } : {};
const setCsrfToken = (token) => { csrfToken = token || null; };

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
    credentials: "include",
    body: JSON.stringify({ name, phone, password, confirmPassword }),
  });
  if (!res.ok) throw await readError(res, "Could not create account");
  const data = await res.json();
  setCsrfToken(data.csrfToken);
  return data; // { operator, csrfToken }
}

export async function signin({ phone, password }) {
  const res = await fetch(`${API}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ phone, password }),
  });
  if (!res.ok) throw await readError(res, "Could not sign in");
  const data = await res.json();
  setCsrfToken(data.csrfToken);
  return data; // { operator, csrfToken }
}

export async function signout() {
  await fetch(`${API}/api/auth/signout`, {
    method: "POST",
    headers: csrfHeaders(),
    credentials: "include",
  }).catch(() => {});
  setCsrfToken(null);
}

// Restore the safe operator profile from the HTTP-only cookie. A missing or
// expired session is normal for public visitors, so it resolves to null.
export async function getSession() {
  const res = await fetch(`${API}/api/auth/session`, { credentials: "include" });
  if (res.status === 401 || res.status === 403) {
    setCsrfToken(null);
    return null;
  }
  if (!res.ok) throw await readError(res, "Could not restore your session");
  const data = await res.json();
  setCsrfToken(data.csrfToken);
  return data;
}

// ---- operator flow (auth required) -----------------------------------------
// Rig operator logs a completed drill (a verified outcome). This is what feeds
// the accountability ledger — every log scores any open predictions nearby.
export async function logBorewell(payload) {
  const res = await fetch(`${API}/api/borewells`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res, "Could not save the drill log");
  return res.json();
}

// this operator's own logs (newest first) — dashboard + history
export async function getMyBorewells() {
  const res = await fetch(`${API}/api/borewells/mine`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Could not load your logs");
  return res.json();
}

export async function getBorewellObservations(id) {
  const res = await fetch(`${API}/api/borewells/${id}/observations`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Could not load observations");
  return res.json();
}

export async function addBorewellObservation(id, payload) {
  const res = await fetch(`${API}/api/borewells/${id}/observations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res, "Could not save the observation");
  return res.json();
}

// this operator's assigned sites still awaiting a log
export async function getAssignments() {
  const res = await fetch(`${API}/api/assignments`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Could not load assigned sites");
  return res.json();
}

// ---- admin (auth + admin role required) ------------------------------------
export async function adminGetOperators() {
  const res = await fetch(`${API}/api/admin/operators`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Could not load operators");
  return res.json();
}

export async function adminGetLogs() {
  const res = await fetch(`${API}/api/admin/logs`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Could not load logs");
  return res.json();
}

export async function adminPatchOperator(id, patch) {
  const res = await fetch(`${API}/api/admin/operators/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res, "Could not update operator");
  return res.json();
}

export async function adminPatchLog(id, patch) {
  const res = await fetch(`${API}/api/admin/logs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res, "Could not update log");
  return res.json();
}

export { API };
