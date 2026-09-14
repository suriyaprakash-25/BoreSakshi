import crypto from "crypto";
import path from "path";
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { nanoid } from "nanoid";

const MIME = {
  "image/jpeg": { kind: "photo", ext: ".jpg", maxBytes: 10 * 1024 * 1024 },
  "image/png": { kind: "photo", ext: ".png", maxBytes: 10 * 1024 * 1024 },
  "image/webp": { kind: "photo", ext: ".webp", maxBytes: 10 * 1024 * 1024 },
  "video/mp4": { kind: "video", ext: ".mp4", maxBytes: 50 * 1024 * 1024 },
  "video/webm": { kind: "video", ext: ".webm", maxBytes: 50 * 1024 * 1024 },
};

const root = () => path.resolve(process.env.RIG_MEDIA_DIR || path.join(process.cwd(), "rig-media"));
const tokenSecret = () => process.env.RIG_EVIDENCE_SECRET || process.env.JWT_SECRET || "";
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

function signPayload(payload) {
  const secret = tokenSecret();
  if (!secret) throw new Error("RIG_EVIDENCE_SECRET or JWT_SECRET is required");
  const encoded = b64(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyEvidenceToken(token, { operatorId, now = Date.now() } = {}) {
  const secret = tokenSecret();
  if (!secret) throw new Error("RIG_EVIDENCE_SECRET or JWT_SECRET is required");
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) throw new Error("Invalid evidence token");
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error("Invalid evidence token signature");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (payload.exp && now > payload.exp) throw new Error("Evidence token expired");
  if (operatorId && payload.operatorId !== operatorId) throw new Error("Evidence belongs to another operator");
  return payload;
}

function safeFilename(name) {
  return String(name || "evidence")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 100) || "evidence";
}

function fullPath(objectKey) {
  const base = root();
  const resolved = path.resolve(base, objectKey);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error("Unsafe evidence path");
  return resolved;
}

export async function storeEvidenceUpload({ buffer, mediaType, originalName, operatorId, now = new Date() }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Evidence file is empty");
  const cfg = MIME[String(mediaType || "").toLowerCase()];
  if (!cfg) throw new Error("Unsupported evidence type. Use JPEG, PNG, WebP, MP4, or WebM.");
  if (buffer.length > cfg.maxBytes) throw new Error(`${cfg.kind === "photo" ? "Photo" : "Video"} is too large`);

  const id = nanoid(14);
  const objectKey = path.posix.join("unbound", operatorId, `${id}${cfg.ext}`);
  const target = fullPath(objectKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer, { flag: "wx" });

  const createdAt = now.toISOString();
  const metadata = {
    id,
    kind: cfg.kind,
    mediaType: mediaType.toLowerCase(),
    originalName: safeFilename(originalName),
    byteSize: buffer.length,
    sha256: sha256(buffer),
    storageProvider: "local_filesystem",
    objectKey,
    operatorId,
    createdAt,
  };
  const token = signPayload({ ...metadata, exp: now.getTime() + 24 * 60 * 60 * 1000 });
  return { metadata, token };
}

export async function resolveEvidenceTokens(tokens, operatorId) {
  const unique = new Map();
  for (const token of tokens || []) {
    const meta = verifyEvidenceToken(token, { operatorId });
    if (unique.has(meta.id)) throw new Error("Duplicate evidence file reference");
    const bytes = await readFile(fullPath(meta.objectKey));
    if (bytes.length !== meta.byteSize || sha256(bytes) !== meta.sha256) throw new Error(`Evidence integrity check failed for ${meta.id}`);
    unique.set(meta.id, {
      id: meta.id,
      kind: meta.kind,
      mediaType: meta.mediaType,
      originalName: meta.originalName,
      byteSize: meta.byteSize,
      sha256: meta.sha256,
      storageProvider: meta.storageProvider,
      objectKey: meta.objectKey,
      createdAt: meta.createdAt,
    });
  }
  const evidence = [...unique.values()];
  const photos = evidence.filter((item) => item.kind === "photo");
  const videos = evidence.filter((item) => item.kind === "video");
  if (photos.length < 1) throw new Error("At least one evidence photo is required");
  if (photos.length > 8) throw new Error("A maximum of 8 photos is allowed");
  if (videos.length > 2) throw new Error("A maximum of 2 videos is allowed");
  return evidence;
}

export async function bindEvidenceToBorewell(evidence, borewellId) {
  const bound = [];
  for (const item of evidence) {
    const ext = path.extname(item.objectKey);
    const objectKey = path.posix.join("borewells", borewellId, `${item.id}${ext}`);
    const source = fullPath(item.objectKey);
    const target = fullPath(objectKey);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(source, target);
    bound.push({ ...item, objectKey, boundBorewellId: borewellId });
  }
  return bound;
}

export async function deleteUnboundEvidence(token, operatorId) {
  const meta = verifyEvidenceToken(token, { operatorId });
  if (!String(meta.objectKey || "").startsWith("unbound/")) throw new Error("Bound evidence cannot be deleted through the upload endpoint");
  await unlink(fullPath(meta.objectKey)).catch((err) => {
    if (err.code !== "ENOENT") throw err;
  });
  return { id: meta.id };
}

export async function readStoredEvidence(metadata) {
  const bytes = await readFile(fullPath(metadata.objectKey));
  if (sha256(bytes) !== metadata.sha256) throw new Error("Stored evidence checksum mismatch");
  return bytes;
}

export const evidenceConfig = {
  acceptedMediaTypes: Object.keys(MIME),
  maxPhotoBytes: 10 * 1024 * 1024,
  maxVideoBytes: 50 * 1024 * 1024,
};
