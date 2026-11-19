// predict.js — real prediction orchestration. Inference is delegated to the Python
// ML service. When it cannot answer, the result is an honest "no estimate".
import { mlClient as defaultMlClient } from "./mlClient.js";
import { assertMlPredictionContract, PREDICTION_CONTRACT_VERSION } from "./predictionContract.js";
import { insidePilotRegion } from "./pilotRegion.js";

export const NEAR_KM = 5;

export function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearbySummary(lat, lng, nearbyLogs) {
  const withDist = nearbyLogs.map((b) => ({
    log: b,
    d: typeof b.distanceKm === "number" ? b.distanceKm : distanceKm({ lat, lng }, b),
  }));
  let successCount = 0, failCount = 0, latest = "";
  for (const { log } of withDist) {
    if (log.success === true) successCount += 1;
    else if (log.success === false) failCount += 1;
    const eventAt = log.drilledAt || log.createdAt || "";
    if (eventAt > latest) latest = eventAt;
  }
  return {
    nearbyCount: withDist.length,
    successCount,
    failCount,
    radiusKm: NEAR_KM,
    latestNearbyLogAt: latest || null,
  };
}

const NO_ESTIMATE_TEXT = {
  OUTSIDE_PILOT_AREA: "The borewell success estimate is only given inside the pilot area for now. The groundwater outlook covers all of India.",
  LOW_COVERAGE: "There is not enough geological and satellite data for this location to give an honest estimate.",
  MODEL_UNAVAILABLE: "The prediction model is not available right now, so no estimate was made.",
  NOT_RELEASED: "The prediction model is being tested against real drilling results before it is released.",
};

// There is deliberately no fallback number. If the trained model cannot answer,
// the farmer gets this response plus the verified wells nearby, and nothing is
// written to the ledger.
export function noEstimate({ lat, lng, nearbyLogs = [], reason = "MODEL_UNAVAILABLE" }) {
  return {
    estimateAvailable: false,
    noEstimateReason: reason,
    successProbability: null,
    depthBandFt: null,
    expectedYieldLpm: null,
    confidence: null,
    rockType: null,
    basis: NO_ESTIMATE_TEXT[reason],
    isMock: false,
    predictionSource: "no_estimate",
    modelAvailable: false,
    modelVersion: null,
    deploymentId: null,
    featureVersion: null,
    predictionContractVersion: PREDICTION_CONTRACT_VERSION,
    featureSnapshotRef: null,
    featureSnapshot: null,
    predictionTimestamp: new Date().toISOString(),
    coverageWarning: null,
    uncertainty: { available: false, reason: NO_ESTIMATE_TEXT[reason] },
    explanations: [],
    factors: [],
    confidenceReason: nearbySummary(lat, lng, nearbyLogs),
  };
}

function mapMlResponse(result, { lat, lng, nearbyLogs }) {
  const depth = result.estimatedDepthFt;
  const yieldRange = result.estimatedYieldLpm;
  const summary = result.nearbySummary || nearbySummary(lat, lng, nearbyLogs);
  const factors = result.explanations.map((item) => ({
    label: item.label || item.feature || "Model feature",
    impact: Number(item.impact || 0),
    method: item.method || "model_explanation",
  }));
  return {
    estimateAvailable: true,
    successProbability: Math.round(Number(result.successProbability) * 10) / 10,
    depthBandFt: [Math.round(Number(depth.min)), Math.round(Number(depth.max))],
    expectedYieldLpm: [Math.round(Number(yieldRange.min)), Math.round(Number(yieldRange.max))],
    confidence: result.confidence,
    rockType: result.geologySummary || "Geospatial model context",
    basis: `Trained ML estimate using versioned terrain, hydrology, geology, climate, satellite and verified borewell features (${result.modelVersion}).`,
    isMock: false,
    predictionSource: "ml",
    modelAvailable: true,
    modelVersion: result.modelVersion,
    deploymentId: result.deploymentId || null,
    featureVersion: result.featureVersion,
    predictionContractVersion: result.predictionContractVersion,
    featureSnapshotRef: result.featureSnapshotRef,
    featureSnapshot: result.featureSnapshot,
    predictionTimestamp: result.predictionTimestamp,
    coverageWarning: result.coverageWarning,
    uncertainty: result.uncertainty,
    featureCoverage: result.featureCoverage,
    explanations: result.explanations,
    factors,
    confidenceReason: {
      nearbyCount: Number(summary.nearbyCount || 0),
      successCount: Number(summary.successCount || 0),
      failCount: Number(summary.failCount || 0),
      radiusKm: NEAR_KM,
      latestNearbyLogAt: summary.latestNearbyLogAt || null,
      modelCoveragePct: result.featureCoverage.coveragePct,
      normalizedEntropy: result.uncertainty?.success?.normalizedEntropy ?? null,
    },
  };
}

export async function predictBorewell({ lat, lng, nearbyLogs = [], client = defaultMlClient }) {
  if (!insidePilotRegion(lat, lng)) return noEstimate({ lat, lng, nearbyLogs, reason: "OUTSIDE_PILOT_AREA" });
  try {
    const result = await client.predict({
      lat,
      lng,
      predictionTimestamp: new Date().toISOString(),
      nearbyBorewells: nearbyLogs.map((b) => ({
        id: b.id,
        lat: b.lat,
        lng: b.lng,
        success: b.success,
        depthFt: b.depthFt ?? null,
        yieldLpm: b.yieldLpm ?? null,
        drilledAt: b.drilledAt || null,
        createdAt: b.createdAt || null,
        verified: b.verified === true,
        flagged: b.flagged === true,
        datasetEligibility: b.datasetEligibility || null,
      })),
    });
    assertMlPredictionContract(result);
    return mapMlResponse(result, { lat, lng, nearbyLogs });
  } catch (error) {
    const reason = error?.code ? `${error.code}: ${error.message}` : error?.message || "ML service unavailable";
    console.warn(`[prediction] no_estimate reason=${reason}`);
    const lowCoverage = error?.code === "INSUFFICIENT_FEATURE_COVERAGE";
    return noEstimate({ lat, lng, nearbyLogs, reason: lowCoverage ? "LOW_COVERAGE" : "MODEL_UNAVAILABLE" });
  }
}
