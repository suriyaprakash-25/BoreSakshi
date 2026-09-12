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

// call once at server startup
export async function connectDB() {
  await client.connect();
  const database = client.db(DB_NAME);
  borewells = database.collection("borewells");
  predictions = database.collection("predictions");
  operators = database.collection("operators");
  assignments = database.collection("assignments");
  // helpful indexes (id lookups + geo-ish range scans stay fast)
  await borewells.createIndex({ id: 1 }, { unique: true });
  await borewells.createIndex({ operatorId: 1 }); // operator dashboards/history
  await predictions.createIndex({ id: 1 }, { unique: true });
  await operators.createIndex({ id: 1 }, { unique: true });
  await operators.createIndex({ phone: 1 }, { unique: true }); // one account per phone
  await assignments.createIndex({ id: 1 }, { unique: true });
  await assignments.createIndex({ operatorId: 1 });
  console.log(`MongoDB connected → ${DB_NAME} (collections: borewells, predictions, operators, assignments)`);
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
};
