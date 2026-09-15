// api.js — all backend calls in one place.
const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const AUTH_KEY = "boresakshi_auth";

export function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch { return null; }
}
export function setAuth(auth) { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); }
export function clearAuth() { localStorage.removeItem(AUTH_KEY); }

async function readError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  const err = new Error(body.error || body?.detail?.message || fallback);
  err.status = res.status;
  err.body = body;
  return err;
}

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

export async function signup({ name, phone, password, confirmPassword }) {
  const res = await fetch(`${API}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name, phone, password, confirmPassword }),
  });
  if (!res.ok) throw await readError(res, "Could not create account");
  return res.json();
}

export async function signin({ phone, password }) {
  const res = await fetch(`${API}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ phone, password }),
  });
  if (!res.ok) throw await readError(res, "Could not sign in");
  return res.json();
}

export async function signout() {
  await fetch(`${API}/api/auth/signout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {});
}

export async function uploadRigEvidence(file) {
  const res = await fetch(`${API}/api/operator/evidence`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name || "evidence"),
    },
    credentials: "include",
    body: file,
  });
  if (!res.ok) throw await readError(res, "Could not upload evidence");
  return res.json();
}

export async function deleteRigEvidence(item) {
  const res = await fetch(`${API}/api/operator/evidence/${item.id}`, {
    method: "DELETE",
    headers: { "X-Evidence-Token": item.token },
    credentials: "include",
  });
  if (!res.ok) throw await readError(res, "Could not remove evidence");
  return res.json();
}

export async function logBorewell(payload) {
  const res = await fetch(`${API}/api/borewells`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res, "Could not save the drill log");
  return res.json();
}

export async function getMyBorewells() {
  const res = await fetch(`${API}/api/borewells/mine`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Could not load your logs");
  return res.json();
}

export async function getAssignments() {
  const res = await fetch(`${API}/api/assignments`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Could not load assigned sites");
  return res.json();
}

export async function getOperatorTrust() {
  const res = await fetch(`${API}/api/operator/trust`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Could not load trust profile");
  return res.json();
}

export async function requestSubmissionReview(id, note) {
  const res = await fetch(`${API}/api/borewells/${encodeURIComponent(id)}/request-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ note }),
  });
  if (!res.ok) throw await readError(res, "Could not request another review");
  return res.json();
}

export function rigEvidenceUrl(borewellId, evidenceId) {
  return `${API}/api/borewells/${encodeURIComponent(borewellId)}/evidence/${encodeURIComponent(evidenceId)}`;
}

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
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res, "Could not update operator");
  return res.json();
}

export async function adminPatchLog(id, patch) {
  const res = await fetch(`${API}/api/admin/logs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res, "Could not update log");
  return res.json();
}

export async function adminGetReviewStats() {
  const res = await fetch(`${API}/api/admin/review/stats`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Could not load review statistics");
  return res.json();
}

export async function adminGetReviewQueue(status = "") {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`${API}/api/admin/review/queue${suffix}`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Could not load review queue");
  return res.json();
}

export async function adminGetReviewRecord(id) {
  const res = await fetch(`${API}/api/admin/review/logs/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Could not load review record");
  return res.json();
}

export async function adminStartReview(id, note = "") {
  const res = await fetch(`${API}/api/admin/review/logs/${encodeURIComponent(id)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ note }),
  });
  if (!res.ok) throw await readError(res, "Could not start review");
  return res.json();
}

export async function adminReviewDecision(id, payload) {
  const res = await fetch(`${API}/api/admin/review/logs/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res, "Could not save review decision");
  return res.json();
}

export async function adminReopenReview(id, reason) {
  const res = await fetch(`${API}/api/admin/review/logs/${encodeURIComponent(id)}/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw await readError(res, "Could not reopen review");
  return res.json();
}

export async function adminGetOperatorTrust(id) {
  const res = await fetch(`${API}/api/admin/operators/${encodeURIComponent(id)}/trust`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "Could not load operator trust profile");
  return res.json();
}

export { API };
