// ingestion.js — deterministic CSV validation and normalization for BoreSakshi.
// It deliberately does not infer groundwater results: every invalid/ambiguous
// input is rejected or sent to human review.
const HEADER_ALIASES = {
  lat: ["lat", "latitude"],
  lng: ["lng", "lon", "long", "longitude"],
  success: ["success", "outcome", "result", "waterfound"],
  placeName: ["placename", "place", "village", "location", "area"],
  drillingDate: ["drillingdate", "date", "drilledon"],
  depthFt: ["depthft", "depth", "totaldepthft", "totaldepth"],
  waterStrikeFt: ["waterstrikeft", "waterstrikedepthft", "strikedepthft"],
  yieldLpm: ["yieldlpm", "yield", "discharge", "dischargelpm"],
  strata: ["strata", "geology", "geologicalayers", "rocktype"],
  gpsAccuracyM: ["gpsaccuracym", "gpsaccuracy", "accuracy"],
  district: ["district"],
  taluk: ["taluk", "tehsil"],
  state: ["state"],
};

const canonical = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const cleanText = (value, max = 120) => String(value || "").trim().slice(0, max);

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n") {
      row.push(field);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = []; field = "";
      continue;
    }
    if (char !== "\r") field += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  row.push(field);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one data row");
  return rows;
}

function resolveColumns(headers) {
  const normalized = headers.map(canonical);
  const columns = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    columns[field] = normalized.findIndex((header) => aliases.includes(header));
  }
  const missing = ["lat", "lng", "success"].filter((field) => columns[field] < 0);
  if (missing.length) throw new Error(`CSV is missing required column(s): ${missing.join(", ")}`);
  return columns;
}

function optionalNumber(value, field, issues, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const source = cleanText(value, 80);
  if (!source) return null;
  const number = Number(source);
  if (!Number.isFinite(number) || number < min || number > max) {
    issues.push(`${field} must be a number between ${min} and ${max}`);
    return null;
  }
  return number;
}

function normalizeSuccess(value, issues) {
  const result = canonical(value);
  if (["true", "yes", "success", "successful", "water", "waterfound", "1"].includes(result)) return true;
  if (["false", "no", "dry", "failed", "failure", "dryhole", "0"].includes(result)) return false;
  issues.push("success must be a recognised success/failure value");
  return null;
}

function normalizeDate(value, issues) {
  const source = cleanText(value, 80);
  if (!source) return null;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    issues.push("drillingDate is not a valid date");
    return null;
  }
  return date.toISOString();
}

function sourceValue(row, columns, field) {
  const index = columns[field];
  return index >= 0 ? row[index] : "";
}

function qualityScore(record) {
  let score = 30; // valid coordinate pair
  if (record.gpsAccuracyM != null && record.gpsAccuracyM <= 30) score += 10;
  if (record.drillingDate) score += 10;
  if (record.depthFt != null) score += 15;
  if (record.waterStrikeFt != null) score += 10;
  if (record.yieldLpm != null) score += 10;
  if (record.strata) score += 10;
  if (record.placeName || record.district || record.taluk) score += 5;
  return Math.min(score, 100);
}

export function duplicateKey(record) {
  const point = `${record.lat.toFixed(5)},${record.lng.toFixed(5)}`;
  return record.drillingDate ? `${point},${record.drillingDate.slice(0, 10)}` : point;
}

export function validateBorewellCsv(csvText, existingRecords = []) {
  const rows = parseCsv(csvText);
  const columns = resolveColumns(rows[0]);
  const seen = new Set(existingRecords.map(duplicateKey));
  const accepted = [], rejected = [], duplicates = [];

  rows.slice(1).forEach((row, offset) => {
    const line = offset + 2;
    const issues = [];
    const lat = optionalNumber(sourceValue(row, columns, "lat"), "lat", issues, { min: -90, max: 90 });
    const lng = optionalNumber(sourceValue(row, columns, "lng"), "lng", issues, { min: -180, max: 180 });
    const success = normalizeSuccess(sourceValue(row, columns, "success"), issues);
    if (lat == null) issues.push("lat is required");
    if (lng == null) issues.push("lng is required");

    const record = {
      lat, lng, success,
      placeName: cleanText(sourceValue(row, columns, "placeName"), 80),
      drillingDate: normalizeDate(sourceValue(row, columns, "drillingDate"), issues),
      depthFt: optionalNumber(sourceValue(row, columns, "depthFt"), "depthFt", issues, { min: 0, max: 5000 }),
      waterStrikeFt: optionalNumber(sourceValue(row, columns, "waterStrikeFt"), "waterStrikeFt", issues, { min: 0, max: 5000 }),
      yieldLpm: optionalNumber(sourceValue(row, columns, "yieldLpm"), "yieldLpm", issues, { min: 0, max: 100000 }),
      strata: cleanText(sourceValue(row, columns, "strata"), 120),
      gpsAccuracyM: optionalNumber(sourceValue(row, columns, "gpsAccuracyM"), "gpsAccuracyM", issues, { min: 0, max: 100000 }),
      district: cleanText(sourceValue(row, columns, "district"), 80),
      taluk: cleanText(sourceValue(row, columns, "taluk"), 80),
      state: cleanText(sourceValue(row, columns, "state"), 80),
    };

    if (record.depthFt != null && record.waterStrikeFt != null && record.waterStrikeFt > record.depthFt) {
      issues.push("waterStrikeFt cannot exceed depthFt");
    }
    if (issues.length) {
      rejected.push({ line, issues });
      return;
    }

    const key = duplicateKey(record);
    if (seen.has(key)) {
      duplicates.push({ line, key });
      return;
    }
    seen.add(key);
    accepted.push({ ...record, qualityScore: qualityScore(record) });
  });

  return {
    totalRows: rows.length - 1,
    accepted,
    rejected,
    duplicates,
    summary: {
      accepted: accepted.length,
      rejected: rejected.length,
      duplicates: duplicates.length,
      averageQualityScore: accepted.length
        ? Math.round(accepted.reduce((sum, record) => sum + record.qualityScore, 0) / accepted.length)
        : null,
    },
  };
}
