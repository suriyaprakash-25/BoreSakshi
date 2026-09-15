import "dotenv/config";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { MongoClient } from "mongodb";
import {
  buildBackupManifest,
  encodeJsonLines,
  encryptBackup,
  gzip,
  parseBackupKey,
  sha256,
} from "../backupCore.js";

const COLLECTIONS = [
  "borewells",
  "predictions",
  "operators",
  "assignments",
  "ingestion_batches",
  "staged_borewells",
  "ingestion_audit",
  "dataset_assets",
  "auth_sessions",
  "schema_migrations",
];

function safeStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "BoreSakshi";
  if (!uri) throw new Error("MONGODB_URI is required");
  const key = parseBackupKey();
  const root = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), "backups"));
  const createdAt = new Date().toISOString();
  const output = path.join(root, safeStamp(new Date(createdAt)));
  await mkdir(output, { recursive: false });

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const database = client.db(dbName);
    const entries = [];
    for (const name of COLLECTIONS) {
      const docs = await database.collection(name).find({}).sort({ _id: 1 }).toArray();
      const redacted = docs.map(({ _id, ...doc }) => doc);
      const compressed = gzip(encodeJsonLines(redacted));
      const encrypted = encryptBackup(compressed, key);
      const file = `${name}.jsonl.gz.enc`;
      await writeFile(path.join(output, file), encrypted.bytes, { flag: "wx", mode: 0o600 });
      entries.push({
        name,
        file,
        count: redacted.length,
        sha256: sha256(encrypted.bytes),
        plaintextSha256: sha256(compressed),
        algorithm: encrypted.algorithm,
        ivBase64: encrypted.ivBase64,
        authTagBase64: encrypted.authTagBase64,
      });
    }
    const manifest = buildBackupManifest({ database: dbName, createdAt, collections: entries, encrypted: true });
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(path.join(output, "manifest.json"), bytes, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(output, "manifest.sha256"), `${sha256(bytes)}  manifest.json\n`, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ ok: true, output, database: dbName, collections: entries.map(({ name, count }) => ({ name, count })) }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`BACKUP_FAILED: ${error.message}`);
  process.exit(2);
});
