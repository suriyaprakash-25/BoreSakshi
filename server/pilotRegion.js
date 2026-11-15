// pilotRegion.js — the area BoreSakshi is willing to issue estimates for.
// Outside this box the API answers "no estimate" without calling the model.
// PILOT_BBOX is "south,west,north,east" in decimal degrees.
const DEFAULT_BBOX = "10.95,77.45,11.70,78.55"; // Namakkal / Tiruchengode belt

export function pilotRegion(env = process.env) {
  const parts = String(env.PILOT_BBOX || DEFAULT_BBOX).split(",").map((part) => Number(part.trim()));
  const [south, west, north, east] = parts;
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value)) || south >= north || west >= east) {
    throw new Error('PILOT_BBOX must be "south,west,north,east" in decimal degrees');
  }
  return { south, west, north, east };
}

export function insidePilotRegion(lat, lng, env = process.env) {
  const { south, west, north, east } = pilotRegion(env);
  return lat >= south && lat <= north && lng >= west && lng <= east;
}
