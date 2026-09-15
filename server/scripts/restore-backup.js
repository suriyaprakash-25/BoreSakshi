import "dotenv/config";
import path from "path";
import { readFile } from "fs/promises";
import { MongoClient } from "mongodb";
import {
  decodeJsonLines,
  decryptBackup,
  gunzip,
  parseBackupKey,
  sha256,
  validateBackupManifest,
} from "../backupCore.js";

async function readBackup(root) {
  const manifestBytes = await readFile(path.join(root, "manifest.json"));
  const checksumLine = (await readFile(path.join(root, "manifest.sha256"), "utf8")).trim();
  const expectedManifestSha = checksumLine.split(/\s+/)[0];
  if (sha256(manifestBytes) !== expectedManifestSha) throw new Error("manifest.json checksum mismatch");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  validateBackupManifest(manifest);
  const key = manifest.encrypted ? parseBackupKey() : null;
  const collections = [];
  for (const item of manifest.collections) {
    const bytes = await readFile(path.join(root, item.file));
    if (sha256(bytes) !== item.sha256) throw new Error(`${item.name} encrypted checksum mismatch`);
    const compressed = manifest.encrypted ? decryptBackup(bytes, key, item) : bytes;
    if (item.plaintextSha256 && sha256(compressed) !== item.plaintextSha256) throw new Error(`${item.name} plaintext checksum mismatch`);
    const docs = decodeJsonLines(gunzip(compressed));
    if (docs.length !== item.count) throw new Error(`${item.name} count mismatch`);
    collections.push({ name: item.name, docs });
  }
  return { manifest, collections };
}

async function main() {
  const backupDir = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!backupDir) throw new Error("Usage: node scripts/restore-backup.js <backup-directory> [--apply]");
  const root = path.resolve(backupDir);
  const { manifest, collections } = await readBackup(root);

  if (!apply) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      backupDir: root,
      sourceDatabase: manifest.database,
      targetDatabase: process.env.MONGODB_RESTORE_DB || null,
      collections: collections.map(({ name, docs }) => ({ name, count: docs.length })),
      message: "Backup is decryptable and parseable. Re-run with --apply only after setting BORESAKSHI_RESTORE_APPROVED=YES and an empty MONGODB_RESTORE_DB.",
    }, null, 2));
    return;
  }

  if (process.env.BORESAKSHI_RESTORE_APPROVED !== "YES") throw new Error("Restore requires BORESAKSHI_RESTORE_APPROVED=YES");
  const uri = process.env.MONGODB_URI;
  const targetDb = process.env.MONGODB_RESTORE_DB;
  const activeDb = process.env.MONGODB_DB || "BoreSakshi";
  if (!uri || !targetDb) throw new Error("MONGODB_URI and MONGODB_RESTORE_DB are required for restore");
  if (targetDb === activeDb && process.env.ALLOW_IN_PLACE_RESTORE !== "YES") {
    throw new Error("Refusing in-place restore into the active database; use a separate MONGODB_RESTORE_DB for recovery rehearsal");
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const db = client.db(targetDb);
    for (const { name } of collections) {
      const count = await db.collection(name).countDocuments({});
      if (count > 0) throw new Error(`Target collection ${targetDb}.${name} is not empty`);
    }
    for (const { name, docs } of collections) {
      if (docs.length) await db.collection(name).insertMany(docs, { ordered: true });
    }
    console.log(JSON.stringify({ ok: true, dryRun: false, targetDatabase: targetDb, collections: collections.map(({ name, docs }) => ({ name, count: docs.length })) }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`BACKUP_RESTORE_FAILED: ${error.message}`);
  process.exit(2);
});
