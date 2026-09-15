// featurePipeline.js — Phase 3 feature-dataset builder.
// Produces versioned ML-ready rows while enforcing temporal leakage and Phase 8 trust controls.
import { createHash } from "node:crypto";
import {
  FEATURE_SCHEMA_VERSION,
  ML_FEATURE_NAMES,
  extractGeospatialFeatures,
  sha256Json,
  stableStringify,
  validateLayerManifest,
} from "./geospatial.js";

const finite = (v) => Number.isFinite(v);
const iso = (value) => {
  const ms = Date.parse(value || "");
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));

function isOperatorSubmission(record) {
  return Boolean(record?.rigSubmissionSchemaVersion) || record?.provenance?.sourceType === "operator";
}

export function isTrustedBorewellEvidence(record) {
  if (!isOperatorSubmission(record)) return true;
  return record?.verified === true && record?.flagged !== true && record?.datasetEligibility?.eligible !== false;
}

export function validateTrainingTarget(target) {
  const errors = [];
  if (!String(target?.id || "").trim()) errors.push("id is required");
  if (!finite(target?.lat) || target.lat < -90 || target.lat > 90) errors.push("valid lat is required");
  if (!finite(target?.lng) || target.lng < -180 || target.lng > 180) errors.push("valid lng is required");
  if (!iso(target?.drilledAt || target?.createdAt)) errors.push("drilledAt/createdAt is required for temporal leakage control");
  if (typeof target?.success !== "boolean") errors.push("success label must be boolean");
  if (target?.validation?.valid === false) errors.push("source record failed Phase 2 validation");
  if (target?.datasetEligible === false || target?.datasetEligibility?.eligible === false) errors.push("source record is not dataset eligible");
  if (target?.duplicateOf) errors.push("duplicate source records cannot become training targets");
  if (target?.reviewStatus && target.reviewStatus !== "approved") errors.push("staged source record is not approved");
  if (isOperatorSubmission(target) && target?.verified !== true) errors.push("operator submission is not verified");
  if (isOperatorSubmission(target) && target?.flagged === true) errors.push("flagged operator submission cannot become a training target");
  return { valid: errors.length === 0, errors };
}

export function buildTrainingFeatureRow(target, {
  layers,
  borewells,
  datasetVersion,
  nearbyRadiusKm,
  densityRadiusKm,
  spatialBlockDeg,
}) {
  const targetCheck = validateTrainingTarget(target);
  if (!targetCheck.valid) return { ok: false, targetId: target?.id || null, errors: targetCheck.errors };
  const asOf = iso(target.drilledAt || target.createdAt);
  const engineered = extractGeospatialFeatures({
    lat: target.lat,
    lng: target.lng,
    asOf,
    layers,
    borewells: (borewells || []).filter(isTrustedBorewellEvidence),
    targetId: target.id,
    nearbyRadiusKm,
    densityRadiusKm,
    spatialBlockDeg,
  });
  const row = {
    id: `${datasetVersion}:${target.id}`,
    datasetVersion,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    targetId: target.id,
    lat: target.lat,
    lng: target.lng,
    asOf,
    spatialBlockId: engineered.spatialBlockId,
    features: engineered.features,
    labels: {
      success: target.success,
      depthFt: finite(target.depthFt) ? target.depthFt : null,
      waterStrikeFt: finite(target.waterStrikeFt) ? target.waterStrikeFt : null,
      yieldLpm: finite(target.yieldLpm) ? target.yieldLpm : null,
    },
    coverage: engineered.coverage,
    sourceTrace: engineered.sourceTrace,
    auxiliary: engineered.auxiliary,
    featureHash: engineered.featureHash,
  };
  return { ok: true, row: { ...row, rowHash: sha256Json(row) } };
}

export function buildFeatureDataset({
  manifest,
  loadedLayers,
  targets,
  borewells = targets,
  nearbyRadiusKm = 5,
  densityRadiusKm = 2,
  spatialBlockDeg = 0.1,
  generatedAt = new Date().toISOString(),
}) {
  const manifestCheck = validateLayerManifest(manifest);
  if (!manifestCheck.valid) throw new Error(`Invalid feature manifest: ${manifestCheck.errors.join("; ")}`);
  if (!Array.isArray(targets) || !targets.length) throw new Error("targets must be a non-empty array");
  if (!Array.isArray(loadedLayers)) throw new Error("loadedLayers must be an array");

  const rows = [];
  const skipped = [];
  for (const target of targets) {
    const built = buildTrainingFeatureRow(target, {
      layers: loadedLayers,
      borewells,
      datasetVersion: manifest.datasetVersion,
      nearbyRadiusKm,
      densityRadiusKm,
      spatialBlockDeg,
    });
    if (built.ok) rows.push(built.row);
    else skipped.push({ targetId: built.targetId, errors: built.errors });
  }

  const featureCoverage = {};
  for (const name of ML_FEATURE_NAMES) {
    const present = rows.filter((row) => {
      const v = row.features[name];
      return v !== null && v !== undefined && v !== "" && !(typeof v === "number" && !Number.isFinite(v));
    }).length;
    featureCoverage[name] = rows.length ? round((present / rows.length) * 100, 2) : 0;
  }
  const averageCoveragePct = rows.length ? round(rows.reduce((sum, row) => sum + row.coverage.coveragePct, 0) / rows.length, 2) : 0;
  const spatialBlocks = new Set(rows.map((row) => row.spatialBlockId).filter(Boolean));

  const sourceManifest = manifest.layers.map((layer) => ({
    id: layer.id,
    kind: layer.kind,
    format: layer.format,
    sourceName: layer.sourceName,
    sourceReference: layer.sourceReference,
    license: layer.license,
    sha256: layer.sha256.toLowerCase(),
    static: !!layer.static,
    observedAt: layer.observedAt || null,
  }));
  const metadata = {
    datasetVersion: manifest.datasetVersion,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    generatedAt,
    manifestSha256: sha256Json(manifest),
    sourceManifest,
    leakagePolicy: {
      phase2EligibilityRequired: true,
      phase8VerifiedOperatorOutcomesRequired: true,
      targetOutcomeExcludedFromFeatures: true,
      nearbyBorewellTemporalRule: "strictly-before-target-asOf",
      dynamicLayerTemporalRule: "latest-observation-not-after-target-asOf",
      spatialValidationBlockDegrees: spatialBlockDeg,
    },
    parameters: { nearbyRadiusKm, densityRadiusKm, spatialBlockDeg },
    report: {
      inputTargets: targets.length,
      rowsBuilt: rows.length,
      rowsSkipped: skipped.length,
      averageCoveragePct,
      featureCoveragePct: featureCoverage,
      spatialBlockCount: spatialBlocks.size,
      skipped,
    },
  };
  const datasetHash = sha256Json({ metadata, rows: rows.map((row) => row.rowHash) });
  return { ...metadata, datasetHash, rows };
}

export function serializeFeatureDataset(dataset) {
  return `${JSON.stringify(dataset, null, 2)}\n`;
}

export function artifactSha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function featureDatasetSummary(dataset) {
  return {
    datasetVersion: dataset.datasetVersion,
    featureSchemaVersion: dataset.featureSchemaVersion,
    datasetHash: dataset.datasetHash,
    manifestSha256: dataset.manifestSha256,
    generatedAt: dataset.generatedAt,
    rowCount: dataset.rows.length,
    report: dataset.report,
    leakagePolicy: dataset.leakagePolicy,
  };
}

export function deterministicDatasetDigest(dataset) {
  return createHash("sha256").update(stableStringify({
    datasetVersion: dataset.datasetVersion,
    featureSchemaVersion: dataset.featureSchemaVersion,
    manifestSha256: dataset.manifestSha256,
    rows: dataset.rows.map((row) => ({ targetId: row.targetId, rowHash: row.rowHash })),
  })).digest("hex");
}
