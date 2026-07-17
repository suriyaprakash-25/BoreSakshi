// predict.js
// ============================================================================
// THIS IS THE ONLY FILE YOU REPLACE WHEN THE REAL AI IS READY.
// Right now it returns a realistic, DETERMINISTIC mock so the app + demo work.
// Later: call your trained model (via a Python service / ONNX / API) inside
// predictBorewell() and return the same shape. Nothing else in the app changes.
// ============================================================================

// Shared "nearby" radius (km) for confidence, ledger matching AND the
// explainability factors below. Single source of truth — index.js imports it.
export const NEAR_KM = 5;

// deterministic pseudo-random from coordinates so the same pin always gives the
// same result (a demo must be repeatable — never random on stage).
function seeded(lat, lng) {
  const s = Math.sin(lat * 12.9898 + lng * 78.233) * 43758.5453;
  return s - Math.floor(s); // 0..1
}

// crude "geology zones" just to make the mock feel spatially believable.
// The REAL model will use actual geology, rainfall, terrain & satellite features.
function mockZone(lat, lng) {
  const r = seeded(lat, lng);
  if (r < 0.33) return { rock: "Weathered / fractured zone", baseProb: 0.72, depth: [180, 300] };
  if (r < 0.66) return { rock: "Hard crystalline rock", baseProb: 0.5, depth: [300, 550] };
  return { rock: "Compact granite (low yield)", baseProb: 0.34, depth: [400, 700] };
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * predictBorewell({lat,lng,nearbyLogs})
 * @param {object}   arg
 * @param {number}   arg.lat
 * @param {number}   arg.lng
 * @param {object[]} arg.nearbyLogs  verified drill logs already within NEAR_KM
 *                                   (each may carry a precomputed `distanceKm`).
 * @returns {{
 *   successProbability:number,  // 0..100
 *   depthBandFt:[number,number],
 *   expectedYieldLpm:[number,number],
 *   confidence:'Low'|'Medium'|'High',
 *   rockType:string,
 *   basis:string,               // short human-readable "why"
 *   isMock:boolean,
 *   factors:{label:string,impact:number,base?:boolean}[],  // see note below
 *   confidenceReason:{nearbyCount:number,successCount:number,failCount:number,
 *                     radiusKm:number,latestNearbyLogAt:string|null}
 * }}
 */
export function predictBorewell({ lat, lng, nearbyLogs = [] }) {
  const z = mockZone(lat, lng);
  const jitter = (seeded(lat + 1, lng - 1) - 0.5) * 0.12;

  // --- distance-weighted nearby evidence ------------------------------------
  // Each nearby VERIFIED log (real drill outcome in MongoDB) is weighted by how
  // close it is to the pin: weight 1 right on top, fading linearly to 0 at the
  // NEAR_KM edge. Successful wells push the probability up, dry holes push it
  // down. This is honest, deterministic heuristic evidence — nothing random.
  //
  // WHEN THE REAL MODEL LANDS: replace this block with the model's inference,
  // and emit its SHAP / feature-importance values into the SAME `factors`
  // array shape ({ label, impact } in probability points). The frontend
  // "Why this prediction?" UI then needs zero changes.
  const withDist = nearbyLogs.map((b) => ({
    log: b,
    d: typeof b.distanceKm === "number" ? b.distanceKm : distanceKm({ lat, lng }, b),
  }));
  const proximity = (d) => Math.max(0, 1 - d / NEAR_KM); // linear proximity weight

  let successW = 0, failW = 0, successCount = 0, failCount = 0, latest = "";
  for (const { log, d } of withDist) {
    if (log.success) { successW += proximity(d); successCount++; }
    else { failW += proximity(d); failCount++; }
    if (log.createdAt && log.createdAt > latest) latest = log.createdAt;
  }
  const nearbyCount = withDist.length;

  // --- factor decomposition -------------------------------------------------
  // Impacts are in probability POINTS and (before the final 8–95 clamp) sum to
  // the score, so "Why this prediction?" is a TRUE decomposition, not decoration.
  //   score = 50 baseline + geology + nearby successes − nearby failures
  // Note: with no nearby logs this reduces exactly to the old geology-only
  // formula (50 + (baseProb−0.5)*100 + jitter*100 == baseProb*100 + jitter*100),
  // so isolated pins keep their previous value — the demo doesn't shift.
  const NEUTRAL = 50;
  const K = 6; // points per unit of proximity-weighted evidence
  const geologyImpact = Math.round((z.baseProb - 0.5) * 100 + jitter * 100);
  const successImpact = Math.min(30, Math.round(successW * K));  // capped so a
  const failImpact = -Math.min(30, Math.round(failW * K));       // cluster can't run away

  const rawProb = NEUTRAL + geologyImpact + successImpact + failImpact;
  const successProbability = clamp(rawProb, 8, 95);

  const factors = [
    { label: "Baseline prior", impact: NEUTRAL, base: true },
    { label: `Regional geology — ${z.rock.toLowerCase()}`, impact: geologyImpact },
    { label: `Nearby successful wells (${successCount} within ${NEAR_KM} km)`, impact: successImpact },
    { label: `Nearby dry holes (${failCount} within ${NEAR_KM} km)`, impact: failImpact },
  ];

  // more nearby ground-truth => more certain (unchanged thresholds)
  let confidence = "Low";
  if (nearbyCount >= 8) confidence = "High";
  else if (nearbyCount >= 3) confidence = "Medium";

  const yieldLow = Math.round((successProbability * 9) / 10) * 10;   // rough LPM band
  const yieldHigh = Math.round((successProbability * 15) / 10) * 10;

  return {
    successProbability,
    depthBandFt: z.depth,
    expectedYieldLpm: [yieldLow, yieldHigh],
    confidence,
    rockType: z.rock,
    basis: `Estimated from regional geology (${z.rock.toLowerCase()}) and ${nearbyCount} nearby verified drill log(s).`,
    isMock: true,
    // richer explainability, all derived from the same nearby-log data ---------
    factors,
    confidenceReason: {
      nearbyCount,
      successCount,
      failCount,
      radiusKm: NEAR_KM,
      latestNearbyLogAt: latest || null,
    },
  };
}

// Haversine distance in km — used to count nearby verified logs.
export function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
