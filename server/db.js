// db.js — MongoDB-backed store.
// Connection: mongodb://localhost:27017/  |  Database: BoreSakshi
// All data access is isolated here. index.js just awaits these methods.
import { MongoClient } from "mongodb";
import { nanoid } from "nanoid";

const URI = process.env.MONGODB_URI || "mongodb://localhost:27017/";
const DB_NAME = process.env.MONGODB_DB || "BoreSakshi";

// serverSelectionTimeoutMS keeps calls (incl. the health check) from hanging for
// the 30s default when Mongo is unreachable — they fail fast with a clear error.
const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
let borewells, predictions, operators, assignments;
let ingestionBatches, stagedBorewells, ingestionAudit, datasetAssets;

// call once at server startup
export async function connectDB() {
  await client.connect();
  const database = client.db(DB_NAME);
  borewells = database.collection("borewells");
  predictions = database.collection("predictions");
  operators = database.collection("operators");
  assignments = database.collection("assignments");
  ingestionBatches = database.collection("ingestion_batches");
  stagedBorewells = database.collection("staged_borewells");
  ingestionAudit = database.collection("ingestion_audit");
  datasetAssets = database.collection("dataset_assets");

  // helpful indexes (id lookups + geo-ish range scans stay fast)
  await borewells.createIndex({ id: 1 }, { unique: true });
  await borewells.createIndex({ operatorId: 1 }); // operator dashboards/history
  await borewells.createIndex({ location: "2dsphere" });
  await borewells.createIndex({ ingestionFingerprint: 1 }, { sparse: true });
  await borewells.createIndex({ drilledDate: 1 }, { sparse: true });
  await predictions.createIndex({ id: 1 }, { unique: true });
  await operators.createIndex({ id: 1 }, { unique: true });
  await operators.createIndex({ phone: 1 }, { unique: true }); // one account per phone
  await assignments.createIndex({ id: 1 }, { unique: true });
  await assignments.createIndex({ operatorId: 1 });

  // Phase 2 staging/provenance/audit indexes.
  await ingestionBatches.createIndex({ id: 1 }, { unique: true });
  await ingestionBatches.createIndex({ createdAt: -1 });
  await stagedBorewells.createIndex({ id: 1 }, { unique: true });
  await stagedBorewells.createIndex({ batchId: 1, rowNumber: 1 });
  await stagedBorewells.createIndex({ fingerprint: 1 });
  await stagedBorewells.createIndex({ reviewStatus: 1 });
  await stagedBorewells.createIndex({ location: "2dsphere" });
  await ingestionAudit.createIndex({ id: 1 }, { unique: true });
  await ingestionAudit.createIndex({ batchId: 1, createdAt: -1 });
  await ingestionAudit.createIndex({ recordId: 1, createdAt: -1 }, { sparse: true });
  await ingestionAudit.createIndex({ scopeType: 1, scopeId: 1, createdAt: -1 }, { sparse: true });
  await datasetAssets.createIndex({ id: 1 }, { unique: true });
  await datasetAssets.createIndex({ sha256: 1 }, { unique: true });
  await datasetAssets.createIndex({ datasetKind: 1, createdAt: -1 });

  console.log(`MongoDB connected → ${DB_NAME} (collections: borewells, predictions, operators, assignments, ingestion_batches, staged_borewells, ingestion_audit, dataset_assets)`);
}

// lightweight liveness check for the health route. Returns false (never throws)
// if the database can't be reached, so /api/health always answers.
export async function pingDB() {
  try {
    await client.db(DB_NAME).command({ ping: 1 });
    return true;
  } catch (err) {
    console.error("[BoreSakshi] MongoDB ping failed:", err.message);
    return false;
  }
}

const NO_MONGO_ID = { projection: { _id: 0 } }; // never leak Mongo's _id to the API

export const db = {
  // --- borewell drill logs (the verified-outcome data) ---
  async addBorewell(record) {
    await borewells.insertOne({ ...record });
    return record;
  },
  async getBorewells() {
    return borewells.find({}, NO_MONGO_ID).limit(5000).toArray();
  },
  // admin: every log, newest first (flag/verify fields included)
  async getAllBorewells() {
    return borewells.find({}, NO_MONGO_ID).sort({ createdAt: -1 }).limit(5000).toArray();
  },
  async updateBorewell(id, patch) {
    const result = await borewells.findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: "after", projection: { _id: 0 } }
    );
    return result || null;
  },
  // one operator's own logs, newest first (for their dashboard + history)
  async getBorewellsByOperator(operatorId) {
    return borewells.find({ operatorId }, NO_MONGO_ID).sort({ createdAt: -1 }).limit(5000).toArray();
  },

  // --- predictions we issued (for the accountability ledger) ---
  async addPrediction(record) {
    await predictions.insertOne({ ...record });
    return record;
  },
  async getPredictions() {
    return predictions.find({}, NO_MONGO_ID).limit(5000).toArray();
  },
  async updatePrediction(id, patch) {
    const result = await predictions.findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: "after", projection: { _id: 0 } }
    );
    return result || null;
  },

  // --- rig operators (accounts) ---
  async addOperator(record) {
    await operators.insertOne({ ...record });
    return record;
  },
  // includes passwordHash — used only for sign-in verification, never sent to clients
  async getOperatorByPhone(phone) {
    return operators.findOne({ phone }, NO_MONGO_ID);
  },
  async getOperatorById(id) {
    return operators.findOne({ id }, NO_MONGO_ID);
  },
  // admin: all accounts, without the password hash
  async getOperators() {
    return operators.find({}, { projection: { _id: 0, passwordHash: 0 } }).sort({ createdAt: -1 }).limit(5000).toArray();
  },
  // admin can change status/verified only (never role — no in-app role management)
  async updateOperator(id, patch) {
    const result = await operators.findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: "after", projection: { _id: 0, passwordHash: 0 } }
    );
    return result || null;
  },

  // --- assigned sites awaiting a log (operator work queue) ---
  async getAssignmentsByOperator(operatorId, { status } = {}) {
    const query = { operatorId };
    if (status) query.status = status;
    return assignments.find(query, NO_MONGO_ID).sort({ assignedAt: 1 }).limit(5000).toArray();
  },
  async countAssignmentsByOperator(operatorId) {
    return assignments.countDocuments({ operatorId });
  },
  async updateAssignment(id, patch) {
    const result = await assignments.findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: "after", projection: { _id: 0 } }
    );
    return result || null;
  },
  // give a new operator a starter work queue so the dashboard has real content.
  // Sample sites around the Namakkal / Tiruchengode belt (matches the demo map).
  async seedAssignmentsForOperator(operatorId) {
    const sites = [
      { village: "Tiruchengode", lat: 11.383, lng: 77.895, note: "Farmer request · 2 acre plot" },
      { village: "Pallipalayam", lat: 11.362, lng: 77.805, note: "Panchayat borewell" },
      { village: "Mallasamudram", lat: 11.512, lng: 78.020, note: "Repeat customer" },
    ];
    const now = Date.now();
    const docs = sites.map((s, i) => ({
      id: nanoid(10),
      operatorId,
      village: s.village,
      lat: s.lat,
      lng: s.lng,
      note: s.note,
      status: "pending",
      assignedAt: new Date(now - i * 86400000).toISOString(),
    }));
    await assignments.insertMany(docs);
    return docs;
  },

  // --- Phase 2: real-data ingestion batches ---
  async addIngestionBatch(batch) {
    await ingestionBatches.insertOne({ ...batch });
    return batch;
  },
  async getIngestionBatch(id) {
    return ingestionBatches.findOne({ id }, NO_MONGO_ID);
  },
  async updateIngestionBatch(id, patch) {
    return ingestionBatches.findOneAndUpdate(
      { id }, { $set: patch }, { returnDocument: "after", projection: { _id: 0 } }
    );
  },
  async listIngestionBatches({ page = 1, limit = 25 } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
    const [items, total] = await Promise.all([
      ingestionBatches.find({}, NO_MONGO_ID).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
      ingestionBatches.countDocuments({}),
    ]);
    return { items, total, page: safePage, limit: safeLimit };
  },

  async addStagedBorewells(records) {
    if (!records.length) return [];
    await stagedBorewells.insertMany(records, { ordered: true });
    return records;
  },
  async getStagedBorewell(id) {
    return stagedBorewells.findOne({ id }, NO_MONGO_ID);
  },
  async updateStagedBorewell(id, patch) {
    return stagedBorewells.findOneAndUpdate(
      { id }, { $set: patch }, { returnDocument: "after", projection: { _id: 0 } }
    );
  },
  async listStagedBorewells(batchId, { page = 1, limit = 50, status } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const query = { batchId };
    if (status) query.reviewStatus = status;
    const [items, total] = await Promise.all([
      stagedBorewells.find(query, NO_MONGO_ID).sort({ rowNumber: 1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
      stagedBorewells.countDocuments(query),
    ]);
    return { items, total, page: safePage, limit: safeLimit };
  },
  async getStagedBorewellsForBatch(batchId) {
    return stagedBorewells.find({ batchId }, NO_MONGO_ID).sort({ rowNumber: 1 }).limit(5000).toArray();
  },
  async getPublishableStagedBorewells(batchId) {
    return stagedBorewells.find(
      { batchId, reviewStatus: "approved", datasetEligible: true, publishedAt: null },
      NO_MONGO_ID
    ).sort({ rowNumber: 1 }).limit(5000).toArray();
  },
  async summarizeStagedBatch(batchId) {
    const rows = await stagedBorewells.aggregate([
      { $match: { batchId } },
      { $group: { _id: "$reviewStatus", count: { $sum: 1 } } },
    ]).toArray();
    const byStatus = Object.fromEntries(rows.map((r) => [r._id || "unknown", r.count]));
    const published = await stagedBorewells.countDocuments({ batchId, publishedAt: { $ne: null } });
    return { byStatus, published };
  },

  async findStagedDuplicate({ fingerprint, batchId = null }) {
    const query = { fingerprint, reviewStatus: { $ne: "rejected" } };
    if (batchId) query.batchId = { $ne: batchId };
    return stagedBorewells.findOne(query, { projection: { _id: 0, id: 1, batchId: 1, rowNumber: 1 } });
  },
  async findCanonicalDuplicate({ fingerprint, location, drilledDate }) {
    if (fingerprint) {
      const exact = await borewells.findOne({ ingestionFingerprint: fingerprint }, { projection: { _id: 0, id: 1 } });
      if (exact) return exact;
    }
    if (!location || !drilledDate) return null;
    return borewells.findOne(
      {
        drilledDate,
        location: {
          $near: {
            $geometry: location,
            $maxDistance: 50,
          },
        },
      },
      { projection: { _id: 0, id: 1 } }
    );
  },

  // Idempotent publish: repeated calls cannot duplicate canonical records.
  async publishImportedBorewells(records) {
    if (!records.length) return { upsertedCount: 0 };
    const result = await borewells.bulkWrite(records.map((record) => ({
      updateOne: {
        filter: { id: record.id },
        update: { $setOnInsert: record },
        upsert: true,
      },
    })), { ordered: true });
    return { upsertedCount: result.upsertedCount || 0 };
  },
  async markStagedPublished(ids, publishedAt) {
    if (!ids.length) return;
    await stagedBorewells.updateMany({ id: { $in: ids } }, { $set: { publishedAt } });
  },

  // External/raw feature dataset registry (satellite, rainfall, geology, soil, DEM, LULC, groundwater).
  // Stores object-storage metadata only; the binary remains in the configured storage provider.
  async addDatasetAsset(asset) {
    await datasetAssets.insertOne({ ...asset });
    return asset;
  },
  async getDatasetAsset(id) {
    return datasetAssets.findOne({ id }, NO_MONGO_ID);
  },
  async getDatasetAssetBySha256(sha256) {
    return datasetAssets.findOne({ sha256 }, NO_MONGO_ID);
  },
  async updateDatasetAsset(id, patch) {
    return datasetAssets.findOneAndUpdate(
      { id }, { $set: patch }, { returnDocument: "after", projection: { _id: 0 } }
    );
  },
  async listDatasetAssets({ page = 1, limit = 25, datasetKind } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
    const query = {};
    if (datasetKind) query.datasetKind = datasetKind;
    const [items, total] = await Promise.all([
      datasetAssets.find(query, NO_MONGO_ID).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
      datasetAssets.countDocuments(query),
    ]);
    return { items, total, page: safePage, limit: safeLimit };
  },

  // Append-only audit trail: deliberately no update/delete method is exposed.
  async addIngestionAudit(event) {
    await ingestionAudit.insertOne({ ...event });
    return event;
  },
  async getIngestionAudit(batchId, { limit = 200 } = {}) {
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
    return ingestionAudit.find({ batchId }, NO_MONGO_ID).sort({ createdAt: -1 }).limit(safeLimit).toArray();
  },
  async getIngestionAuditByScope(scopeType, scopeId, { limit = 200 } = {}) {
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
    return ingestionAudit.find({ scopeType, scopeId }, NO_MONGO_ID).sort({ createdAt: -1 }).limit(safeLimit).toArray();
  },
};
