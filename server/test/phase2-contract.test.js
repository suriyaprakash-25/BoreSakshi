import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.PHASE2_CONTRACT_BASE_URL || "";
const TOKEN = process.env.PHASE2_CONTRACT_ADMIN_TOKEN || "";
const ENABLED = !!BASE && !!TOKEN && process.env.PHASE2_CONTRACT_ALLOW_WRITES === "YES";

const auth = { Authorization: `Bearer ${TOKEN}` };
const api = (path) => `${BASE.replace(/\/$/, "")}${path}`;

test("Phase 2 admin ingestion HTTP contract", { skip: !ENABLED }, async () => {
  const suffix = Date.now();
  const csv = [
    "lat,lng,success,depth_ft,yield_lpm,drilled_date,source_record_id,place_name,strata,evidence_url",
    `11.3601,77.8001,yes,320,45,2026-09-10,contract-${suffix},Contract Village,Granite,https://example.com/evidence/${suffix}`,
  ].join("\n");
  const query = new URLSearchParams({
    sourceType: "government",
    sourceName: `Phase2 Contract ${suffix}`,
    sourceReference: `contract-run-${suffix}`,
    license: "test-only",
  });

  const uploaded = await fetch(api(`/api/admin/ingestion/csv?${query}`), {
    method: "POST",
    headers: { ...auth, "Content-Type": "text/csv" },
    body: csv,
  });
  assert.equal(uploaded.status, 201);
  const uploadBody = await uploaded.json();
  assert.equal(uploadBody.qualityReport.counts.pendingReview, 1);
  const batchId = uploadBody.batch.id;

  const recordsRes = await fetch(api(`/api/admin/ingestion/batches/${batchId}/records?status=pending_review`), { headers: auth });
  assert.equal(recordsRes.status, 200);
  const recordsBody = await recordsRes.json();
  assert.equal(recordsBody.total, 1);
  const recordId = recordsBody.items[0].id;

  const reviewRes = await fetch(api(`/api/admin/ingestion/records/${recordId}`), {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approve", reviewNote: "Phase 2 contract test" }),
  });
  assert.equal(reviewRes.status, 200);
  const reviewBody = await reviewRes.json();
  assert.equal(reviewBody.record.reviewStatus, "approved");

  const publishRes = await fetch(api(`/api/admin/ingestion/batches/${batchId}/publish`), {
    method: "POST",
    headers: auth,
  });
  assert.equal(publishRes.status, 200);
  const publishBody = await publishRes.json();
  assert.equal(publishBody.publishedCount, 1);
  assert.equal(publishBody.batch.status, "published");

  const auditRes = await fetch(api(`/api/admin/ingestion/batches/${batchId}/audit`), { headers: auth });
  assert.equal(auditRes.status, 200);
  const audit = await auditRes.json();
  assert.ok(audit.some((event) => event.action === "batch_published"));
});
