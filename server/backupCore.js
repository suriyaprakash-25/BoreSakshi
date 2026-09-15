import crypto from "crypto";
import zlib from "zlib";

export const BACKUP_SCHEMA_VERSION = "15.0.0";

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function encodeJsonLines(documents) {
  const text = documents.map((doc) => JSON.stringify(doc)).join("\n");
  return Buffer.from(text ? `${text}\n` : "", "utf8");
}

export function decodeJsonLines(buffer) {
  const text = Buffer.from(buffer).toString("utf8").trim();
  if (!text) return [];
  return text.split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) {
      const wrapped = new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
      wrapped.code = "BACKUP_JSONL_INVALID";
      throw wrapped;
    }
  });
}

export function gzip(buffer) {
  return zlib.gzipSync(buffer, { level: 9 });
}

export function gunzip(buffer) {
  return zlib.gunzipSync(buffer);
}

export function parseBackupKey(base64 = process.env.BACKUP_ENCRYPTION_KEY_BASE64) {
  if (!base64) throw new Error("BACKUP_ENCRYPTION_KEY_BASE64 is required for encrypted backups");
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes");
  return key;
}

export function encryptBackup(buffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    bytes: ciphertext,
    ivBase64: iv.toString("base64"),
    authTagBase64: tag.toString("base64"),
    algorithm: "aes-256-gcm",
  };
}

export function decryptBackup(buffer, key, { ivBase64, authTagBase64, algorithm }) {
  if (algorithm !== "aes-256-gcm") throw new Error(`Unsupported backup encryption algorithm: ${algorithm}`);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

export function buildBackupManifest({ database, createdAt, collections, encrypted }) {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt,
    database,
    encrypted: Boolean(encrypted),
    collections,
  };
}

export function validateBackupManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("Backup manifest must be an object");
  if (manifest.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error(`Unsupported backup schemaVersion: ${manifest.schemaVersion}`);
  if (!manifest.createdAt || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("Backup manifest createdAt is invalid");
  if (!manifest.database || typeof manifest.database !== "string") throw new Error("Backup manifest database is required");
  if (!Array.isArray(manifest.collections) || !manifest.collections.length) throw new Error("Backup manifest must list collections");
  const names = new Set();
  for (const item of manifest.collections) {
    if (!item?.name || !item?.file || !/^[a-f0-9]{64}$/i.test(item.sha256 || "")) throw new Error("Backup collection entry is incomplete");
    if (!Number.isInteger(item.count) || item.count < 0) throw new Error(`Backup collection ${item.name} has invalid count`);
    if (names.has(item.name)) throw new Error(`Duplicate backup collection entry: ${item.name}`);
    names.add(item.name);
    if (manifest.encrypted) {
      if (item.algorithm !== "aes-256-gcm" || !item.ivBase64 || !item.authTagBase64) {
        throw new Error(`Encrypted backup collection ${item.name} is missing AES-GCM metadata`);
      }
    }
  }
  return true;
}
