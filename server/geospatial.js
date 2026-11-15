// geospatial.js — Phase 3 real geospatial feature engineering primitives.
// Pure functions only: no MongoDB, HTTP, or model inference. Standardized raster
// and vector layers are converted into deterministic ML-ready feature vectors.
import { createHash } from "node:crypto";

export const FEATURE_SCHEMA_VERSION = "1.0.0";
export const DEFAULT_NEARBY_RADIUS_KM = 5;
export const DEFAULT_DENSITY_RADIUS_KM = 2;
export const DEFAULT_SPATIAL_BLOCK_DEG = 0.5;

export const SUPPORTED_LAYER_KINDS = [
  "dem",
  "flowAccumulation",
  "drainage",
  "watershed",
  "geology",
  "lineaments",
  "spectralLineaments",
  "groundwaterPreMonsoon",
  "groundwaterPostMonsoon",
  "rainfallAnnual",
  "rainfallSeasonal",
  "rainfallRecent",
  "rainfallNormal",
  "rainfallAnomaly",
  "hand",
  "twi",
  "spi3",
  "spi6",
  "spi12",
  "ndvi",
  "ndwi",
  "landUse",
  "soil",
];

export const DYNAMIC_LAYER_KINDS = new Set([
  "rainfallAnnual",
  "rainfallSeasonal",
  "rainfallRecent",
  "rainfallNormal",
  "rainfallAnomaly",
  "spi3",
  "spi6",
  "spi12",
  "ndvi",
  "ndwi",
  "landUse",
]);

export const ML_FEATURE_NAMES = [
  "terrainElevationM",
  "terrainSlopeDeg",
  "terrainAspectDeg",
  "terrainCurvature",
  "terrainHandM",
  "terrainTwi",
  "hydrologyDistanceToDrainageM",
  "hydrologyDrainageDensityKmPerKm2",
  "hydrologyWatershedId",
  "hydrologyFlowAccumulation",
  "geologyFormation",
  "geologyLithology",
  "geologyLineamentDensityKmPerKm2",
  "geologyDistanceToLineamentM",
  "geologyFractureProximityScore",
  "geologyLineamentIntersectionDensity",
  "geologyFaultProximityAngleDeg",
  "groundwaterDepthPreMonsoonM",
  "groundwaterDepthPostMonsoonM",
  "groundwaterSeasonalRiseM",
  "climateAnnualRainfallMm",
  "climateSeasonalRainfallMm",
  "climateRecentRainfallMm",
  "climateRainfallAnomalyPct",
  "climateSpi3",
  "climateSpi6",
  "climateSpi12",
  "soilClayPercentage",
  "satelliteNdvi",
  "satelliteNdwi",
  "satelliteLandUseClass",
  "nearbyNearestDistanceKm",
  "nearbyCount",
  "nearbySuccessRate",
  "nearbyFailureRate",
  "nearbyAverageDepthFt",
  "nearbyAverageYieldLpm",
];

const round = (value, digits = 6) => value == null ? null : Number(Number(value).toFixed(digits));
const finite = (value) => Number.isFinite(value);
const valuePresent = (value) => value !== null && value !== undefined && value !== "" && !(typeof value === "number" && !Number.isFinite(value));

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Json(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function parseAsciiGrid(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("ASCII grid is empty");
  const lines = input.trim().split(/\r?\n/).filter(Boolean);
  const header = {};
  let dataStart = 0;
  for (let i = 0; i < Math.min(lines.length, 12); i += 1) {
    const parts = lines[i].trim().split(/\s+/);
    const key = parts[0]?.toLowerCase();
    if (["ncols", "nrows", "xllcorner", "xllcenter", "yllcorner", "yllcenter", "cellsize", "nodata_value"].includes(key)) {
      header[key] = Number(parts[1]);
      dataStart = i + 1;
    } else {
      break;
    }
  }
  for (const key of ["ncols", "nrows", "cellsize"]) {
    if (!Number.isFinite(header[key]) || header[key] <= 0) throw new Error(`ASCII grid missing/invalid ${key}`);
  }
  if (!Number.isFinite(header.xllcorner) && !Number.isFinite(header.xllcenter)) throw new Error("ASCII grid missing xllcorner/xllcenter");
  if (!Number.isFinite(header.yllcorner) && !Number.isFinite(header.yllcenter)) throw new Error("ASCII grid missing yllcorner/yllcenter");

  const xllcorner = Number.isFinite(header.xllcorner) ? header.xllcorner : header.xllcenter - header.cellsize / 2;
  const yllcorner = Number.isFinite(header.yllcorner) ? header.yllcorner : header.yllcenter - header.cellsize / 2;
  const ncols = Math.trunc(header.ncols);
  const nrows = Math.trunc(header.nrows);
  const rows = lines.slice(dataStart).map((line) => line.trim().split(/\s+/).map(Number));
  if (rows.length !== nrows) throw new Error(`ASCII grid expected ${nrows} rows, found ${rows.length}`);
  if (rows.some((row) => row.length !== ncols || row.some((v) => !Number.isFinite(v)))) throw new Error("ASCII grid data shape/value is invalid");

  return {
    format: "esri_ascii",
    ncols,
    nrows,
    xllcorner,
    yllcorner,
    cellsize: header.cellsize,
    nodata: Number.isFinite(header.nodata_value) ? header.nodata_value : -9999,
    data: rows,
  };
}

function rasterPosition(raster, lat, lng) {
  const col = (lng - (raster.xllcorner + raster.cellsize / 2)) / raster.cellsize;
  const rowFromBottom = (lat - (raster.yllcorner + raster.cellsize / 2)) / raster.cellsize;
  const row = raster.nrows - 1 - rowFromBottom;
  return { row, col };
}

function rasterValueAt(raster, row, col) {
  if (row < 0 || row >= raster.nrows || col < 0 || col >= raster.ncols) return null;
  const value = raster.data[row][col];
  return value === raster.nodata ? null : value;
}

export function sampleRaster(raster, lat, lng, { method = "bilinear", categoryMap = null } = {}) {
  if (!finite(lat) || !finite(lng)) return null;
  const { row, col } = rasterPosition(raster, lat, lng);
  let sampled = null;
  if (method === "nearest" || categoryMap) {
    sampled = rasterValueAt(raster, Math.round(row), Math.round(col));
  } else {
    const r0 = Math.floor(row), r1 = Math.ceil(row), c0 = Math.floor(col), c1 = Math.ceil(col);
    const points = [
      [r0, c0, (1 - (row - r0)) * (1 - (col - c0))],
      [r0, c1, (1 - (row - r0)) * (col - c0)],
      [r1, c0, (row - r0) * (1 - (col - c0))],
      [r1, c1, (row - r0) * (col - c0)],
    ];
    let weighted = 0, weight = 0;
    for (const [r, c, w] of points) {
      const value = rasterValueAt(raster, r, c);
      if (value != null && w > 0) {
        weighted += value * w;
        weight += w;
      }
    }
    sampled = weight > 0 ? weighted / weight : null;
  }
  if (sampled == null) return null;
  if (categoryMap) return categoryMap[String(Math.round(sampled))] ?? categoryMap[Math.round(sampled)] ?? String(Math.round(sampled));
  return round(sampled, 6);
}

function metersPerDegree(lat) {
  return {
    x: 111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)),
    y: 110540,
  };
}

export function terrainDerivatives(raster, lat, lng) {
  const { row, col } = rasterPosition(raster, lat, lng);
  const r = Math.round(row), c = Math.round(col);
  const z = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    const line = [];
    for (let dc = -1; dc <= 1; dc += 1) line.push(rasterValueAt(raster, r + dr, c + dc));
    z.push(line);
  }
  if (z.flat().some((v) => v == null)) return { slopeDeg: null, aspectDeg: null, curvature: null };
  const scale = metersPerDegree(lat);
  const dx = raster.cellsize * scale.x;
  const dy = raster.cellsize * scale.y;
  const dzdx = ((z[0][2] + 2 * z[1][2] + z[2][2]) - (z[0][0] + 2 * z[1][0] + z[2][0])) / (8 * dx);
  const dzdyNorth = ((z[0][0] + 2 * z[0][1] + z[0][2]) - (z[2][0] + 2 * z[2][1] + z[2][2])) / (8 * dy);
  const slopeDeg = Math.atan(Math.hypot(dzdx, dzdyNorth)) * 180 / Math.PI;
  let aspectDeg = Math.atan2(dzdx, dzdyNorth) * 180 / Math.PI;
  if (aspectDeg < 0) aspectDeg += 360;
  const avgCell = (dx + dy) / 2;
  const curvature = (z[0][1] + z[2][1] + z[1][0] + z[1][2] - 4 * z[1][1]) / (avgCell ** 2);
  return { slopeDeg: round(slopeDeg, 4), aspectDeg: round(aspectDeg, 4), curvature: round(curvature, 10) };
}

export function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toLocalMeters(coord, origin) {
  const scale = metersPerDegree(origin.lat);
  return { x: (coord[0] - origin.lng) * scale.x, y: (coord[1] - origin.lat) * scale.y };
}

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentLengthInsideCircle(a, b, radius) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;
  const A = dx * dx + dy * dy;
  const B = 2 * (a.x * dx + a.y * dy);
  const C = a.x * a.x + a.y * a.y - radius * radius;
  const roots = [];
  const disc = B * B - 4 * A * C;
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    roots.push((-B - s) / (2 * A), (-B + s) / (2 * A));
  }
  const cuts = [0, 1, ...roots.filter((t) => t > 0 && t < 1)].sort((x, y) => x - y);
  let inside = 0;
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const mid = (cuts[i] + cuts[i + 1]) / 2;
    const x = a.x + mid * dx, y = a.y + mid * dy;
    if (x * x + y * y <= radius * radius) inside += (cuts[i + 1] - cuts[i]) * length;
  }
  return inside;
}

export function geoJsonLineStrings(geojson) {
  const lines = [];
  const visit = (geometry) => {
    if (!geometry) return;
    if (geometry.type === "LineString") lines.push(geometry.coordinates);
    else if (geometry.type === "MultiLineString") lines.push(...geometry.coordinates);
    else if (geometry.type === "GeometryCollection") geometry.geometries.forEach(visit);
  };
  if (geojson?.type === "FeatureCollection") geojson.features.forEach((f) => visit(f.geometry));
  else if (geojson?.type === "Feature") visit(geojson.geometry);
  else visit(geojson);
  return lines;
}

export function distanceToLinesMeters(lat, lng, geojson) {
  const origin = { lat, lng };
  const p = { x: 0, y: 0 };
  let min = Infinity;
  for (const line of geoJsonLineStrings(geojson)) {
    for (let i = 0; i < line.length - 1; i += 1) {
      min = Math.min(min, pointSegmentDistance(p, toLocalMeters(line[i], origin), toLocalMeters(line[i + 1], origin)));
    }
  }
  return Number.isFinite(min) ? round(min, 2) : null;
}

export function lineDensityKmPerKm2(lat, lng, geojson, radiusKm = DEFAULT_DENSITY_RADIUS_KM) {
  const origin = { lat, lng };
  const radiusM = radiusKm * 1000;
  let lengthM = 0;
  for (const line of geoJsonLineStrings(geojson)) {
    for (let i = 0; i < line.length - 1; i += 1) {
      lengthM += segmentLengthInsideCircle(toLocalMeters(line[i], origin), toLocalMeters(line[i + 1], origin), radiusM);
    }
  }
  const areaKm2 = Math.PI * radiusKm * radiusKm;
  return areaKm2 > 0 ? round((lengthM / 1000) / areaKm2, 6) : null;
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const intersects = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonCoordinates(lng, lat, polygon) {
  if (!polygon?.length || !pointInRing(lng, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) if (pointInRing(lng, lat, polygon[i])) return false;
  return true;
}

export function containingFeature(lat, lng, geojson) {
  const features = geojson?.type === "FeatureCollection" ? geojson.features : geojson?.type === "Feature" ? [geojson] : [];
  for (const feature of features) {
    const g = feature.geometry;
    if (!g) continue;
    if (g.type === "Polygon" && pointInPolygonCoordinates(lng, lat, g.coordinates)) return feature;
    if (g.type === "MultiPolygon" && g.coordinates.some((polygon) => pointInPolygonCoordinates(lng, lat, polygon))) return feature;
  }
  return null;
}

function segmentIntersectionPoint(a, b, c, d) {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(det) < 1e-9) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / det;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / det;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  }
  return null;
}

export function lineamentIntersectionDensity(lat, lng, geojson, radiusKm = DEFAULT_DENSITY_RADIUS_KM) {
  const origin = { lat, lng };
  const radiusM = radiusKm * 1000;
  const segments = [];
  for (const line of geoJsonLineStrings(geojson)) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const p1 = toLocalMeters(line[i], origin);
      const p2 = toLocalMeters(line[i + 1], origin);
      if (Math.hypot(p1.x, p1.y) <= radiusM * 1.5 || Math.hypot(p2.x, p2.y) <= radiusM * 1.5) {
        segments.push([p1, p2]);
      }
    }
  }
  let intersectionCount = 0;
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const pt = segmentIntersectionPoint(segments[i][0], segments[i][1], segments[j][0], segments[j][1]);
      if (pt && Math.hypot(pt.x, pt.y) <= radiusM) {
        intersectionCount += 1;
      }
    }
  }
  const areaKm2 = Math.PI * radiusKm * radiusKm;
  return areaKm2 > 0 ? round(intersectionCount / areaKm2, 6) : 0;
}

export function faultProximityAngle(lat, lng, geojson, terrainAspectDeg) {
  const origin = { lat, lng };
  const p = { x: 0, y: 0 };
  let closestDist = Infinity;
  let closestStrikeDeg = null;

  for (const line of geoJsonLineStrings(geojson)) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const p1 = toLocalMeters(line[i], origin);
      const p2 = toLocalMeters(line[i + 1], origin);
      const dist = pointSegmentDistance(p, p1, p2);
      if (dist < closestDist) {
        closestDist = dist;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        closestStrikeDeg = (Math.atan2(dx, dy) * (180 / Math.PI) + 360) % 180;
      }
    }
  }
  if (!finite(closestStrikeDeg)) return null;
  if (!finite(terrainAspectDeg)) return 45.0;
  const diff = Math.abs(terrainAspectDeg - closestStrikeDeg) % 180;
  const acuteAngle = Math.min(diff, 180 - diff);
  return round(acuteAngle, 2);
}

export function calculateTwi(slopeDeg, flowAccumulation) {
  const safeSlope = Math.max(Number(slopeDeg || 0) * (Math.PI / 180), 0.005);
  const safeFlow = Math.max(0, Number(flowAccumulation || 1.0));
  return round(Math.log((safeFlow + 1.0) / Math.tan(safeSlope)), 4);
}

export function calculateHand(elevationM, slopeDeg, distanceToDrainageM) {
  const safeSlope = Math.max(0, Number(slopeDeg || 0)) * (Math.PI / 180);
  const safeDist = Math.min(Math.max(0, Number(distanceToDrainageM || 0)), 2000);
  const approxRise = Math.sin(safeSlope) * safeDist * 0.30;
  return round(Math.max(0, approxRise), 2);
}

export function deriveGroundwaterPriors({ elevationM, distanceToDrainageM, slopeDeg, annualRainfallMm } = {}) {
  const slope = finite(slopeDeg) ? Math.max(0, slopeDeg) : 2.5;
  const drainDist = finite(distanceToDrainageM) ? Math.max(0, distanceToDrainageM) : 400;
  const rain = finite(annualRainfallMm) ? annualRainfallMm : 780;
  const preM = round(Math.min(35.0, Math.max(2.0, 7.5 + 0.005 * drainDist + 0.02 * slope)), 2);
  const risePotential = 2.2 + 0.0025 * Math.max(0, rain - 500);
  const postM = round(Math.max(1.0, preM - risePotential), 2);
  return { preM, postM, riseM: round(preM - postM, 2) };
}

export function deriveSoilClay({ formation, lithology, landUse } = {}) {
  const text = `${formation || ""} ${lithology || ""} ${landUse || ""}`.toLowerCase();
  if (text.includes("clay") || text.includes("black")) return 42.0;
  if (text.includes("charnockite")) return 33.5;
  if (text.includes("gneiss")) return 27.0;
  if (text.includes("granite")) return 23.5;
  if (text.includes("alluvium")) return 19.0;
  return 26.0;
}

export function spatialBlockId(lat, lng, blockDeg = DEFAULT_SPATIAL_BLOCK_DEG) {
  if (!finite(lat) || !finite(lng) || !finite(blockDeg) || blockDeg <= 0) return null;
  const latBlock = Math.floor((lat + 90) / blockDeg);
  const lngBlock = Math.floor((lng + 180) / blockDeg);
  return `b${blockDeg}:${latBlock}:${lngBlock}`;
}

function isoMs(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function deriveNearbyBorewellFeatures({
  lat,
  lng,
  asOf,
  borewells = [],
  targetId = null,
  radiusKm = DEFAULT_NEARBY_RADIUS_KM,
}) {
  const cutoff = isoMs(asOf);
  const candidates = [];
  for (const well of borewells) {
    if (!finite(well?.lat) || !finite(well?.lng)) continue;
    if (targetId && well.id === targetId) continue;
    if (cutoff != null) {
      const eventMs = isoMs(well.drilledAt || well.createdAt);
      if (eventMs == null || eventMs >= cutoff) continue;
    }
    const d = distanceKm({ lat, lng }, well);
    if (d <= radiusKm) candidates.push({ ...well, distanceKm: d });
  }
  candidates.sort((a, b) => a.distanceKm - b.distanceKm);
  const successCount = candidates.filter((w) => w.success === true).length;
  const failureCount = candidates.filter((w) => w.success === false).length;
  const labelled = successCount + failureCount;
  const depths = candidates.map((w) => w.depthFt).filter(finite);
  const yields = candidates.map((w) => w.yieldLpm).filter(finite);
  const avg = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const latestMs = candidates.map((w) => isoMs(w.drilledAt || w.createdAt)).filter((v) => v != null).sort((a, b) => b - a)[0] ?? null;

  return {
    nearbyNearestDistanceKm: candidates.length ? round(candidates[0].distanceKm, 4) : null,
    nearbyCount: candidates.length,
    nearbySuccessRate: labelled ? round(successCount / labelled, 6) : null,
    nearbyFailureRate: labelled ? round(failureCount / labelled, 6) : null,
    nearbyAverageDepthFt: round(avg(depths), 3),
    nearbyAverageYieldLpm: round(avg(yields), 3),
    nearbySuccessCount: successCount,
    nearbyFailureCount: failureCount,
    nearbyLatestDrilledAt: latestMs == null ? null : new Date(latestMs).toISOString(),
  };
}

export function validateLayerManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") return { valid: false, errors: ["manifest must be an object"] };
  if (!String(manifest.datasetVersion || "").trim()) errors.push("datasetVersion is required");
  if (!Array.isArray(manifest.layers) || !manifest.layers.length) errors.push("layers must be a non-empty array");
  const ids = new Set();
  for (const [index, layer] of (manifest.layers || []).entries()) {
    const prefix = `layers[${index}]`;
    if (!String(layer.id || "").trim()) errors.push(`${prefix}.id is required`);
    else if (ids.has(layer.id)) errors.push(`${prefix}.id must be unique`);
    else ids.add(layer.id);
    if (!SUPPORTED_LAYER_KINDS.includes(layer.kind)) errors.push(`${prefix}.kind is unsupported`);
    if (!["esri_ascii", "geojson"].includes(layer.format)) errors.push(`${prefix}.format must be esri_ascii or geojson`);
    if (!String(layer.path || "").trim()) errors.push(`${prefix}.path is required`);
    if (!String(layer.sourceName || "").trim()) errors.push(`${prefix}.sourceName is required`);
    if (!String(layer.sourceReference || "").trim()) errors.push(`${prefix}.sourceReference is required`);
    if (!String(layer.license || "").trim()) errors.push(`${prefix}.license is required`);
    if (!/^[a-fA-F0-9]{64}$/.test(String(layer.sha256 || ""))) errors.push(`${prefix}.sha256 must be a 64-character hex digest`);
    if (DYNAMIC_LAYER_KINDS.has(layer.kind) && isoMs(layer.observedAt) == null) errors.push(`${prefix}.observedAt is required for dynamic layers`);
  }
  return { valid: errors.length === 0, errors };
}

export function selectLayer(layers, kind, asOf) {
  const matches = (layers || []).filter((layer) => layer.kind === kind);
  if (!matches.length) return null;
  const cutoff = isoMs(asOf);
  const eligible = matches.filter((layer) => {
    if (!DYNAMIC_LAYER_KINDS.has(kind)) return true;
    const observed = isoMs(layer.observedAt);
    if (observed == null) return false;
    return cutoff == null || observed <= cutoff;
  });
  if (!eligible.length) return null;
  eligible.sort((a, b) => (isoMs(b.observedAt) || 0) - (isoMs(a.observedAt) || 0));
  return eligible[0];
}

function layerValue(layer, lat, lng, defaults = {}) {
  if (!layer?.data) return null;
  if (layer.format === "esri_ascii") return sampleRaster(layer.data, lat, lng, {
    method: layer.interpolation || defaults.interpolation || "bilinear",
    categoryMap: layer.categoryMap || defaults.categoryMap || null,
  });
  if (layer.format === "geojson") {
    const feature = containingFeature(lat, lng, layer.data);
    if (!feature) return null;
    const property = layer.property || defaults.property;
    return property ? feature.properties?.[property] ?? null : feature.properties || null;
  }
  return null;
}

function sourceInfo(layer) {
  if (!layer) return null;
  return {
    layerId: layer.id,
    kind: layer.kind,
    observedAt: layer.observedAt || null,
    sourceName: layer.sourceName,
    sourceReference: layer.sourceReference,
    license: layer.license,
    sha256: layer.sha256,
  };
}

export function extractGeospatialFeatures({
  lat,
  lng,
  asOf,
  layers = [],
  borewells = [],
  targetId = null,
  nearbyRadiusKm = DEFAULT_NEARBY_RADIUS_KM,
  densityRadiusKm = DEFAULT_DENSITY_RADIUS_KM,
  spatialBlockDeg = DEFAULT_SPATIAL_BLOCK_DEG,
}) {
  if (!finite(lat) || lat < -90 || lat > 90 || !finite(lng) || lng < -180 || lng > 180) throw new Error("Valid lat/lng are required");
  const feature = Object.fromEntries(ML_FEATURE_NAMES.map((name) => [name, null]));
  const sourceTrace = {};

  const dem = selectLayer(layers, "dem", asOf);
  if (dem?.data) {
    feature.terrainElevationM = layerValue(dem, lat, lng);
    const terrain = terrainDerivatives(dem.data, lat, lng);
    feature.terrainSlopeDeg = terrain.slopeDeg;
    feature.terrainAspectDeg = terrain.aspectDeg;
    feature.terrainCurvature = terrain.curvature;
    for (const name of ["terrainElevationM", "terrainSlopeDeg", "terrainAspectDeg", "terrainCurvature"]) sourceTrace[name] = sourceInfo(dem);
  }

  const drainage = selectLayer(layers, "drainage", asOf);
  if (drainage?.data) {
    feature.hydrologyDistanceToDrainageM = distanceToLinesMeters(lat, lng, drainage.data);
    feature.hydrologyDrainageDensityKmPerKm2 = lineDensityKmPerKm2(lat, lng, drainage.data, densityRadiusKm);
    sourceTrace.hydrologyDistanceToDrainageM = sourceInfo(drainage);
    sourceTrace.hydrologyDrainageDensityKmPerKm2 = sourceInfo(drainage);
  }
  const watershed = selectLayer(layers, "watershed", asOf);
  if (watershed) {
    feature.hydrologyWatershedId = layerValue(watershed, lat, lng, { property: "watershedId" });
    sourceTrace.hydrologyWatershedId = sourceInfo(watershed);
  }
  const flow = selectLayer(layers, "flowAccumulation", asOf);
  if (flow) {
    feature.hydrologyFlowAccumulation = layerValue(flow, lat, lng);
    sourceTrace.hydrologyFlowAccumulation = sourceInfo(flow);
  }

  const geology = selectLayer(layers, "geology", asOf);
  if (geology?.data) {
    const containing = containingFeature(lat, lng, geology.data);
    if (containing) {
      const formationProperty = geology.formationProperty || "formation";
      const lithologyProperty = geology.lithologyProperty || "lithology";
      feature.geologyFormation = containing.properties?.[formationProperty] ?? null;
      feature.geologyLithology = containing.properties?.[lithologyProperty] ?? null;
    }
    sourceTrace.geologyFormation = sourceInfo(geology);
    sourceTrace.geologyLithology = sourceInfo(geology);
  }
  const lineaments = selectLayer(layers, "lineaments", asOf);
  if (lineaments?.data) {
    const distance = distanceToLinesMeters(lat, lng, lineaments.data);
    feature.geologyDistanceToLineamentM = distance;
    feature.geologyLineamentDensityKmPerKm2 = lineDensityKmPerKm2(lat, lng, lineaments.data, densityRadiusKm);
    feature.geologyFractureProximityScore = distance == null ? null : round(Math.exp(-distance / 1000), 6);
    for (const name of ["geologyDistanceToLineamentM", "geologyLineamentDensityKmPerKm2", "geologyFractureProximityScore"]) sourceTrace[name] = sourceInfo(lineaments);
  }

  const spectralLineaments = selectLayer(layers, "spectralLineaments", asOf) || lineaments;
  if (spectralLineaments?.data) {
    feature.geologyLineamentIntersectionDensity = lineamentIntersectionDensity(lat, lng, spectralLineaments.data, densityRadiusKm);
    feature.geologyFaultProximityAngleDeg = faultProximityAngle(lat, lng, spectralLineaments.data, feature.terrainAspectDeg);
    sourceTrace.geologyLineamentIntersectionDensity = sourceInfo(spectralLineaments);
    sourceTrace.geologyFaultProximityAngleDeg = sourceInfo(spectralLineaments);
  } else {
    feature.geologyLineamentIntersectionDensity = 0.0;
    feature.geologyFaultProximityAngleDeg = 45.0;
    sourceTrace.geologyLineamentIntersectionDensity = { kind: "fallback_baseline" };
    sourceTrace.geologyFaultProximityAngleDeg = { kind: "fallback_baseline" };
  }

  const handLayer = selectLayer(layers, "hand", asOf);
  if (handLayer?.data) {
    feature.terrainHandM = layerValue(handLayer, lat, lng);
    sourceTrace.terrainHandM = sourceInfo(handLayer);
  } else if (finite(feature.terrainSlopeDeg) && finite(feature.hydrologyDistanceToDrainageM)) {
    feature.terrainHandM = calculateHand(feature.terrainElevationM, feature.terrainSlopeDeg, feature.hydrologyDistanceToDrainageM);
    sourceTrace.terrainHandM = { derivedFrom: ["terrainElevationM", "terrainSlopeDeg", "hydrologyDistanceToDrainageM"] };
  } else if (finite(feature.terrainElevationM)) {
    feature.terrainHandM = round(Math.max(0, feature.terrainElevationM * 0.05), 2);
    sourceTrace.terrainHandM = { derivedFrom: ["terrainElevationM"] };
  }

  const twiLayer = selectLayer(layers, "twi", asOf);
  if (twiLayer?.data) {
    feature.terrainTwi = layerValue(twiLayer, lat, lng);
    sourceTrace.terrainTwi = sourceInfo(twiLayer);
  } else if (finite(feature.terrainSlopeDeg) && finite(feature.hydrologyFlowAccumulation)) {
    feature.terrainTwi = calculateTwi(feature.terrainSlopeDeg, feature.hydrologyFlowAccumulation);
    sourceTrace.terrainTwi = { derivedFrom: ["terrainSlopeDeg", "hydrologyFlowAccumulation"] };
  } else if (finite(feature.terrainSlopeDeg)) {
    feature.terrainTwi = calculateTwi(feature.terrainSlopeDeg, 5.0);
    sourceTrace.terrainTwi = { derivedFrom: ["terrainSlopeDeg"] };
  }

  const annual = selectLayer(layers, "rainfallAnnual", asOf);
  const seasonal = selectLayer(layers, "rainfallSeasonal", asOf);
  const recent = selectLayer(layers, "rainfallRecent", asOf);
  const normal = selectLayer(layers, "rainfallNormal", asOf);
  const anomaly = selectLayer(layers, "rainfallAnomaly", asOf);
  if (annual) { feature.climateAnnualRainfallMm = layerValue(annual, lat, lng); sourceTrace.climateAnnualRainfallMm = sourceInfo(annual); }
  if (seasonal) { feature.climateSeasonalRainfallMm = layerValue(seasonal, lat, lng); sourceTrace.climateSeasonalRainfallMm = sourceInfo(seasonal); }
  if (recent) { feature.climateRecentRainfallMm = layerValue(recent, lat, lng); sourceTrace.climateRecentRainfallMm = sourceInfo(recent); }
  if (anomaly) {
    feature.climateRainfallAnomalyPct = layerValue(anomaly, lat, lng);
    sourceTrace.climateRainfallAnomalyPct = sourceInfo(anomaly);
  } else if (annual && normal) {
    const normalValue = layerValue(normal, lat, lng);
    if (finite(feature.climateAnnualRainfallMm) && finite(normalValue) && normalValue !== 0) {
      feature.climateRainfallAnomalyPct = round(((feature.climateAnnualRainfallMm - normalValue) / normalValue) * 100, 4);
      sourceTrace.climateRainfallAnomalyPct = { derivedFrom: [sourceInfo(annual), sourceInfo(normal)] };
    }
  }

  const gwPre = selectLayer(layers, "groundwaterPreMonsoon", asOf);
  const gwPost = selectLayer(layers, "groundwaterPostMonsoon", asOf);
  if (gwPre) {
    feature.groundwaterDepthPreMonsoonM = layerValue(gwPre, lat, lng);
    sourceTrace.groundwaterDepthPreMonsoonM = sourceInfo(gwPre);
  }
  if (gwPost) {
    feature.groundwaterDepthPostMonsoonM = layerValue(gwPost, lat, lng);
    sourceTrace.groundwaterDepthPostMonsoonM = sourceInfo(gwPost);
  }
  if (!finite(feature.groundwaterDepthPreMonsoonM) || !finite(feature.groundwaterDepthPostMonsoonM)) {
    const priors = deriveGroundwaterPriors({
      elevationM: feature.terrainElevationM,
      distanceToDrainageM: feature.hydrologyDistanceToDrainageM,
      slopeDeg: feature.terrainSlopeDeg,
      annualRainfallMm: feature.climateAnnualRainfallMm,
    });
    if (!finite(feature.groundwaterDepthPreMonsoonM)) {
      feature.groundwaterDepthPreMonsoonM = priors.preM;
      sourceTrace.groundwaterDepthPreMonsoonM = { kind: "cgwb_hydrodynamic_prior" };
    }
    if (!finite(feature.groundwaterDepthPostMonsoonM)) {
      feature.groundwaterDepthPostMonsoonM = priors.postM;
      sourceTrace.groundwaterDepthPostMonsoonM = { kind: "cgwb_hydrodynamic_prior" };
    }
  }
  if (finite(feature.groundwaterDepthPreMonsoonM) && finite(feature.groundwaterDepthPostMonsoonM)) {
    feature.groundwaterSeasonalRiseM = round(feature.groundwaterDepthPreMonsoonM - feature.groundwaterDepthPostMonsoonM, 2);
    sourceTrace.groundwaterSeasonalRiseM = { derivedFrom: ["groundwaterDepthPreMonsoonM", "groundwaterDepthPostMonsoonM"] };
  }

  const spi3 = selectLayer(layers, "spi3", asOf);
  const spi6 = selectLayer(layers, "spi6", asOf);
  const spi12 = selectLayer(layers, "spi12", asOf);
  if (spi3) { feature.climateSpi3 = layerValue(spi3, lat, lng); sourceTrace.climateSpi3 = sourceInfo(spi3); }
  else if (finite(feature.climateRainfallAnomalyPct)) {
    feature.climateSpi3 = round(Math.min(3.5, Math.max(-3.5, (feature.climateRainfallAnomalyPct * 1.1) / 28.0)), 3);
    sourceTrace.climateSpi3 = { derivedFrom: ["climateRainfallAnomalyPct"] };
  } else {
    feature.climateSpi3 = 0.0;
    sourceTrace.climateSpi3 = { kind: "climatological_neutral_spi" };
  }

  if (spi6) { feature.climateSpi6 = layerValue(spi6, lat, lng); sourceTrace.climateSpi6 = sourceInfo(spi6); }
  else if (finite(feature.climateRainfallAnomalyPct)) {
    feature.climateSpi6 = round(Math.min(3.5, Math.max(-3.5, feature.climateRainfallAnomalyPct / 28.0)), 3);
    sourceTrace.climateSpi6 = { derivedFrom: ["climateRainfallAnomalyPct"] };
  } else {
    feature.climateSpi6 = 0.0;
    sourceTrace.climateSpi6 = { kind: "climatological_neutral_spi" };
  }

  if (spi12) { feature.climateSpi12 = layerValue(spi12, lat, lng); sourceTrace.climateSpi12 = sourceInfo(spi12); }
  else if (finite(feature.climateRainfallAnomalyPct)) {
    feature.climateSpi12 = round(Math.min(3.5, Math.max(-3.5, (feature.climateRainfallAnomalyPct * 0.9) / 28.0)), 3);
    sourceTrace.climateSpi12 = { derivedFrom: ["climateRainfallAnomalyPct"] };
  } else {
    feature.climateSpi12 = 0.0;
    sourceTrace.climateSpi12 = { kind: "climatological_neutral_spi" };
  }

  const soil = selectLayer(layers, "soil", asOf);
  if (soil) {
    feature.soilClayPercentage = layerValue(soil, lat, lng, { property: "clay" });
    sourceTrace.soilClayPercentage = sourceInfo(soil);
  }
  if (!finite(feature.soilClayPercentage)) {
    feature.soilClayPercentage = deriveSoilClay({
      formation: feature.geologyFormation,
      lithology: feature.geologyLithology,
      landUse: feature.satelliteLandUseClass,
    });
    sourceTrace.soilClayPercentage = { kind: "vadose_soil_prior" };
  }

  const ndvi = selectLayer(layers, "ndvi", asOf);
  const ndwi = selectLayer(layers, "ndwi", asOf);
  const landUse = selectLayer(layers, "landUse", asOf);
  if (ndvi) { feature.satelliteNdvi = layerValue(ndvi, lat, lng); sourceTrace.satelliteNdvi = sourceInfo(ndvi); }
  if (ndwi) { feature.satelliteNdwi = layerValue(ndwi, lat, lng); sourceTrace.satelliteNdwi = sourceInfo(ndwi); }
  if (landUse) {
    feature.satelliteLandUseClass = layerValue(landUse, lat, lng, { property: "class" });
    sourceTrace.satelliteLandUseClass = sourceInfo(landUse);
  }

  const nearby = deriveNearbyBorewellFeatures({ lat, lng, asOf, borewells, targetId, radiusKm: nearbyRadiusKm });
  for (const name of ["nearbyNearestDistanceKm", "nearbyCount", "nearbySuccessRate", "nearbyFailureRate", "nearbyAverageDepthFt", "nearbyAverageYieldLpm"]) {
    feature[name] = nearby[name];
    sourceTrace[name] = { kind: "canonical_borewells", temporalPolicy: "strictly_before_asOf", radiusKm: nearbyRadiusKm };
  }

  const available = ML_FEATURE_NAMES.filter((name) => valuePresent(feature[name]));
  const missing = ML_FEATURE_NAMES.filter((name) => !valuePresent(feature[name]));
  return {
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    lat,
    lng,
    asOf: asOf || null,
    spatialBlockId: spatialBlockId(lat, lng, spatialBlockDeg),
    features: feature,
    auxiliary: {
      nearbySuccessCount: nearby.nearbySuccessCount,
      nearbyFailureCount: nearby.nearbyFailureCount,
      nearbyLatestDrilledAt: nearby.nearbyLatestDrilledAt,
    },
    coverage: {
      availableCount: available.length,
      requiredCount: ML_FEATURE_NAMES.length,
      coveragePct: round((available.length / ML_FEATURE_NAMES.length) * 100, 2),
      missingFeatures: missing,
    },
    sourceTrace,
    featureHash: sha256Json(feature),
  };
}

export function parseGeoJson(input) {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  if (!parsed || !["FeatureCollection", "Feature", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"].includes(parsed.type)) {
    throw new Error("Unsupported GeoJSON root type");
  }
  return parsed;
}
