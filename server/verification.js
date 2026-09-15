import { isOperatorSubmission } from "./rigData.js";

export const VERIFICATION_SCHEMA_VERSION = "9.0.0";
export const VERIFICATION_STATUSES = Object.freeze({
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
});

export const REVIEWABLE_STATUSES = new Set([
  VERIFICATION_STATUSES.SUBMITTED,
  VERIFICATION_STATUSES.UNDER_REVIEW,
]);

export const TRUST_MODEL_VERSION = "9.0.0";
export const MIN_TRUST_SCORE_FOR_UNOVERRIDDEN_VERIFY = 40;

const severityWeight = {
  info: 0,
  low: 5,
  medium: 12,
  high: 25,
  critical: 40,
};

function finite(value) {
  return Number.isFinite(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 1) {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

function distanceKm(a, b) {
  if (!finite(a?.lat) || !finite(a?.lng) || !finite(b?.lat) || !finite(b?.lng)) return Infinity;
  const rad = (value) => value * Math.PI / 180;
  const R = 6371;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function issue(code, severity, category, message, details = {}) {
  return {
    code,
    severity,
    category,
    message,
    score: severityWeight[severity] ?? 0,
    details,
  };
}

function geologicalCoverage(record) {
  const layers = Array.isArray(record?.geologicalLayers) ? record.geologicalLayers : [];
  if (!layers.length || !finite(record?.depthFt) || record.depthFt <= 0) return 0;
  let covered = 0;
  for (const layer of layers) {
    if (!finite(layer.fromFt) || !finite(layer.toFt)) continue;
    covered += Math.max(0, layer.toFt - layer.fromFt);
  }
  return clamp((covered / record.depthFt) * 100, 0, 100);
}

export function analyzeSubmission(record, { operatorRecords = [], allRecords = [] } = {}) {
  const signals = [];
  const add = (...args) => signals.push(issue(...args));

  if (!isOperatorSubmission(record)) {
    return {
      schemaVersion: VERIFICATION_SCHEMA_VERSION,
      applicable: false,
      riskScore: 0,
      riskLevel: "not_applicable",
      suspicious: false,
      requiresOverrideToVerify: false,
      signals: [],
      summary: "Imported/non-operator records keep their existing Phase 2 review semantics.",
    };
  }

  const gpsAccuracy = Number(record?.gps?.accuracyM);
  if (!finite(gpsAccuracy)) {
    add("GPS_ACCURACY_MISSING", "critical", "location", "GPS accuracy is missing.");
  } else if (gpsAccuracy > 100) {
    add("GPS_ACCURACY_VERY_LOW", "high", "location", "GPS accuracy is worse than 100 m.", { accuracyM: gpsAccuracy });
  } else if (gpsAccuracy > 50) {
    add("GPS_ACCURACY_LOW", "medium", "location", "GPS accuracy is worse than 50 m.", { accuracyM: gpsAccuracy });
  } else if (gpsAccuracy > 25) {
    add("GPS_ACCURACY_CAUTION", "low", "location", "GPS accuracy is above the preferred 25 m threshold.", { accuracyM: gpsAccuracy });
  }

  const gpsCapturedMs = Date.parse(record?.gps?.capturedAt || "");
  const submittedMs = Date.parse(record?.submittedAt || record?.createdAt || "");
  if (!Number.isFinite(gpsCapturedMs)) {
    add("GPS_TIMESTAMP_MISSING", "critical", "location", "GPS capture timestamp is missing or invalid.");
  } else if (Number.isFinite(submittedMs) && gpsCapturedMs > submittedMs + 5 * 60 * 1000) {
    add("GPS_AFTER_SUBMISSION", "high", "location", "GPS capture time is later than the submission time.");
  }

  const drilledMs = Date.parse(record?.drilledAt || record?.drilledDate || record?.drillingDate || "");
  if (!Number.isFinite(drilledMs)) {
    add("DRILL_DATE_INVALID", "critical", "temporal", "Drilling date is missing or invalid.");
  } else if (Number.isFinite(submittedMs)) {
    const ageDays = Math.max(0, (submittedMs - drilledMs) / 86400000);
    if (ageDays > 365) add("OLD_BACKFILLED_RECORD", "medium", "temporal", "The drilling outcome was submitted more than one year after drilling.", { ageDays: round(ageDays, 0) });
    else if (ageDays > 90) add("DELAYED_SUBMISSION", "low", "temporal", "The drilling outcome was submitted more than 90 days after drilling.", { ageDays: round(ageDays, 0) });
  }

  const evidence = Array.isArray(record?.evidence) ? record.evidence : [];
  const photos = evidence.filter((item) => item?.kind === "photo");
  if (photos.length === 0) add("PHOTO_EVIDENCE_MISSING", "critical", "evidence", "At least one drilling-site photo is required.");
  if (evidence.some((item) => !/^[a-f0-9]{64}$/i.test(String(item?.sha256 || "")))) {
    add("EVIDENCE_CHECKSUM_MISSING", "high", "evidence", "One or more evidence objects lack a valid SHA-256 checksum.");
  }

  const layers = Array.isArray(record?.geologicalLayers) ? record.geologicalLayers : [];
  if (!layers.length) {
    add("GEOLOGY_MISSING", "critical", "geology", "Structured geological layers are missing.");
  } else {
    let previousTo = 0;
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      if (!finite(layer?.fromFt) || !finite(layer?.toFt) || layer.toFt <= layer.fromFt) {
        add("GEOLOGY_LAYER_INVALID", "high", "geology", `Geological layer ${i + 1} has an invalid depth interval.`);
      }
      if (i > 0 && finite(layer?.fromFt) && layer.fromFt < previousTo) {
        add("GEOLOGY_LAYER_OVERLAP", "high", "geology", `Geological layer ${i + 1} overlaps the previous layer.`);
      }
      if (finite(layer?.toFt)) previousTo = Math.max(previousTo, layer.toFt);
    }
    const coveragePct = geologicalCoverage(record);
    if (coveragePct < 60) add("GEOLOGY_COVERAGE_LOW", "medium", "geology", "Geological layer intervals cover less than 60% of the drilled depth.", { coveragePct: round(coveragePct) });
    else if (coveragePct < 85) add("GEOLOGY_COVERAGE_PARTIAL", "low", "geology", "Geological layer intervals do not cover most of the drilled depth.", { coveragePct: round(coveragePct) });
  }

  if (record?.success === true) {
    if (!(Number(record?.waterStrikeFt) > 0) || Number(record?.waterStrikeFt) > Number(record?.depthFt)) {
      add("WATER_STRIKE_INCONSISTENT", "critical", "outcome", "Successful outcome has an invalid water-strike depth.");
    }
    if (!(Number(record?.yieldLpm) > 0)) add("YIELD_MISSING", "critical", "outcome", "Successful outcome has no positive yield measurement.");
    else if (Number(record.yieldLpm) > 2000) add("YIELD_EXTREME", "high", "outcome", "Reported yield is extremely high and needs manual confirmation.", { yieldLpm: record.yieldLpm });
    else if (Number(record.yieldLpm) > 500) add("YIELD_HIGH", "medium", "outcome", "Reported yield is unusually high and should be checked.", { yieldLpm: record.yieldLpm });
  } else if (record?.success === false) {
    if (Number(record?.waterStrikeFt || 0) !== 0 || Number(record?.yieldLpm || 0) !== 0) {
      add("DRY_HOLE_OUTCOME_INCONSISTENT", "critical", "outcome", "Dry-hole outcome contains non-zero strike or yield values.");
    }
  } else {
    add("OUTCOME_MISSING", "critical", "outcome", "Success/failure outcome is missing.");
  }

  if (Number(record?.depthFt) > 2500) add("DEPTH_EXTREME", "medium", "outcome", "Reported borewell depth is unusually large and should be confirmed.", { depthFt: record.depthFt });

  const exactDuplicates = allRecords.filter((other) =>
    other?.id !== record?.id &&
    record?.ingestionFingerprint &&
    other?.ingestionFingerprint === record.ingestionFingerprint &&
    other?.verificationStatus !== VERIFICATION_STATUSES.REJECTED
  );
  if (exactDuplicates.length) {
    add("DUPLICATE_FINGERPRINT", "high", "duplicate", "Another non-rejected borewell record has the same duplicate fingerprint.", {
      duplicateIds: exactDuplicates.slice(0, 10).map((item) => item.id),
    });
  }

  const sameDayNear = allRecords.filter((other) => {
    if (other?.id === record?.id) return false;
    const sameDay = String(other?.drilledDate || other?.drillingDate || "") === String(record?.drilledDate || record?.drillingDate || "");
    return sameDay && distanceKm(record, other) <= 0.1 && other?.verificationStatus !== VERIFICATION_STATUSES.REJECTED;
  });
  if (sameDayNear.length) {
    add("NEAR_DUPLICATE_LOCATION_DATE", "high", "duplicate", "Another non-rejected record was logged within 100 m on the same drilling date.", {
      nearbyIds: sameDayNear.slice(0, 10).map((item) => item.id),
    });
  }

  const sameOperatorSameDay = operatorRecords.filter((other) =>
    other?.id !== record?.id &&
    String(other?.drilledDate || other?.drillingDate || "") === String(record?.drilledDate || record?.drillingDate || "")
  );
  if (sameOperatorSameDay.length >= 5) {
    add("OPERATOR_DAILY_BURST", "medium", "operator", "Operator has submitted many borewell outcomes for the same drilling date.", { otherRecords: sameOperatorSameDay.length });
  }

  const riskScore = clamp(signals.reduce((sum, signal) => sum + signal.score, 0), 0, 100);
  const blockingSignals = signals.filter((signal) => signal.severity === "high" || signal.severity === "critical");
  const riskLevel = riskScore >= 60 ? "critical" : riskScore >= 35 ? "high" : riskScore >= 15 ? "medium" : riskScore > 0 ? "low" : "clear";
  const suspicious = riskScore >= 15 || blockingSignals.length > 0;

  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    applicable: true,
    generatedAt: new Date().toISOString(),
    riskScore,
    riskLevel,
    suspicious,
    requiresOverrideToVerify: blockingSignals.length > 0,
    blockingSignalCodes: blockingSignals.map((signal) => signal.code),
    signals,
    summary: signals.length
      ? `${signals.length} review signal${signals.length === 1 ? "" : "s"}; risk ${riskScore}/100 (${riskLevel}).`
      : "No deterministic Phase 9 review signals were detected.",
  };
}

function recordEvidenceQuality(record) {
  let score = 0;
  const photos = (record?.evidence || []).filter((item) => item?.kind === "photo");
  if (photos.length >= 1) score += 30;
  if (photos.every((item) => /^[a-f0-9]{64}$/i.test(String(item?.sha256 || "")))) score += 10;
  const gps = Number(record?.gps?.accuracyM);
  if (finite(gps) && gps <= 25) score += 25;
  else if (finite(gps) && gps <= 50) score += 15;
  else if (finite(gps) && gps <= 100) score += 5;
  if (Array.isArray(record?.geologicalLayers) && record.geologicalLayers.length) score += 20;
  const completeOutcome = record?.success === false
    ? Number(record?.waterStrikeFt || 0) === 0 && Number(record?.yieldLpm || 0) === 0
    : record?.success === true && Number(record?.waterStrikeFt) > 0 && Number(record?.yieldLpm) > 0;
  if (completeOutcome) score += 15;
  return clamp(score, 0, 100);
}

export function computeOperatorTrust(records, { operatorId = null } = {}) {
  const operatorRecords = (records || []).filter((record) =>
    isOperatorSubmission(record) && (!operatorId || record.operatorId === operatorId)
  );
  const reviewed = operatorRecords.filter((record) =>
    record.verificationStatus === VERIFICATION_STATUSES.VERIFIED || record.verificationStatus === VERIFICATION_STATUSES.REJECTED
  );
  const verified = reviewed.filter((record) => record.verificationStatus === VERIFICATION_STATUSES.VERIFIED);
  const rejected = reviewed.filter((record) => record.verificationStatus === VERIFICATION_STATUSES.REJECTED);
  const flagged = operatorRecords.filter((record) => record.flagged === true);

  const reliabilityPct = ((verified.length + 2) / (reviewed.length + 4)) * 100;
  const evidenceQualityPct = reviewed.length
    ? reviewed.reduce((sum, record) => sum + recordEvidenceQuality(record), 0) / reviewed.length
    : 50;
  const averageRisk = reviewed.length
    ? reviewed.reduce((sum, record) => sum + Number(record?.verification?.riskScore || 0), 0) / reviewed.length
    : 0;
  const anomalyQualityPct = clamp(100 - averageRisk, 0, 100);
  const rawScore = 0.60 * reliabilityPct + 0.25 * evidenceQualityPct + 0.15 * anomalyQualityPct;
  const confidence = clamp(reviewed.length / 10, 0, 1);
  const flagPenalty = Math.min(15, flagged.length * 2);
  const score = clamp(Math.round((50 * (1 - confidence) + rawScore * confidence) - flagPenalty), 0, 100);

  let tier;
  if (reviewed.length < 3) tier = "NEW";
  else if (score >= 85) tier = "HIGH_TRUST";
  else if (score >= 70) tier = "TRUSTED";
  else if (score >= 50) tier = "BUILDING";
  else tier = "WATCH";

  return {
    modelVersion: TRUST_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    operatorId,
    score,
    tier,
    reviewedCount: reviewed.length,
    verifiedCount: verified.length,
    rejectedCount: rejected.length,
    pendingCount: operatorRecords.filter((record) => [VERIFICATION_STATUSES.SUBMITTED, VERIFICATION_STATUSES.UNDER_REVIEW].includes(record.verificationStatus)).length,
    flaggedCount: flagged.length,
    reliabilityPct: round(reliabilityPct),
    evidenceQualityPct: round(evidenceQualityPct),
    averageRiskScore: round(averageRisk),
    confidencePct: Math.round(confidence * 100),
    promotionGate: {
      minimumScore: MIN_TRUST_SCORE_FOR_UNOVERRIDDEN_VERIFY,
      passes: score >= MIN_TRUST_SCORE_FOR_UNOVERRIDDEN_VERIFY,
    },
    explanation: reviewed.length < 3
      ? "Trust remains provisional until at least three records receive review decisions."
      : "Trust combines smoothed verification reliability, evidence completeness/quality and reviewed-record anomaly risk.",
  };
}

export function canTransition(currentStatus, nextStatus) {
  const allowed = {
    [VERIFICATION_STATUSES.SUBMITTED]: new Set([VERIFICATION_STATUSES.UNDER_REVIEW]),
    [VERIFICATION_STATUSES.UNDER_REVIEW]: new Set([VERIFICATION_STATUSES.VERIFIED, VERIFICATION_STATUSES.REJECTED]),
    [VERIFICATION_STATUSES.VERIFIED]: new Set([VERIFICATION_STATUSES.UNDER_REVIEW]),
    [VERIFICATION_STATUSES.REJECTED]: new Set([VERIFICATION_STATUSES.UNDER_REVIEW, VERIFICATION_STATUSES.SUBMITTED]),
  };
  return Boolean(allowed[currentStatus]?.has(nextStatus));
}

export function statusPatch(nextStatus, { admin = null, now, decisionReason = "", analysis = null, trust = null } = {}) {
  const reviewer = admin ? { id: admin.id, name: admin.name } : null;
  const base = {
    verificationSchemaVersion: VERIFICATION_SCHEMA_VERSION,
    verificationStatus: nextStatus,
    verification: {
      ...(analysis ? {
        riskScore: analysis.riskScore,
        riskLevel: analysis.riskLevel,
        suspicious: analysis.suspicious,
        blockingSignalCodes: analysis.blockingSignalCodes,
        signals: analysis.signals,
        analyzedAt: analysis.generatedAt || now,
      } : {}),
      ...(trust ? { operatorTrustAtDecision: trust } : {}),
    },
  };

  if (nextStatus === VERIFICATION_STATUSES.UNDER_REVIEW) {
    return {
      ...base,
      verified: false,
      verifiedAt: null,
      verifiedBy: null,
      datasetEligibility: { eligible: false, status: "under_verification_review" },
      reviewStartedAt: now,
      reviewStartedBy: reviewer,
    };
  }
  if (nextStatus === VERIFICATION_STATUSES.VERIFIED) {
    return {
      ...base,
      verified: true,
      verifiedAt: now,
      verifiedBy: admin?.name || null,
      datasetEligibility: { eligible: true, status: "verified_operator_outcome" },
      reviewedAt: now,
      reviewedBy: reviewer,
      reviewDecision: "VERIFIED",
      reviewDecisionReason: decisionReason || "Verified after Phase 9 manual review.",
      rejectedAt: null,
      rejectedBy: null,
      rejectionReason: "",
    };
  }
  if (nextStatus === VERIFICATION_STATUSES.REJECTED) {
    return {
      ...base,
      verified: false,
      verifiedAt: null,
      verifiedBy: null,
      datasetEligibility: { eligible: false, status: "rejected_operator_outcome" },
      reviewedAt: now,
      reviewedBy: reviewer,
      reviewDecision: "REJECTED",
      reviewDecisionReason: decisionReason,
      rejectedAt: now,
      rejectedBy: reviewer,
      rejectionReason: decisionReason,
    };
  }
  if (nextStatus === VERIFICATION_STATUSES.SUBMITTED) {
    return {
      ...base,
      verified: false,
      verifiedAt: null,
      verifiedBy: null,
      datasetEligibility: { eligible: false, status: "awaiting_operator_submission_verification" },
    };
  }
  return base;
}
