// Phase 2 legacy borewell metadata migration.
// Default is DRY RUN. Applying or rolling back requires BOTH a CLI flag and the
// explicit PHASE2_MIGRATION_APPROVED=YES environment gate.
import "dotenv/config";
import { MongoClient } from "mongodb";
import { DATASET_SCHEMA_VERSION, buildDuplicateFingerprint } from "../ingestion.js";

const MIGRATION_ID = "phase2-v1";
const URI = process.env.MONGODB_URI || "mongodb://localhost:27017/";
const DB_NAME = process.env.MONGODB_DB || "BoreSakshi";
const args = new Set(process.argv.slice(2));
const mode = args.has("--rollback") ? "rollback" : args.has("--apply") ? "apply" : "dry-run";

if ((mode === "apply" || mode === "rollback") && process.env.PHASE2_MIGRATION_APPROVED !== "YES") {
  console.error("Refusing write operation. Set PHASE2_MIGRATION_APPROVED=YES after the Phase 2 review gate is approved.");
  process.exit(2);
}

const managedFields = [
  "schemaVersion",
  "location",
  "drilledAt",
  "drilledDate",
  "datasetEligibility",
  "provenance",
  "ingestionFingerprint",
  "phase2MigrationVersion",
];

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const snapshot = (doc) => Object.fromEntries(managedFields.map((field) => [field, {
  existed: own(doc, field),
  ...(own(doc, field) ? { value: doc[field] } : {}),
}]));

function validCoords(doc) {
  return Number.isFinite(doc.lat) && Number.isFinite(doc.lng)
    && doc.lat >= -90 && doc.lat <= 90 && doc.lng >= -180 && doc.lng <= 180;
}

function legacyPatch(doc) {
  const patch = {};
  const timestamp = doc.drilledAt || doc.createdAt || null;
  if (!own(doc, "schemaVersion")) patch.schemaVersion = DATASET_SCHEMA_VERSION;
  if (!own(doc, "location") && validCoords(doc)) patch.location = { type: "Point", coordinates: [doc.lng, doc.lat] };
  if (!own(doc, "drilledAt")) patch.drilledAt = timestamp;
  if (!own(doc, "drilledDate")) patch.drilledDate = timestamp ? String(timestamp).slice(0, 10) : "";
  if (!own(doc, "datasetEligibility")) patch.datasetEligibility = { eligible: true, status: "legacy_preserved" };

  const source = {
    sourceType: doc.operatorId ? "operator" : "historical",
    sourceName: doc.operatorId ? "Legacy BoreSakshi operator submission" : "Legacy BoreSakshi dataset",
  };
  if (!own(doc, "provenance")) {
    patch.provenance = {
      ...source,
      sourceRecordId: doc.id || "",
      importedAt: doc.createdAt || null,
      importedBy: doc.operatorId ? { id: doc.operatorId, name: doc.operatorName || "" } : null,
      migrationId: MIGRATION_ID,
    };
  }
  if (!own(doc, "ingestionFingerprint")) {
    patch.ingestionFingerprint = buildDuplicateFingerprint({
      ...doc,
      sourceRecordId: doc.id || "",
      drilledDate: patch.drilledDate ?? doc.drilledDate ?? "",
    }, source);
  }
  patch.phase2MigrationVersion = MIGRATION_ID;
  return patch;
}

async function reconcile(borewells) {
  const total = await borewells.countDocuments({});
  const versioned = await borewells.countDocuments({ schemaVersion: DATASET_SCHEMA_VERSION });
  const withLocation = await borewells.countDocuments({ "location.type": "Point" });
  const eligible = await borewells.countDocuments({ "datasetEligibility.eligible": true });
  return { total, versioned, withLocation, eligible };
}

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
  const database = client.db(DB_NAME);
  const borewells = database.collection("borewells");
  const backups = database.collection("migration_backups");
  await backups.createIndex({ migrationId: 1, borewellId: 1 }, { unique: true });

  if (mode === "rollback") {
    const before = await reconcile(borewells);
    const backupRows = await backups.find({ migrationId: MIGRATION_ID }).toArray();
    let restored = 0;
    for (const backup of backupRows) {
      const $set = {};
      const $unset = {};
      for (const [field, state] of Object.entries(backup.before || {})) {
        if (state.existed) $set[field] = state.value;
        else $unset[field] = "";
      }
      const update = {};
      if (Object.keys($set).length) update.$set = $set;
      if (Object.keys($unset).length) update.$unset = $unset;
      if (Object.keys(update).length) {
        const result = await borewells.updateOne({ id: backup.borewellId }, update);
        restored += result.modifiedCount;
      }
    }
    const after = await reconcile(borewells);
    console.log(JSON.stringify({ migrationId: MIGRATION_ID, mode, backups: backupRows.length, restored, before, after }, null, 2));
  } else {
    const before = await reconcile(borewells);
    const docs = await borewells.find({}).toArray();
    let wouldChange = 0;
    let applied = 0;
    let invalidCoordinates = 0;
    for (const doc of docs) {
      if (!validCoords(doc)) invalidCoordinates += 1;
      const patch = legacyPatch(doc);
      const meaningful = Object.keys(patch).some((key) => key !== "phase2MigrationVersion" && !own(doc, key));
      if (!meaningful && doc.phase2MigrationVersion === MIGRATION_ID) continue;
      wouldChange += 1;
      if (mode === "apply") {
        await backups.updateOne(
          { migrationId: MIGRATION_ID, borewellId: doc.id },
          { $setOnInsert: { migrationId: MIGRATION_ID, borewellId: doc.id, before: snapshot(doc), createdAt: new Date().toISOString() } },
          { upsert: true }
        );
        const result = await borewells.updateOne({ id: doc.id }, { $set: patch });
        applied += result.modifiedCount;
      }
    }
    const after = mode === "apply" ? await reconcile(borewells) : before;
    console.log(JSON.stringify({
      migrationId: MIGRATION_ID,
      mode,
      wouldChange,
      applied,
      invalidCoordinates,
      before,
      after,
      gate: mode === "dry-run" ? "No writes performed. Review reconciliation counts before --apply." : "Approved write gate satisfied.",
    }, null, 2));
  }
} finally {
  await client.close();
}
