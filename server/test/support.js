// In-memory versions of the db.js ledger queries, layered over a test store's
// getPredictions/updatePrediction so the fakes behave like the real Mongo methods.
import { distanceKm } from "../predict.js";

export function withLedgerDb(db) {
  return {
    getBorewell: async (id) => (await db.getAllBorewells()).find((item) => item.id === id) || null,
    getBorewellsNear: async ({ lat, lng, radiusKm }) => (await db.getBorewells())
      .filter((item) => distanceKm({ lat, lng }, item) <= radiusKm),
    getPrediction: async (id) => (await db.getPredictions()).find((item) => item.id === id) || null,
    findOpenPredictionsNear: async ({ lat, lng, radiusKm }) => (await db.getPredictions())
      .filter((item) => item.actual == null && distanceKm({ lat, lng }, item) <= radiusKm),
    getPredictionsByOutcome: async (borewellId) => (await db.getPredictions())
      .filter((item) => item.actual?.borewellId === borewellId),
    claimPredictionOutcome: async (id, patch) => {
      const current = (await db.getPredictions()).find((item) => item.id === id);
      return current && current.actual == null ? db.updatePrediction(id, patch) : null;
    },
    ...db,
  };
}
