// auth.js — operator + admin accounts (signup / signin) + JWT auth middleware.
// One auth flow for everyone; an account's `role` ('operator' | 'admin') decides
// its permissions. Admins are created by setting role:'admin' directly in MongoDB
// (there is no in-app role management). Request bodies are validated upstream.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { db } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "boresakshi-dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("[BoreSakshi] FATAL: JWT_SECRET is not set in production.");
    process.exit(1);
  }
  console.warn("[BoreSakshi] WARNING: JWT_SECRET not set — using an insecure dev default. Set it in server/.env");
}

// safe view of an account — never the passwordHash. Older accounts may predate
// these fields, so default them here.
const publicOperator = (op) => ({
  id: op.id,
  name: op.name,
  phone: op.phone,
  role: op.role || "operator",
  status: op.status || "active",
  verified: !!op.verified,
});

function issueToken(op) {
  return jwt.sign({ id: op.id, name: op.name, role: op.role || "operator" }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// normalise phone to digits so "+91 98765 43210" and "9876543210" don't collide
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
    role: "operator",   // admins are promoted manually in the DB, never via signup
    status: "active",
    verified: false,
    createdAt: new Date().toISOString(),
  };
  await db.addOperator(operator);
  // starter work queue so the new operator's dashboard has assigned sites to log
  await db.seedAssignmentsForOperator(operator.id);

  res.status(201).json({ token: issueToken(operator), operator: publicOperator(operator) });
}

export async function signin(req, res) {
  const { phone, password } = req.body;
  const cleanPhone = normalisePhone(phone);

  const operator = await db.getOperatorByPhone(cleanPhone);
  // same message whether the phone or the password is wrong (don't leak which)
  const bad = () => res.status(401).json({ error: "Invalid phone or password" });
  if (!operator) return bad();

  const ok = await bcrypt.compare(String(password), operator.passwordHash);
  if (!ok) return bad();

  // deactivated accounts can't start a new session
  if (operator.status === "deactivated") {
    return res.status(403).json({ error: "This account has been deactivated. Please contact the administrator." });
  }

  res.json({ token: issueToken(operator), operator: publicOperator(operator) });
}

// middleware: require a valid Bearer token AND an active account. Re-reads the
// account from the DB on every request so a deactivation (or role change) takes
// effect immediately, even for an already-issued token. Attaches req.operator.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
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
    next();
  } catch (err) {
    next(err);
  }
}

// middleware: require an admin. Must run AFTER requireAuth.
export function requireAdmin(req, res, next) {
  if (!req.operator) return res.status(401).json({ error: "Sign in to continue" });
  if (req.operator.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}
