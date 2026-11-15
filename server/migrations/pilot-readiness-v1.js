const SEEDED_NOTES = ["Farmer request · 2 acre plot", "Panchayat borewell", "Repeat customer"];
const SEEDED_VILLAGES = ["Tiruchengode", "Pallipalayam", "Mallasamudram"];

export const migration = {
  id: "20261101_pilot_readiness_v1",
  description: "Geo-index predictions for ledger matching and remove seeded sample assignments",
  async up(database) {
    const predictions = database.collection("predictions");
    await predictions.updateMany(
      { location: { $exists: false }, lat: { $type: "number" }, lng: { $type: "number" } },
      [{ $set: { location: { type: "Point", coordinates: ["$lng", "$lat"] } } }]
    );
    await predictions.createIndex({ location: "2dsphere" }, { name: "pilot_prediction_location" });
    await predictions.createIndex({ dedupeKey: 1 }, { name: "pilot_prediction_dedupe", unique: true, sparse: true });
    await predictions.createIndex({ "actual.borewellId": 1 }, { name: "pilot_prediction_outcome", sparse: true });
    await database.collection("assignments").deleteMany({
      status: "pending",
      village: { $in: SEEDED_VILLAGES },
      note: { $in: SEEDED_NOTES },
    });
  },
  // The deleted sample assignments were fabricated, so rollback does not restore them.
  async down(database) {
    for (const name of ["pilot_prediction_location", "pilot_prediction_dedupe", "pilot_prediction_outcome"]) {
      await database.collection("predictions").dropIndex(name).catch((error) => {
        if (error?.codeName !== "IndexNotFound" && error?.code !== 27) throw error;
      });
    }
  },
};
