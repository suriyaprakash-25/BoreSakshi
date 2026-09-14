import "dotenv/config";
import path from "path";
import { readdir, rm, stat } from "fs/promises";

const root = path.resolve(process.env.RIG_MEDIA_DIR || path.join(process.cwd(), "rig-media"));
const unbound = path.join(root, "unbound");
const maxAgeMs = Number(process.env.RIG_EVIDENCE_UNBOUND_MAX_AGE_HOURS || 24) * 60 * 60 * 1000;
const cutoff = Date.now() - maxAgeMs;

let removed = 0;
let scanned = 0;

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    scanned += 1;
    const info = await stat(full);
    if (info.mtimeMs < cutoff) {
      await rm(full, { force: true });
      removed += 1;
    }
  }
}

await walk(unbound);
console.log(JSON.stringify({ root: unbound, scanned, removed, maxAgeHours: maxAgeMs / 3600000 }));
