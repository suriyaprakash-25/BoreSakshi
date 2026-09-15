import "dotenv/config";
import { MongoClient } from "mongodb";
import { migration as phase18ProductionV1 } from "./phase18-production-v1.js";

export const migrations = [phase18ProductionV1];

export async function migrationStatus(database) {
  const applied = await database.collection("schema_migrations")
    .find({}, { projection: { _id: 0 } }).sort({ appliedAt: 1 }).toArray();
  const appliedIds = new Set(applied.map((item) => item.id));
  return migrations.map((item) => ({
    id: item.id,
    description: item.description,
    applied: appliedIds.has(item.id),
    appliedAt: applied.find((entry) => entry.id === item.id)?.appliedAt || null,
  }));
}

export async function migrateUp(database, { actor = "phase18-deploy" } = {}) {
  const ledger = database.collection("schema_migrations");
  await ledger.createIndex({ id: 1 }, { unique: true });
  const applied = new Set((await ledger.find({}, { projection: { id: 1 } }).toArray()).map((item) => item.id));
  const completed = [];
  for (const item of migrations) {
    if (applied.has(item.id)) continue;
    await item.up(database);
    const appliedAt = new Date().toISOString();
    await ledger.insertOne({ id: item.id, description: item.description, appliedAt, actor });
    completed.push({ id: item.id, appliedAt });
  }
  return completed;
}

export async function migrateDown(database, { actor = "phase18-rollback" } = {}) {
  if (process.env.BORESAKSHI_MIGRATION_ROLLBACK_APPROVED !== "YES") {
    throw new Error("BORESAKSHI_MIGRATION_ROLLBACK_APPROVED=YES is required for database rollback");
  }
  const ledger = database.collection("schema_migrations");
  const latest = await ledger.findOne({}, { sort: { appliedAt: -1 } });
  if (!latest) return null;
  const item = migrations.find((candidate) => candidate.id === latest.id);
  if (!item) throw new Error(`Applied migration ${latest.id} is not present in this release`);
  await item.down(database);
  await ledger.deleteOne({ id: item.id });
  return { id: item.id, rolledBackAt: new Date().toISOString(), actor };
}

async function main() {
  const command = process.argv[2] || "status";
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const database = client.db(process.env.MONGODB_DB || "BoreSakshi");
    let result;
    if (command === "status") result = await migrationStatus(database);
    else if (command === "up") result = await migrateUp(database);
    else if (command === "down") result = await migrateDown(database);
    else throw new Error("Usage: node migrations/runner.js [status|up|down]");
    console.log(JSON.stringify({ ok: true, command, result }, null, 2));
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`MIGRATION_FAILED: ${error.message}`);
    process.exit(2);
  });
}
