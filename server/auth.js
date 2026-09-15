// auth.js — production-hardened operator/admin authentication.
// Phase 15 keeps cookie/JWT compatibility while adding server-side revocable
// sessions, one-time recovery codes, password reset/change and security audit.
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { db } from "./db.js";
import { authStore } from "./authStore.js";

const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_TTL_HOURS = Math.min(24 * 30, Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 12));
const BCRYPT_ROUNDS = Math.min(15, Math.max(10, Number(process.env.BCRYPT_ROUNDS) || 12));
export const SESSION_COOKIE_NAME = process.env.NODE_ENV === "production" ? "__Host-boresakshi_session" : "boresakshi_session";

if (!JWT_SECRET) {
  console.error("[BoreSakshi] FATAL: JWT_SECRET is not set. Set it in server/.env");
  process.exit(1);
}

const publicOperator = (op) => ({
  id: op.id,
  name: op.name,
  phone: op.phone,
  role: op.role || "operator",
  status: op.status || "active",
  verified: !!op.verified,
});

const normalisePhone = (p) => String(p || "").replace(/[^\d]/g, "");
const nowIso = () => new Date().toISOString();

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_HOURS * 60 * 60 * 1000,
  };
}

function clearSessionCookies(res) {
  const base = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" };
  res.clearCookie(SESSION_COOKIE_NAME, base);
  // Migration cleanup for the pre-Phase-15 cookie.
  res.clearCookie("token", base);
}

function fingerprint(value) {
  return crypto.createHmac("sha256", JWT_SECRET).update(String(value || "unknown")).digest("hex").slice(0, 24);
}

async function securityAudit({ action, operator = null, req = null, details = {} }) {
  if (typeof db.addIngestionAudit !== "function") return;
  const scopeId = operator?.id || details.subjectId || "anonymous";
  await db.addIngestionAudit({
    id: nanoid(14),
    batchId: null,
    recordId: null,
    scopeType: "security_event",
    scopeId,
    action,
    actor: operator ? { id: operator.id, name: operator.name, role: operator.role || "operator" } : { id: "system", name: "BoreSakshi", role: "system" },
    details: {
      ...details,
      requestId: req?.id || null,
      ipFingerprint: req ? fingerprint(req.ip) : null,
      userAgentFingerprint: req ? fingerprint(req.headers?.["user-agent"]) : null,
    },
    createdAt: nowIso(),
  });
}

export function generateRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(20);
  let raw = "";
  for (let i = 0; i < 20; i += 1) raw += alphabet[bytes[i] % alphabet.length];
  return `BSK-${raw.match(/.{1,5}/g).join("-")}`;
}

async function hashPassword(value) {
  return bcrypt.hash(String(value), BCRYPT_ROUNDS);
}

async function issueSession(op, req, res) {
  const sid = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const sessionVersion = Number(op.sessionVersion || 0);
  const token = jwt.sign(
    { id: op.id, name: op.name, role: op.role || "operator", sid, sv: sessionVersion },
    JWT_SECRET,
    { expiresIn: SESSION_TTL_HOURS * 60 * 60, issuer: "boresakshi", audience: "boresakshi-web" }
  );
  await authStore.createSession({
    sid,
    operatorId: op.id,
    sessionVersion,
    createdAt,
    lastSeenAt: createdAt,
    expiresAt,
    revokedAt: null,
    revokeReason: null,
    ipFingerprint: fingerprint(req.ip),
    userAgentFingerprint: fingerprint(req.headers?.["user-agent"]),
  });
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions());
  res.clearCookie("token", { ...cookieOptions(), maxAge: undefined });
  return { sid, expiresAt };
}

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  if (req.cookies?.[SESSION_COOKIE_NAME]) return req.cookies[SESSION_COOKIE_NAME];
  if (process.env.ALLOW_LEGACY_JWT === "YES" && req.cookies?.token) return req.cookies.token;
  return null;
}

function verifyJwt(token) {
  return jwt.verify(token, JWT_SECRET, { issuer: "boresakshi", audience: "boresakshi-web" });
}

export async function signup(req, res) {
  const { name, phone, password } = req.body;
  const cleanName = String(name).trim();
  const cleanPhone = normalisePhone(phone);
  if (!cleanName) return res.status(400).json({ error: "Name is required" });
  if (cleanPhone.length < 7) return res.status(400).json({ error: "A valid phone number is required" });

  const existing = await db.getOperatorByPhone(cleanPhone);
  if (existing) return res.status(409).json({ error: "An account with this phone already exists — sign in instead" });

  const recoveryCode = generateRecoveryCode();
  const createdAt = nowIso();
  const operator = {
    id: nanoid(12),
    name: cleanName,
    phone: cleanPhone,
    passwordHash: await hashPassword(password),
    recoveryCodeHash: await hashPassword(recoveryCode),
    recoveryCodeRotatedAt: createdAt,
    sessionVersion: 0,
    role: "operator",
    status: "active",
    verified: false,
    createdAt,
  };
  try {
    await db.addOperator(operator);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "An account with this phone already exists — sign in instead" });
    throw err;
  }
  await db.seedAssignmentsForOperator(operator.id);
  await issueSession(operator, req, res);
  await securityAudit({ action: "account_created", operator, req, details: { recoveryCodeIssued: true } });
  res.status(201).json({
    operator: publicOperator(operator),
    recoveryCode,
    recoveryCodeNotice: "Save this recovery code securely. It is shown only when issued and is required for self-service password reset.",
  });
}

export async function signin(req, res) {
  const { phone, password } = req.body;
  const cleanPhone = normalisePhone(phone);
  const operator = await db.getOperatorByPhone(cleanPhone);
  const bad = async () => {
    await securityAudit({ action: "signin_failed", operator, req, details: { subjectId: operator?.id || `phone:${fingerprint(cleanPhone)}` } });
    return res.status(401).json({ error: "Invalid phone or password" });
  };
  if (!operator) return bad();
  const ok = await bcrypt.compare(String(password), operator.passwordHash);
  if (!ok) return bad();
  if (operator.status === "deactivated") return res.status(403).json({ error: "This account has been deactivated. Please contact the administrator." });

  await issueSession(operator, req, res);
  await securityAudit({ action: "signin_succeeded", operator, req });
  res.json({ operator: publicOperator(operator) });
}

export async function signout(req, res) {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = verifyJwt(token);
      if (payload.sid) await authStore.revokeSession(payload.sid, "signout");
      const operator = payload.id ? await db.getOperatorById(payload.id) : null;
      await securityAudit({ action: "signout", operator, req, details: { sid: payload.sid || null } });
    } catch { /* clearing the cookie is still correct for expired/invalid tokens */ }
  }
  clearSessionCookies(res);
  res.json({ success: true });
}

export async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: "Sign in to continue" });

    let payload;
    try { payload = verifyJwt(token); }
    catch { return res.status(401).json({ error: "Session expired — please sign in again" }); }

    const op = await db.getOperatorById(payload.id);
    if (!op) return res.status(401).json({ error: "Account not found — please sign in again" });
    if (op.status === "deactivated") return res.status(403).json({ error: "Your account has been deactivated. Please contact the administrator." });

    if (!payload.sid) {
      if (process.env.ALLOW_LEGACY_JWT !== "YES") return res.status(401).json({ error: "Session must be renewed — please sign in again" });
    } else {
      const session = await authStore.getSession(payload.sid);
      if (!session || session.operatorId !== op.id || session.revokedAt) return res.status(401).json({ error: "Session has been revoked — please sign in again" });
      if (Date.parse(session.expiresAt) <= Date.now()) return res.status(401).json({ error: "Session expired — please sign in again" });
      const currentVersion = Number(op.sessionVersion || 0);
      if (Number(payload.sv || 0) !== currentVersion || Number(session.sessionVersion || 0) !== currentVersion) {
        return res.status(401).json({ error: "Session was invalidated by a security change — please sign in again" });
      }
      if (!session.lastSeenAt || Date.now() - Date.parse(session.lastSeenAt) > 5 * 60 * 1000) {
        await authStore.touchSession(payload.sid, nowIso()).catch(() => {});
      }
      req.authSession = { sid: payload.sid, expiresAt: session.expiresAt };
    }

    req.operator = {
      id: op.id,
      name: op.name,
      role: op.role || "operator",
      status: op.status || "active",
      verified: !!op.verified,
    };
    next();
  } catch (err) { next(err); }
}

export function requireAdmin(req, res, next) {
  if (!req.operator) return res.status(401).json({ error: "Sign in to continue" });
  if (req.operator.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  if (req.operator.verified !== true) return res.status(403).json({ error: "Verified admin account required" });
  next();
}

export async function changePassword(req, res) {
  const operator = await db.getOperatorById(req.operator.id);
  const ok = operator && await bcrypt.compare(String(req.body.currentPassword), operator.passwordHash);
  if (!ok) return res.status(400).json({ error: "Current password is incorrect" });
  await db.updateOperator(operator.id, {
    passwordHash: await hashPassword(req.body.newPassword),
    sessionVersion: Number(operator.sessionVersion || 0) + 1,
    passwordChangedAt: nowIso(),
  });
  const revoked = await authStore.revokeAllForOperator(operator.id, "password_changed");
  await securityAudit({ action: "password_changed", operator, req, details: { revokedSessions: revoked } });
  clearSessionCookies(res);
  res.json({ success: true, reauthenticate: true });
}

export async function resetPassword(req, res) {
  const cleanPhone = normalisePhone(req.body.phone);
  const operator = await db.getOperatorByPhone(cleanPhone);
  const valid = operator?.recoveryCodeHash
    ? await bcrypt.compare(String(req.body.recoveryCode).trim().toUpperCase(), operator.recoveryCodeHash)
    : false;
  if (!operator || !valid) {
    await securityAudit({ action: "password_reset_failed", operator, req, details: { subjectId: operator?.id || `phone:${fingerprint(cleanPhone)}` } });
    return res.status(400).json({ error: "Invalid recovery credentials" });
  }
  const replacementRecoveryCode = generateRecoveryCode();
  await db.updateOperator(operator.id, {
    passwordHash: await hashPassword(req.body.newPassword),
    recoveryCodeHash: await hashPassword(replacementRecoveryCode),
    recoveryCodeRotatedAt: nowIso(),
    sessionVersion: Number(operator.sessionVersion || 0) + 1,
    passwordChangedAt: nowIso(),
  });
  const revoked = await authStore.revokeAllForOperator(operator.id, "password_reset");
  await securityAudit({ action: "password_reset_succeeded", operator, req, details: { revokedSessions: revoked, recoveryCodeRotated: true } });
  clearSessionCookies(res);
  res.json({
    success: true,
    recoveryCode: replacementRecoveryCode,
    recoveryCodeNotice: "Your old recovery code is invalid. Save this replacement code securely.",
  });
}

export async function rotateRecoveryCode(req, res) {
  const operator = await db.getOperatorById(req.operator.id);
  const ok = operator && await bcrypt.compare(String(req.body.currentPassword), operator.passwordHash);
  if (!ok) return res.status(400).json({ error: "Current password is incorrect" });
  const recoveryCode = generateRecoveryCode();
  await db.updateOperator(operator.id, {
    recoveryCodeHash: await hashPassword(recoveryCode),
    recoveryCodeRotatedAt: nowIso(),
  });
  await securityAudit({ action: "recovery_code_rotated", operator, req });
  res.json({ success: true, recoveryCode, recoveryCodeNotice: "Save this recovery code securely. The previous code is no longer valid." });
}

export async function listSessions(req, res) {
  const sessions = await authStore.listActiveForOperator(req.operator.id);
  res.json({
    sessions: sessions.map((session) => ({
      id: fingerprint(session.sid),
      current: session.sid === req.authSession?.sid,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
    })),
  });
}

export async function revokeOtherSessions(req, res) {
  if (!req.authSession?.sid) return res.status(409).json({ error: "A Phase 15 session is required" });
  const count = await authStore.revokeOthersForOperator(req.operator.id, req.authSession.sid);
  await securityAudit({ action: "other_sessions_revoked", operator: req.operator, req, details: { revokedSessions: count } });
  res.json({ success: true, revokedSessions: count });
}

export async function adminRotateRecoveryCode(req, res) {
  const operator = await db.getOperatorById(req.params.id);
  if (!operator) return res.status(404).json({ error: "Operator not found" });
  const recoveryCode = generateRecoveryCode();
  await db.updateOperator(operator.id, {
    recoveryCodeHash: await hashPassword(recoveryCode),
    recoveryCodeRotatedAt: nowIso(),
  });
  await securityAudit({ action: "admin_recovery_code_rotated", operator: req.operator, req, details: { targetOperatorId: operator.id } });
  res.json({ operatorId: operator.id, recoveryCode, recoveryCodeNotice: "Deliver this code through your verified support process. It is not stored in plaintext." });
}

export { publicOperator, normalisePhone, securityAudit };
