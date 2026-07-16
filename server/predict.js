// predict.js
// ============================================================================
// THIS IS THE ONLY FILE YOU REPLACE WHEN THE REAL AI IS READY.
// Right now it returns a realistic, DETERMINISTIC mock so the app + demo work.
// Later: call your trained model (via a Python service / ONNX / API) inside
// predictBorewell() and return the same shape. Nothing else in the app changes.
// ============================================================================

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

/**
 * predictBorewell({lat,lng})
 * @returns {{
 *   successProbability:number,  // 0..100
 *   depthBandFt:[number,number],
 *   expectedYieldLpm:[number,number],
 *   confidence:'Low'|'Medium'|'High',
 *   rockType:string,
 *   basis:string,               // short human-readable "why"
 *   isMock:boolean
 * }}
 */
export function predictBorewell({ lat, lng, nearbyCount = 0 }) {
  const z = mockZone(lat, lng);
  const jitter = (seeded(lat + 1, lng - 1) - 0.5) * 0.12;
  const prob = Math.max(0.08, Math.min(0.95, z.baseProb + jitter));

  // more nearby verified drill logs => higher confidence (this mirrors how the
  // REAL model gets more certain where it has more ground-truth data).
  let confidence = "Low";
  if (nearbyCount >= 8) confidence = "High";
  else if (nearbyCount >= 3) confidence = "Medium";

  const yieldLow = Math.round((prob * 900) / 10) * 10;      // rough LPM band
  const yieldHigh = Math.round((prob * 1500) / 10) * 10;

  return {
    successProbability: Math.round(prob * 100),
    depthBandFt: z.depth,
    expectedYieldLpm: [yieldLow, yieldHigh],
    confidence,
    rockType: z.rock,
    basis: `Estimated from regional geology (${z.rock.toLowerCase()}) and ${nearbyCount} nearby verified drill log(s).`,
    isMock: true,
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
