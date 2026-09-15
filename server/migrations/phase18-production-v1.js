export const migration = {
  id: "20260915_phase18_production_v1",
  description: "Add production query/index support for trust review, accountability and security operations",
  async up(database) {
    await database.collection("borewells").createIndex(
      { verificationStatus: 1, flagged: 1, "datasetEligibility.eligible": 1, drilledAt: -1 },
      { name: "phase18_trusted_outcomes" }
    );
    await database.collection("predictions").createIndex(
      { "accountability.status": 1, createdAt: -1 },
      { name: "phase18_accountability_status" }
    );
    await database.collection("operators").createIndex(
      { status: 1, verified: 1, role: 1 },
      { name: "phase18_operator_security" }
    );
    await database.collection("ingestion_audit").createIndex(
      { scopeType: 1, action: 1, createdAt: -1 },
      { name: "phase18_audit_action" }
    );
  },
  async down(database) {
    const drops = [
      ["borewells", "phase18_trusted_outcomes"],
      ["predictions", "phase18_accountability_status"],
      ["operators", "phase18_operator_security"],
      ["ingestion_audit", "phase18_audit_action"],
    ];
    for (const [collection, name] of drops) {
      await database.collection(collection).dropIndex(name).catch((error) => {
        if (error?.codeName !== "IndexNotFound" && error?.code !== 27) throw error;
      });
    }
  },
};
