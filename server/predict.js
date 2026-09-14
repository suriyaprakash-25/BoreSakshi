// predict.js — Phase 6 prediction orchestration.
// The public response contract remains compatible with the existing frontend.
// Real inference is delegated to the Python ML service; the deterministic
// heuristic exists only as an explicitly-labelled outage/coverage fallback.
import { mlClient as defaultMlClient } from "./mlClient.js";

export const NEAR_KM = 5;

function seeded(lat, lng) {
  const s = Math.sin(lat * 12.9898 + lng * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function mockZone(lat, lng) {
  const r = seeded(lat, lng);
  if (r < 0.33) return { rock: "Weathered / fractured zone", baseProb: 0.72, depth: [180, 300] };
  if (r < 0.66) return { rock: "Hard crystalline rock", baseProb: 0.5, depth: [300, 550] };
  return { rock: "Compact granite (low yield)", baseProb: 0.34, depth: [400, 700] };
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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

export function predictHeuristic({ lat, lng, nearbyLogs = [], fallbackReason = null }) {
  const z = mockZone(lat, lng);
  const jitter = (seeded(lat + 1, lng - 1) - 0.5) * 0.12;
  const withDist = nearbyLogs.map((b) => ({
    log: b,
    d: typeof b.distanceKm === "number" ? b.distanceKm : distanceKm({ lat, lng }, b),
  }));
  const proximity = (d) => Math.max(0, 1 - d / NEAR_KM);
  let successW = 0, failW = 0;
  for (const { log, d } of withDist) {
    if (log.success) successW += proximity(d);
    else failW += proximity(d);
  }
  const summary = nearbySummary(lat, lng, nearbyLogs);
  const NEUTRAL = 50;
  const K = 6;
  const geologyImpact = Math.round((z.baseProb - 0.5) * 100 + jitter * 100);
  const successImpact = Math.min(30, Math.round(successW * K));
  const failImpact = -Math.min(30, Math.round(failW * K));
  const rawProb = NEUTRAL + geologyImpact + successImpact + failImpact;
  const successProbability = clamp(rawProb, 8, 95);
  let confidence = "Low";
  if (summary.nearbyCount >= 8) confidence = "High";
  else if (summary.nearbyCount >= 3) confidence = "Medium";
  const yieldLow = Math.round((successProbability * 9) / 10) * 10;
  const yieldHigh = Math.round((successProbability * 15) / 10) * 10;
  const warning = "ML prediction is unavailable; this result is an explicitly labelled deterministic heuristic fallback and must not be interpreted as the trained model.";
  return {
    successProbability,
    depthBandFt: z.depth,
    expectedYieldLpm: [yieldLow, yieldHigh],
    confidence,
    rockType: z.rock,
    basis: `${warning} Estimated from regional heuristic geology and ${summary.nearbyCount} nearby verified drill log(s).`,
    isMock: true,
    predictionSource: "heuristic_fallback",
    modelAvailable: false,
    modelVersion: null,
    featureVersion: null,
    predictionTimestamp: new Date().toISOString(),
    coverageWarning: warning,
    fallbackReason: fallbackReason || "ML service unavailable",
    uncertainty: { available: false, reason: "No calibrated ML uncertainty is available during heuristic fallback." },
    explanations: [],
    factors: [
      { label: "Baseline prior", impact: NEUTRAL, base: true },
      { label: `Regional heuristic geology — ${z.rock.toLowerCase()}`, impact: geologyImpact },
      { label: `Nearby verified successes (${summary.successCount})`, impact: successImpact },
      { label: `Nearby verified dry holes (${summary.failCount})`, impact: failImpact },
    ],
    confidenceReason: summary,
  };
}

function mapMlResponse(result, { lat, lng, nearbyLogs }) {
  const depth = result.estimatedDepthFt || {};
  const yieldRange = result.estimatedYieldLpm || {};
  const summary = result.nearbySummary || nearbySummary(lat, lng, nearbyLogs);
  const factors = (result.explanations || []).map((item) => ({
    label: item.label || item.feature || "Model feature",
    impact: Number(item.impact || 0),
    method: item.method || "model_explanation",
  }));
  return {
    successProbability: Math.round(Number(result.successProbability) * 10) / 10,
    depthBandFt: [Math.round(Number(depth.min)), Math.round(Number(depth.max))],
    expectedYieldLpm: [Math.round(Number(yieldRange.min)), Math.round(Number(yieldRange.max))],
    confidence: result.confidence || "Low",
    rockType: result.geologySummary || "Geospatial model context",
    basis: `Trained ML estimate using versioned terrain, hydrology, geology, climate, satellite and verified borewell features (${result.modelVersion}).`,
    isMock: false,
    predictionSource: "ml",
    modelAvailable: true,
    modelVersion: result.modelVersion,
    featureVersion: result.featureVersion,
    predictionTimestamp: result.predictionTimestamp || new Date().toISOString(),
    coverageWarning: result.coverageWarning || null,
    uncertainty: result.uncertainty || null,
    featureCoverage: result.featureCoverage || null,
    explanations: result.explanations || [],
    factors,
    confidenceReason: {
      nearbyCount: Number(summary.nearbyCount || 0),
      successCount: Number(summary.successCount || 0),
      failCount: Number(summary.failCount || 0),
      radiusKm: NEAR_KM,
      latestNearbyLogAt: summary.latestNearbyLogAt || null,
      modelCoveragePct: result.featureCoverage?.coveragePct ?? null,
      normalizedEntropy: result.uncertainty?.success?.normalizedEntropy ?? null,
    },
  };
}

export async function predictBorewell({ lat, lng, nearbyLogs = [], client = defaultMlClient }) {
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
    return mapMlResponse(result, { lat, lng, nearbyLogs });
  } catch (error) {
    const reason = error?.code ? `${error.code}: ${error.message}` : error?.message || "ML service unavailable";
    console.warn(`[prediction] ml_fallback reason=${reason}`);
    return predictHeuristic({ lat, lng, nearbyLogs, fallbackReason: reason });
  }
}
