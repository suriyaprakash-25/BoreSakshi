export const ACCOUNTABILITY_SCHEMA_VERSION = "11.0.0";
export const SUCCESS_THRESHOLD_PCT = 50;
export const CALIBRATION_BIN_COUNT = 10;

const finite = (value) => Number.isFinite(Number(value));
const numberOrNull = (value) => finite(value) ? Number(value) : null;
const round = (value, digits = 2) => {
  if (!Number.isFinite(Number(value))) return null;
  const power = 10 ** digits;
  return Math.round(Number(value) * power) / power;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function rangeSummary(range) {
  if (!Array.isArray(range) || range.length < 2 || !finite(range[0]) || !finite(range[1])) {
    return { min: null, max: null, estimate: null };
  }
  const min = Math.max(0, Number(range[0]));
  const max = Math.max(min, Number(range[1]));
  return { min: round(min, 2), max: round(max, 2), estimate: round((min + max) / 2, 2) };
}

function regionKeyFrom(record) {
  const district = String(record?.district || "").trim();
  const taluk = String(record?.taluk || "").trim();
  const village = String(record?.village || record?.placeName || "").trim();
  if (district && taluk) return `${district} / ${taluk}`;
  if (district) return district;
  if (village) return village;
  if (finite(record?.lat) && finite(record?.lng)) {
    return `grid:${Number(record.lat).toFixed(1)},${Number(record.lng).toFixed(1)}`;
  }
  return "unknown";
}

export function predictionModelIdentity(prediction) {
  if (prediction?.predictionSource === "ml" && prediction?.modelVersion) return String(prediction.modelVersion);
  return String(prediction?.predictionSource || "heuristic_fallback");
}

export function buildPredictionAccountability(prediction) {
  const probability = clamp(numberOrNull(prediction?.successProbability) ?? 0, 0, 100);
  const createdAt = prediction?.predictionTimestamp || prediction?.createdAt || new Date().toISOString();
  return {
    schemaVersion: ACCOUNTABILITY_SCHEMA_VERSION,
    status: "PENDING_OUTCOME",
    predictionId: prediction?.id || null,
    predictionDate: createdAt,
    modelVersion: prediction?.modelVersion || null,
    modelIdentity: predictionModelIdentity(prediction),
    deploymentId: prediction?.deploymentId || null,
    predictionSource: prediction?.predictionSource || "unknown",
    featureVersion: prediction?.featureVersion || null,
    featureSnapshotRef: prediction?.featureSnapshotRef || null,
    predicted: {
      successProbabilityPct: round(probability, 2),
      successCall: probability >= SUCCESS_THRESHOLD_PCT,
      depthFt: rangeSummary(prediction?.depthBandFt),
      yieldLpm: rangeSummary(prediction?.expectedYieldLpm),
    },
    actual: null,
    metrics: null,
    verificationStatus: null,
    scoredAt: null,
    reopenedAt: null,
    reopenReason: null,
  };
}

export function scorePredictionAgainstOutcome(prediction, outcome, { now = new Date().toISOString(), matchDistanceKm = null } = {}) {
  const accountability = prediction?.accountability || buildPredictionAccountability(prediction);
  const probabilityPct = clamp(numberOrNull(accountability?.predicted?.successProbabilityPct ?? prediction?.successProbability) ?? 0, 0, 100);
  const probability = probabilityPct / 100;
  const actualSuccess = outcome?.success === true;
  const successCall = probabilityPct >= SUCCESS_THRESHOLD_PCT;
  const brier = (probability - (actualSuccess ? 1 : 0)) ** 2;

  const predictedDepth = accountability?.predicted?.depthFt?.estimate ?? rangeSummary(prediction?.depthBandFt).estimate;
  const actualStrike = actualSuccess && finite(outcome?.waterStrikeFt) && Number(outcome.waterStrikeFt) > 0
    ? Number(outcome.waterStrikeFt)
    : null;
  const depthSignedError = predictedDepth != null && actualStrike != null ? predictedDepth - actualStrike : null;

  const predictedYield = accountability?.predicted?.yieldLpm?.estimate ?? rangeSummary(prediction?.expectedYieldLpm).estimate;
  const actualYield = finite(outcome?.yieldLpm) && Number(outcome.yieldLpm) >= 0 ? Number(outcome.yieldLpm) : null;
  const yieldSignedError = predictedYield != null && actualYield != null ? predictedYield - actualYield : null;
  const outcomeDate = outcome?.verifiedAt || outcome?.reviewedAt || outcome?.outcomeDate || outcome?.closedAt || now;
  const regionKey = outcome?.regionKey || regionKeyFrom(outcome);

  const actual = {
    borewellId: outcome?.id || outcome?.borewellId || null,
    success: actualSuccess,
    depthFt: numberOrNull(outcome?.depthFt),
    waterStrikeFt: actualStrike,
    yieldLpm: actualYield,
    drilledAt: outcome?.drilledAt || outcome?.drilledDate || null,
    outcomeDate,
    verificationStatus: outcome?.verificationStatus || (outcome?.verified === true ? "VERIFIED" : "UNKNOWN"),
    verified: outcome?.verified === true,
    matchDistanceKm: numberOrNull(matchDistanceKm ?? outcome?.matchDistanceKm),
    regionKey,
    placeName: String(outcome?.placeName || outcome?.village || "").trim() || null,
    district: String(outcome?.district || "").trim() || null,
    taluk: String(outcome?.taluk || "").trim() || null,
  };
  const metrics = {
    successCorrect: successCall === actualSuccess,
    brier: round(brier, 6),
    depthErrorFt: depthSignedError == null ? null : round(depthSignedError, 2),
    depthAbsoluteErrorFt: depthSignedError == null ? null : round(Math.abs(depthSignedError), 2),
    yieldErrorLpm: yieldSignedError == null ? null : round(yieldSignedError, 2),
    yieldAbsoluteErrorLpm: yieldSignedError == null ? null : round(Math.abs(yieldSignedError), 2),
  };

  return {
    actual: {
      success: actual.success,
      depthFt: actual.depthFt,
      waterStrikeFt: actual.waterStrikeFt,
      yieldLpm: actual.yieldLpm,
      borewellId: actual.borewellId,
      verified: actual.verified,
      verificationStatus: actual.verificationStatus,
      outcomeDate: actual.outcomeDate,
      drilledAt: actual.drilledAt,
      closedAt: now,
      matchDistanceKm: actual.matchDistanceKm,
      regionKey,
    },
    correct: metrics.successCorrect,
    accountability: {
      ...accountability,
      status: "SCORED_VERIFIED",
      actual,
      metrics,
      verificationStatus: actual.verificationStatus,
      scoredAt: now,
      reopenedAt: null,
      reopenReason: null,
    },
  };
}

export function reopenPredictionAccountability(prediction, { now = new Date().toISOString(), reason = "Outcome trust was removed" } = {}) {
  const accountability = normalizePredictionAccountability(prediction);
  return {
    actual: null,
    correct: null,
    accountability: {
      ...accountability,
      status: "PENDING_REVERIFY",
      lastScoredOutcome: accountability.actual || prediction?.actual || null,
      lastScoredMetrics: accountability.metrics || null,
      actual: null,
      metrics: null,
      verificationStatus: null,
      scoredAt: null,
      reopenedAt: now,
      reopenReason: reason,
    },
  };
}

export function normalizePredictionAccountability(prediction) {
  const base = prediction?.accountability || buildPredictionAccountability(prediction);
  if (!prediction?.actual) return base;
  if (base.status === "SCORED_VERIFIED" && base.actual && base.metrics) return base;

  const actual = prediction.actual;
  const syntheticOutcome = {
    id: actual.borewellId || null,
    borewellId: actual.borewellId || null,
    success: actual.success === true,
    depthFt: actual.depthFt,
    waterStrikeFt: actual.waterStrikeFt,
    yieldLpm: actual.yieldLpm,
    drilledAt: actual.drilledAt || null,
    outcomeDate: actual.outcomeDate || actual.closedAt || null,
    verifiedAt: actual.outcomeDate || actual.closedAt || null,
    verificationStatus: actual.verificationStatus || (actual.verified === false ? "UNKNOWN" : "VERIFIED"),
    verified: actual.verified !== false,
    matchDistanceKm: actual.matchDistanceKm,
    regionKey: actual.regionKey || regionKeyFrom({ lat: prediction.lat, lng: prediction.lng }),
    lat: prediction.lat,
    lng: prediction.lng,
  };
  return scorePredictionAgainstOutcome(
    { ...prediction, accountability: base },
    syntheticOutcome,
    { now: actual.closedAt || actual.outcomeDate || prediction.createdAt || new Date().toISOString(), matchDistanceKm: actual.matchDistanceKm },
  ).accountability;
}

function calibrationReport(scored, bins = CALIBRATION_BIN_COUNT) {
  if (!scored.length) return { brier: null, expectedCalibrationError: null, bins: [] };
  const rows = scored.map((prediction) => ({
    p: clamp(Number(prediction.accountability.predicted.successProbabilityPct) / 100, 0, 1),
    y: prediction.accountability.actual.success ? 1 : 0,
  }));
  const brier = rows.reduce((sum, row) => sum + (row.p - row.y) ** 2, 0) / rows.length;
  const output = [];
  let ece = 0;
  for (let index = 0; index < bins; index += 1) {
    const low = index / bins;
    const high = (index + 1) / bins;
    const bucket = rows.filter((row) => row.p >= low && (index === bins - 1 ? row.p <= high : row.p < high));
    if (!bucket.length) continue;
    const meanProbability = bucket.reduce((sum, row) => sum + row.p, 0) / bucket.length;
    const observedRate = bucket.reduce((sum, row) => sum + row.y, 0) / bucket.length;
    const gap = Math.abs(meanProbability - observedRate);
    ece += gap * bucket.length / rows.length;
    output.push({
      minProbabilityPct: Math.round(low * 100),
      maxProbabilityPct: Math.round(high * 100),
      count: bucket.length,
      meanPredictedPct: round(meanProbability * 100, 2),
      observedSuccessPct: round(observedRate * 100, 2),
      calibrationGapPct: round(gap * 100, 2),
    });
  }
  return { brier: round(brier, 6), expectedCalibrationError: round(ece, 6), bins: output };
}

function errorReport(scored, metricKey, absoluteKey) {
  const values = scored
    .map((prediction) => prediction.accountability.metrics)
    .filter(Boolean)
    .filter((metrics) => finite(metrics[metricKey]) && finite(metrics[absoluteKey]));
  if (!values.length) return { count: 0, mae: null, rmse: null, bias: null };
  const signed = values.map((metrics) => Number(metrics[metricKey]));
  const absolute = values.map((metrics) => Number(metrics[absoluteKey]));
  const mae = absolute.reduce((sum, value) => sum + value, 0) / absolute.length;
  const rmse = Math.sqrt(signed.reduce((sum, value) => sum + value ** 2, 0) / signed.length);
  const bias = signed.reduce((sum, value) => sum + value, 0) / signed.length;
  return { count: values.length, mae: round(mae, 2), rmse: round(rmse, 2), bias: round(bias, 2) };
}

function summaryCore(predictions) {
  const scored = predictions.filter((prediction) => prediction?.accountability?.status === "SCORED_VERIFIED" && prediction.accountability?.actual);
  const correct = scored.filter((prediction) => prediction.accountability.metrics?.successCorrect === true).length;
  const calibration = calibrationReport(scored);
  const depth = errorReport(scored, "depthErrorFt", "depthAbsoluteErrorFt");
  const yieldReport = errorReport(scored, "yieldErrorLpm", "yieldAbsoluteErrorLpm");
  return {
    predictions: predictions.length,
    scored: scored.length,
    correct,
    accuracyPct: scored.length ? round(correct / scored.length * 100, 1) : null,
    brier: calibration.brier,
    expectedCalibrationError: calibration.expectedCalibrationError,
    calibrationBins: calibration.bins,
    depth: { count: depth.count, maeFt: depth.mae, rmseFt: depth.rmse, biasFt: depth.bias },
    yield: { count: yieldReport.count, maeLpm: yieldReport.mae, rmseLpm: yieldReport.rmse, biasLpm: yieldReport.bias },
  };
}

function groupPerformance(predictions, keyFn) {
  const groups = new Map();
  for (const prediction of predictions) {
    const key = keyFn(prediction);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(prediction);
  }
  return [...groups.entries()].map(([key, rows]) => ({ key, ...summaryCore(rows) }))
    .sort((a, b) => b.scored - a.scored || b.predictions - a.predictions || a.key.localeCompare(b.key));
}

export function summarizeAccountabilityLedger(predictions) {
  const normalized = (predictions || []).map((prediction) => ({
    ...prediction,
    accountability: normalizePredictionAccountability(prediction),
  }));
  const overall = summaryCore(normalized);
  return {
    schemaVersion: ACCOUNTABILITY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    totalPredictions: normalized.length,
    pending: normalized.filter((prediction) => prediction.accountability.status !== "SCORED_VERIFIED").length,
    ...overall,
    byModelVersion: groupPerformance(normalized, (prediction) => prediction.accountability.modelIdentity),
    byRegion: groupPerformance(normalized.filter((prediction) => prediction.accountability.actual), (prediction) => prediction.accountability.actual?.regionKey || "unknown"),
    bySource: groupPerformance(normalized, (prediction) => prediction.accountability.predictionSource || prediction.predictionSource || "unknown"),
    methodology: {
      successThresholdPct: SUCCESS_THRESHOLD_PCT,
      brier: "mean squared error between issued success probability and verified binary outcome",
      calibration: `${CALIBRATION_BIN_COUNT}-bin expected calibration error over currently verified scored outcomes`,
      depthError: "predicted water-strike interval midpoint minus verified actual water-strike depth; dry holes excluded",
      yieldError: "predicted yield interval midpoint minus verified measured yield",
      regionalGrouping: "district/taluk when available, then village/place, otherwise coarse 0.1-degree grid",
      modelGrouping: "ML modelVersion values remain distinct; heuristic_fallback is never blended into an ML model version",
    },
  };
}

export function safeLedgerEntry(prediction) {
  const accountability = normalizePredictionAccountability(prediction);
  return {
    predictionId: prediction.id,
    location: {
      lat: finite(prediction.lat) ? round(prediction.lat, 3) : null,
      lng: finite(prediction.lng) ? round(prediction.lng, 3) : null,
      region: accountability.actual?.regionKey || null,
    },
    predictionDate: accountability.predictionDate || prediction.createdAt || null,
    modelVersion: accountability.modelVersion,
    modelIdentity: accountability.modelIdentity,
    deploymentId: accountability.deploymentId || null,
    predictionSource: accountability.predictionSource,
    predictedProbabilityPct: accountability.predicted.successProbabilityPct,
    predictedDepthFt: accountability.predicted.depthFt,
    predictedYieldLpm: accountability.predicted.yieldLpm,
    actualOutcome: accountability.actual ? {
      success: accountability.actual.success,
      waterStrikeFt: accountability.actual.waterStrikeFt,
      yieldLpm: accountability.actual.yieldLpm,
      drilledAt: accountability.actual.drilledAt || null,
    } : null,
    outcomeDate: accountability.actual?.outcomeDate || null,
    verificationStatus: accountability.verificationStatus || accountability.actual?.verificationStatus || null,
    status: accountability.status,
    metrics: accountability.metrics,
  };
}
