import test from "node:test";
import assert from "node:assert/strict";

import { buildVerificationPatch, isOperatorSubmission } from "../rigData.js";

test("Phase 8 verification patches preserve Phase 2 imported-data eligibility semantics", () => {
  const imported = {
    id: "government-well",
    provenance: { sourceType: "government" },
    datasetEligibility: { eligible: true, status: "published_import" },
    verified: true,
  };
  assert.equal(isOperatorSubmission(imported), false);

  const off = buildVerificationPatch({
    record: imported,
    verified: false,
    adminName: "Admin",
    now: "2026-09-15T00:00:00Z",
  });
  assert.equal(off.verified, false);
  assert.equal("datasetEligibility" in off, false);
  assert.equal("verificationStatus" in off, false);

  const on = buildVerificationPatch({
    record: imported,
    verified: true,
    adminName: "Admin",
    now: "2026-09-15T00:00:00Z",
  });
  assert.equal(on.verified, true);
  assert.equal("datasetEligibility" in on, false);
  assert.equal("verificationStatus" in on, false);
});

test("Phase 8 operator verification patches still enforce pending/trusted eligibility", () => {
  const operatorRecord = {
    id: "operator-well",
    rigSubmissionSchemaVersion: "8.0.0",
    provenance: { sourceType: "operator" },
    verified: false,
  };
  assert.equal(isOperatorSubmission(operatorRecord), true);

  const verified = buildVerificationPatch({
    record: operatorRecord,
    verified: true,
    adminName: "Admin",
    now: "2026-09-15T00:00:00Z",
  });
  assert.deepEqual(verified.datasetEligibility, { eligible: true, status: "verified_operator_outcome" });
  assert.equal(verified.verificationStatus, "VERIFIED");

  const pending = buildVerificationPatch({
    record: { ...operatorRecord, verified: true },
    verified: false,
    adminName: "Admin",
    now: "2026-09-15T00:00:00Z",
  });
  assert.deepEqual(pending.datasetEligibility, { eligible: false, status: "awaiting_operator_submission_verification" });
  assert.equal(pending.verificationStatus, "SUBMITTED");
});
