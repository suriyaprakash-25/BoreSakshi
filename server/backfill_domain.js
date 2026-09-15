// backfill_domain.js — incremental Borewell domain backfill.
// Default mode is read-only. Use --apply only after reviewing the dry-run report
// and backing up the target database.
import "dotenv/config";
import { MongoClient } from "mongodb";
import { nanoid } from "nanoid";

const apply = process.argv.includes("--apply");
const URI = process.env.MONGODB_URI || "mongodb://localhost:27017/";
const DB_NAME = process.env.MONGODB_DB || "BoreSakshi";

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
const summary = { scanned: 0, wouldUpdate: 0, updated: 0, observationsCreated: 0, skipped: 0 };

function missing(value) {
  return value === undefined || value === null || value === "";
}

function domainPatch(record) {
  const patch = {};
  if (missing(record.publicId)) patch.publicId = "BW-" + nanoid(10).toUpperCase();
  if (missing(record.drillingDate)) patch.drillingDate = record.createdAt || new Date().toISOString();
  if (missing(record.status)) patch.status = record.success ? "ACTIVE" : "DRY";
  if (missing(record.verificationStatus)) {
    patch.verificationStatus = record.verified ? "VERIFIED" : "SUBMITTED";
  }
  if (missing(record.geology)) patch.geology = record.strata || "";
  if (missing(record.createdBy) && record.operatorId) patch.createdBy = record.operatorId;
  return patch;
}

async function main() {
  await client.connect();
  const database = client.db(DB_NAME);
  const borewells = database.collection("borewells");
  const observations = database.collection("borewellObservations");

  const records = await borewells.find({}, { projection: { _id: 0 } }).toArray();
  for (const record of records) {
    summary.scanned++;
    const patch = domainPatch(record);
    const hasPatch = Object.keys(patch).length > 0;
    const existingDrilling = await observations.findOne({ borewellId: record.id, type: "DRILLING" });
    const needsObservation = !existingDrilling;

    if (!hasPatch && !needsObservation) {
      summary.skipped++;
      continue;
    }

    summary.wouldUpdate++;
    if (!apply) continue;

    if (hasPatch) await borewells.updateOne({ id: record.id }, { $set: patch });

    if (needsObservation) {
      const merged = { ...record, ...patch };
      await observations.insertOne({
        id: nanoid(10),
        borewellId: record.id,
        type: "DRILLING",
        observedAt: merged.drillingDate,
        depthFt: merged.depthFt ?? null,
        waterStrikeFt: merged.waterStrikeFt ?? null,
        yieldLpm: merged.yieldLpm ?? null,
        status: merged.status,
        geology: merged.geology,
        createdBy: merged.createdBy || null,
        createdAt: new Date().toISOString(),
        migratedFromLegacyRecord: true,
      });
      summary.observationsCreated++;
    }
    summary.updated++;
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", database: DB_NAME, ...summary }, null, 2));
  if (!apply && summary.wouldUpdate > 0) {
    console.log("No data was changed. Review this report, take a backup, then rerun with --apply.");
  }
}

main()
  .catch((error) => {
    console.error("[BoreSakshi] Domain backfill failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => client.close());
