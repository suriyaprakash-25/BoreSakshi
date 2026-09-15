import "dotenv/config";
import path from "path";
import { readFile } from "fs/promises";
import {
  decodeJsonLines,
  decryptBackup,
  gunzip,
  parseBackupKey,
  sha256,
  validateBackupManifest,
} from "../backupCore.js";

async function main() {
  const backupDir = process.argv[2];
  if (!backupDir) throw new Error("Usage: node scripts/verify-backup.js <backup-directory>");
  const root = path.resolve(backupDir);
  const manifestBytes = await readFile(path.join(root, "manifest.json"));
  const checksumLine = (await readFile(path.join(root, "manifest.sha256"), "utf8")).trim();
  const expectedManifestSha = checksumLine.split(/\s+/)[0];
  if (sha256(manifestBytes) !== expectedManifestSha) throw new Error("manifest.json checksum mismatch");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  validateBackupManifest(manifest);
  const key = manifest.encrypted ? parseBackupKey() : null;
  const verified = [];
  for (const item of manifest.collections) {
    const bytes = await readFile(path.join(root, item.file));
    if (sha256(bytes) !== item.sha256) throw new Error(`${item.name} encrypted checksum mismatch`);
    const compressed = manifest.encrypted ? decryptBackup(bytes, key, item) : bytes;
    if (item.plaintextSha256 && sha256(compressed) !== item.plaintextSha256) throw new Error(`${item.name} plaintext checksum mismatch`);
    const docs = decodeJsonLines(gunzip(compressed));
    if (docs.length !== item.count) throw new Error(`${item.name} count mismatch: manifest=${item.count} decoded=${docs.length}`);
    verified.push({ name: item.name, count: docs.length });
  }
  console.log(JSON.stringify({ ok: true, backupDir: root, database: manifest.database, createdAt: manifest.createdAt, collections: verified }, null, 2));
}

main().catch((error) => {
  console.error(`BACKUP_VERIFY_FAILED: ${error.message}`);
  process.exit(2);
});
