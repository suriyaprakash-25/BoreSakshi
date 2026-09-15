import { MongoClient } from "mongodb";

const URI = process.env.MONGODB_URI || "mongodb://localhost:27017/";
const DB_NAME = process.env.MONGODB_DB || "BoreSakshi";

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
let collection = null;
let connectPromise = null;

async function sessions() {
  if (collection) return collection;
  if (!connectPromise) {
    connectPromise = (async () => {
      await client.connect();
      collection = client.db(DB_NAME).collection("auth_sessions");
      await collection.createIndex({ sid: 1 }, { unique: true });
      await collection.createIndex({ operatorId: 1, revokedAt: 1 });
      await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      return collection;
    })().catch((error) => {
      connectPromise = null;
      throw error;
    });
  }
  return connectPromise;
}

const projection = { projection: { _id: 0 } };

export const authStore = {
  async createSession(session) {
    const col = await sessions();
    await col.insertOne({ ...session, expiresAt: new Date(session.expiresAt) });
    return session;
  },
  async getSession(sid) {
    const col = await sessions();
    const value = await col.findOne({ sid }, projection);
    if (!value) return null;
    return { ...value, expiresAt: value.expiresAt instanceof Date ? value.expiresAt.toISOString() : value.expiresAt };
  },
  async touchSession(sid, at) {
    const col = await sessions();
    await col.updateOne({ sid, revokedAt: null }, { $set: { lastSeenAt: at } });
  },
  async revokeSession(sid, reason = "signout", at = new Date().toISOString()) {
    const col = await sessions();
    const result = await col.updateOne({ sid, revokedAt: null }, { $set: { revokedAt: at, revokeReason: reason } });
    return result.modifiedCount || 0;
  },
  async revokeAllForOperator(operatorId, reason = "security_event", at = new Date().toISOString()) {
    const col = await sessions();
    const result = await col.updateMany({ operatorId, revokedAt: null }, { $set: { revokedAt: at, revokeReason: reason } });
    return result.modifiedCount || 0;
  },
  async revokeOthersForOperator(operatorId, currentSid, reason = "revoke_other_sessions", at = new Date().toISOString()) {
    const col = await sessions();
    const result = await col.updateMany(
      { operatorId, sid: { $ne: currentSid }, revokedAt: null },
      { $set: { revokedAt: at, revokeReason: reason } }
    );
    return result.modifiedCount || 0;
  },
  async listActiveForOperator(operatorId, { limit = 20 } = {}) {
    const col = await sessions();
    const rows = await col.find({ operatorId, revokedAt: null, expiresAt: { $gt: new Date() } }, projection)
      .sort({ createdAt: -1 }).limit(Math.min(100, Math.max(1, Number(limit) || 20))).toArray();
    return rows.map((row) => ({ ...row, expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt }));
  },
};

export async function closeAuthStore() {
  if (collection || connectPromise) await client.close();
  collection = null;
  connectPromise = null;
}
