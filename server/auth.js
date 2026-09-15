// auth.js — cookie sessions, account auth, authorization, and CSRF protection.
import bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { db } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const COOKIE_SAME_SITE = (process.env.COOKIE_SAME_SITE || "strict").toLowerCase();

if (!JWT_SECRET) {
  console.error("[BoreSakshi] FATAL: JWT_SECRET is not set. Set it in server/.env");
  process.exit(1);
}
if (!["strict", "lax", "none"].includes(COOKIE_SAME_SITE)) {
  console.error("[BoreSakshi] FATAL: COOKIE_SAME_SITE must be strict, lax, or none.");
  process.exit(1);
}

// SameSite=None is required when frontend and API are deployed on different
// sites, and browsers require it to be paired with Secure.
const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" || COOKIE_SAME_SITE === "none",
  sameSite: COOKIE_SAME_SITE,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const publicOperator = (op) => ({
  id: op.id,
  name: op.name,
  phone: op.phone,
  role: op.role || "operator",
  status: op.status || "active",
  verified: !!op.verified,
});

function issueToken(op, csrfToken) {
  return jwt.sign(
    { id: op.id, name: op.name, role: op.role || "operator", csrfToken },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function issueSession(res, operator, status = 200) {
  const csrfToken = randomBytes(32).toString("base64url");
  res.cookie("token", issueToken(operator, csrfToken), sessionCookieOptions);
  res.status(status).json({ operator: publicOperator(operator), csrfToken });
}

const normalisePhone = (p) => String(p || "").replace(/[^\d]/g, "");

export async function signup(req, res) {
  const { name, phone, password } = req.body;
  const cleanName = String(name).trim();
  const cleanPhone = normalisePhone(phone);

  if (!cleanName) return res.status(400).json({ error: "Name is required" });
  if (cleanPhone.length < 7) return res.status(400).json({ error: "A valid phone number is required" });

  const existing = await db.getOperatorByPhone(cleanPhone);
  if (existing) return res.status(409).json({ error: "An account with this phone already exists — sign in instead" });

  const passwordHash = await bcrypt.hash(String(password), 10);
  const operator = {
    id: nanoid(12),
    name: cleanName,
    phone: cleanPhone,
    passwordHash,
    role: "operator",
    status: "active",
    verified: false,
    createdAt: new Date().toISOString(),
  };
  try {
    await db.addOperator(operator);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "An account with this phone already exists — sign in instead" });
    }
    throw err;
  }
  await db.seedAssignmentsForOperator(operator.id);
  issueSession(res, operator, 201);
}

export async function signin(req, res) {
  const { phone, password } = req.body;
  const cleanPhone = normalisePhone(phone);
  const operator = await db.getOperatorByPhone(cleanPhone);
  const bad = () => res.status(401).json({ error: "Invalid phone or password" });
  if (!operator) return bad();

  const ok = await bcrypt.compare(String(password), operator.passwordHash);
  if (!ok) return bad();
  if (operator.status === "deactivated") {
    return res.status(403).json({ error: "This account has been deactivated. Please contact the administrator." });
  }
  issueSession(res, operator);
}

export async function signout(_req, res) {
  res.clearCookie("token", {
    httpOnly: true,
    secure: sessionCookieOptions.secure,
    sameSite: sessionCookieOptions.sameSite,
  });
  res.json({ success: true });
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    let token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token && req.cookies?.token) token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Sign in to continue" });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Session expired — please sign in again" });
    }

    const op = await db.getOperatorById(payload.id);
    if (!op) return res.status(401).json({ error: "Account not found — please sign in again" });
    if (op.status === "deactivated") {
      return res.status(403).json({ error: "Your account has been deactivated. Please contact the administrator." });
    }

    req.operator = {
      id: op.id,
      name: op.name,
      role: op.role || "operator",
      status: op.status || "active",
      verified: !!op.verified,
    };
    req.csrfToken = payload.csrfToken || null;
    next();
  } catch (err) {
    next(err);
  }
}

// Required after requireAuth for all cookie-authenticated state changes.
export function requireCsrf(req, res, next) {
  const supplied = req.get("X-CSRF-Token");
  if (!req.csrfToken || !supplied) {
    return res.status(403).json({ error: "Invalid or missing CSRF token. Refresh and try again." });
  }
  const expectedBuffer = Buffer.from(req.csrfToken);
  const suppliedBuffer = Buffer.from(supplied);
  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    return res.status(403).json({ error: "Invalid or missing CSRF token. Refresh and try again." });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.operator) return res.status(401).json({ error: "Sign in to continue" });
  if (req.operator.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}
