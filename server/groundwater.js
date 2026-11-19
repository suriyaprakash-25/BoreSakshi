// groundwater.js — shallow water-table outlook for any location in India.
//
// It comes from the groundwater model trained on CGWB monitoring wells, served by the
// Python ML service. It is context for the farmer, not a borewell success prediction:
// it never enters the accountability ledger, and when the model cannot answer the
// response says why instead of showing a number.
import { MlServiceClient } from "./mlClient.js";

// Live terrain and land-cover reads take a few seconds, so this client has its own
// timeout and its own circuit breaker; a slow map server never trips the borewell model.
export const groundwaterClient = new MlServiceClient({
  timeoutMs: Number(process.env.ML_GROUNDWATER_TIMEOUT_MS || 20000),
  retries: 0,
});

const KNOWN_REASONS = new Set(["OUTSIDE_COVERAGE", "LOW_COVERAGE", "FEATURE_SOURCE_UNAVAILABLE"]);
const MAX_DEPTH_M = 200;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function season(value) {
  return value
    && finite(value.depthM) && finite(value.lowM) && finite(value.highM)
    && value.lowM >= 0 && value.lowM <= value.depthM && value.depthM <= value.highM && value.highM <= MAX_DEPTH_M;
}

// Anything that does not look like a real model answer is treated as no answer.
export function isValidOutlook(result) {
  return Boolean(result)
    && result.available === true
    && typeof result.modelVersion === "string" && result.modelVersion.length > 0
    && season(result.preMonsoon) && season(result.postMonsoon)
    && finite(result.chanceWithin10m) && result.chanceWithin10m >= 0 && result.chanceWithin10m <= 1
    && finite(result.nearestStationKm);
}

export function noOutlook(reason) {
  return { available: false, reason };
}

export async function groundwaterOutlook({ lat, lng, client = groundwaterClient, env = process.env }) {
  if (env.GROUNDWATER_OUTLOOK === "NO") return noOutlook("DISABLED");
  try {
    const result = await client.groundwater({ lat, lng });
    if (!isValidOutlook(result)) {
      console.warn("[groundwater] response failed the outlook contract");
      return noOutlook("UNAVAILABLE");
    }
    return {
      available: true,
      modelVersion: result.modelVersion,
      preMonsoon: result.preMonsoon,
      postMonsoon: result.postMonsoon,
      seasonalRiseM: finite(result.seasonalRiseM) ? result.seasonalRiseM : null,
      chanceWithin10m: result.chanceWithin10m,
      intervalCoveragePct: finite(result.intervalCoveragePct) ? result.intervalCoveragePct : 80,
      rockUnit: typeof result.rockUnit === "string" ? result.rockUnit : null,
      elevationM: finite(result.elevationM) ? result.elevationM : null,
      nearestStationKm: result.nearestStationKm,
      validation: result.validation && typeof result.validation === "object" ? result.validation : null,
    };
  } catch (error) {
    const reason = KNOWN_REASONS.has(error?.code) ? error.code : "UNAVAILABLE";
    if (reason === "UNAVAILABLE") console.warn(`[groundwater] unavailable: ${error?.code || error?.message}`);
    return noOutlook(reason);
  }
}
