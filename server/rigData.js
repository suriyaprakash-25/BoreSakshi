import { buildDuplicateFingerprint, DATASET_SCHEMA_VERSION } from "./ingestion.js";

export const PHASE8_SCHEMA_VERSION = "8.0.0";

export function summarizeStrata(geologicalLayers, fallback = "") {
  const names = [...new Set((geologicalLayers || []).map((layer) => String(layer.material || "").trim()).filter(Boolean))];
  return names.length ? names.join(" → ").slice(0, 120) : String(fallback || "").slice(0, 120);
}

export function isOperatorSubmission(record) {
  return Boolean(record?.rigSubmissionSchemaVersion) || record?.provenance?.sourceType === "operator";
}

export function buildOperatorBorewellRecord({ id, body, operator, evidence, submittedAt }) {
  const drilledAt = `${body.drillingDate}T00:00:00.000Z`;
  const record = {
    id,
    schemaVersion: DATASET_SCHEMA_VERSION,
    rigSubmissionSchemaVersion: PHASE8_SCHEMA_VERSION,
    lat: body.lat,
    lng: body.lng,
    location: { type: "Point", coordinates: [body.lng, body.lat] },
    gps: {
      accuracyM: body.gpsAccuracyM,
      capturedAt: body.gpsCapturedAt,
      source: "device_geolocation",
    },
    placeName: body.placeName?.trim() || "",
    depthFt: body.depthFt,
    strata: summarizeStrata(body.geologicalLayers, body.strata),
    geologicalLayers: body.geologicalLayers,
    waterStrikeFt: body.waterStrikeFt,
    yieldLpm: body.yieldLpm,
    success: body.success,
    drillingDate: body.drillingDate,
    drilledDate: body.drillingDate,
    drilledAt,
    operatorId: operator.id,
    operatorName: operator.name,
    operatorVerifiedAtSubmission: operator.verified === true,
    language: body.language ?? "ta",
    evidence,
    evidenceSummary: {
      photoCount: evidence.filter((item) => item.kind === "photo").length,
      videoCount: evidence.filter((item) => item.kind === "video").length,
    },
    verificationStatus: "SUBMITTED",
    flagged: false,
    flagReason: "",
    verified: false,
    verifiedAt: null,
    verifiedBy: null,
    ledgerScoredAt: null,
    ledgerScoredPredictions: 0,
    submittedAt,
    createdAt: submittedAt,
    datasetEligibility: {
      eligible: false,
      status: "awaiting_operator_submission_verification",
    },
    provenance: {
      sourceType: "operator",
      sourceName: "BoreSakshi authenticated rig operator submission",
      sourceRecordId: id,
      importedAt: submittedAt,
      importedBy: { id: operator.id, name: operator.name },
      identitySource: "authenticated_session",
      evidenceSha256: evidence.map((item) => item.sha256),
    },
  };
  record.ingestionFingerprint = buildDuplicateFingerprint(record, {
    sourceType: "operator",
    sourceName: "BoreSakshi authenticated rig operator submission",
  });
  return record;
}

export function buildVerificationPatch({ record = null, verified, adminName, now }) {
  // Phase 8's pending/trusted eligibility transition applies only to operator-origin
  // submissions. Government/imported Phase 2 records keep their established
  // eligibility/review semantics when an admin toggles the existing verified flag.
  if (!isOperatorSubmission(record)) {
    return verified
      ? { verified: true, verifiedAt: now, verifiedBy: adminName }
      : { verified: false, verifiedAt: null, verifiedBy: null };
  }

  if (verified) {
    return {
      verified: true,
      verificationStatus: "VERIFIED",
      verifiedAt: now,
      verifiedBy: adminName,
      datasetEligibility: { eligible: true, status: "verified_operator_outcome" },
    };
  }
  return {
    verified: false,
    verificationStatus: "SUBMITTED",
    verifiedAt: null,
    verifiedBy: null,
    datasetEligibility: { eligible: false, status: "awaiting_operator_submission_verification" },
  };
}

export function isTrustedOutcome(record) {
  return record?.verified === true && record?.flagged !== true && record?.datasetEligibility?.eligible !== false;
}
