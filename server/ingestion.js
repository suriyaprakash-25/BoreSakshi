// ingestion.js — Phase 2 pure data-ingestion pipeline primitives.
// No DB access lives here: parsing, cleaning, normalization, quality scoring,
// duplicate signatures and publish-shape conversion stay deterministic/testable.
import { createHash } from "node:crypto";

export const DATASET_SCHEMA_VERSION = "1.0.0";
export const QUALITY_THRESHOLD = 70;
export const MAX_IMPORT_ROWS = 5000;
export const DUPLICATE_RADIUS_METERS = 50;

export const SOURCE_TYPES = [
  "historical",
  "operator",
  "government",
  "public",
  "groundwater_observation",
];

export const DATASET_KINDS = [
  "borewell_records",
  "satellite_features",
  "rainfall",
  "geology",
  "soil",
  "dem",
  "land_use_land_cover",
  "groundwater_level",
];

const HEADER_ALIASES = new Map(Object.entries({
  lat: "lat", latitude: "lat", gps_lat: "lat", y: "lat",
  lng: "lng", lon: "lng", long: "lng", longitude: "lng", gps_lng: "lng", x: "lng",
  place: "placeName", place_name: "placeName", village: "placeName", location_name: "placeName",
  district: "district", state: "state",
  depth: "depthFt", depth_ft: "depthFt", total_depth: "depthFt", total_depth_ft: "depthFt",
  depth_m: "depthM", total_depth_m: "depthM",
  strata: "strata", rock_type: "strata",
  geology: "geologyClass", geology_class: "geologyClass", lithology: "geologyClass",
  soil: "soilType", soil_type: "soilType",
  rainfall_mm: "rainfallMmAnnual", annual_rainfall_mm: "rainfallMmAnnual", rainfall_mm_annual: "rainfallMmAnnual",
  elevation: "elevationM", elevation_m: "elevationM", dem_m: "elevationM",
  slope: "slopeDeg", slope_deg: "slopeDeg",
  land_use: "landUseClass", land_cover: "landUseClass", lulc: "landUseClass", land_use_land_cover: "landUseClass",
  groundwater_level_m: "groundwaterLevelM", water_table_m: "groundwaterLevelM",
  ndvi: "ndvi", ndwi: "ndwi",
  lineament_density: "lineamentDensity", drainage_density: "drainageDensity",
  water_strike: "waterStrikeFt", water_strike_ft: "waterStrikeFt", strike_depth_ft: "waterStrikeFt",
  water_strike_m: "waterStrikeM", strike_depth_m: "waterStrikeM",
  yield: "yieldLpm", yield_lpm: "yieldLpm", discharge_lpm: "yieldLpm",
  yield_lps: "yieldLps", discharge_lps: "yieldLps",
  success: "success", outcome: "success", water_found: "success", result: "success",
  drilled_at: "drilledAt", drilled_date: "drilledAt", date: "drilledAt", drilling_date: "drilledAt",
  source_record_id: "sourceRecordId", record_id: "sourceRecordId", source_id: "sourceRecordId", well_id: "sourceRecordId",
  evidence_url: "evidenceUrl", evidence: "evidenceUrl", document_url: "evidenceUrl",
}));

const TRUE_VALUES = new Set(["true", "1", "yes", "y", "success", "successful", "wet", "water", "water_found", "found"]);
const FALSE_VALUES = new Set(["false", "0", "no", "n", "fail", "failed", "failure", "dry", "dry_hole", "no_water", "not_found"]);

export class CsvImportError extends Error {
  constructor(message, code = "csv_invalid") {
    super(message);
    this.name = "CsvImportError";
    this.code = code;
  }
}

const cleanHeader = (value) => String(value ?? "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const cleanText = (value, max = 200) => {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
};

const blank = (value) => value == null || String(value).trim() === "";
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

export function parseCsvRows(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new CsvImportError("CSV body is empty", "csv_empty");
  }
  const text = input.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (inQuotes) throw new CsvImportError("CSV contains an unclosed quoted field", "csv_unclosed_quote");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  while (rows.length && rows.at(-1).every((cell) => String(cell).trim() === "")) rows.pop();
  return rows;
}

export function parseBorewellCsv(input) {
  const rows = parseCsvRows(input);
  if (rows.length < 2) throw new CsvImportError("CSV must contain a header and at least one data row", "csv_no_data");

  const rawHeaders = rows[0].map((h) => cleanHeader(h));
  if (rawHeaders.some((h) => !h)) throw new CsvImportError("CSV contains a blank header", "csv_blank_header");

  const canonicalHeaders = rawHeaders.map((h) => HEADER_ALIASES.get(h) || null);
  const seen = new Set();
  for (const h of canonicalHeaders.filter(Boolean)) {
    if (seen.has(h)) throw new CsvImportError(`CSV maps more than one column to '${h}'`, "csv_duplicate_header");
    seen.add(h);
  }
  for (const required of ["lat", "lng", "success"]) {
    if (!seen.has(required)) throw new CsvImportError(`CSV is missing required column '${required}'`, "csv_missing_required_header");
  }

  const dataRows = rows.slice(1).filter((cells) => cells.some((cell) => String(cell).trim() !== ""));
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new CsvImportError(`CSV exceeds the ${MAX_IMPORT_ROWS} row import limit`, "csv_too_many_rows");
  }

  return dataRows.map((cells, index) => {
    const values = {};
    const raw = {};
    rawHeaders.forEach((rawHeader, col) => {
      const value = cells[col] ?? "";
      const canonical = canonicalHeaders[col];
      if (canonical) {
        raw[rawHeader] = value;
        values[canonical] = value;
      }
    });
    return { rowNumber: index + 2, values, raw };
  });
}

function parseNumber(value, field, errors, { min = -Infinity, max = Infinity, factor = 1, warningCode = null, warnings = [] } = {}) {
  if (blank(value)) return null;
  const normalized = String(value).trim().replace(/,/g, "");
  const number = Number(normalized);
  if (!Number.isFinite(number)) {
    errors.push({ code: `${field}_not_number`, field, message: `${field} must be a number` });
    return null;
  }
  const converted = number * factor;
  if (converted < min || converted > max) {
    errors.push({ code: `${field}_out_of_range`, field, message: `${field} is outside the accepted range` });
    return null;
  }
  if (warningCode && factor !== 1) warnings.push({ code: warningCode, field, message: `${field} converted to canonical units` });
  return round(converted, 3);
}

function parseSuccess(value, errors) {
  if (blank(value)) {
    errors.push({ code: "success_required", field: "success", message: "success/outcome is required" });
    return null;
  }
  const normalized = cleanHeader(value);
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  errors.push({ code: "success_invalid", field: "success", message: `Unrecognized success value '${cleanText(value, 40)}'` });
  return null;
}

function parseDate(value, errors) {
  if (blank(value)) return null;
  const raw = String(value).trim();
  const dmy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  let date;
  if (dmy) {
    const [, d, m, y] = dmy;
    date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) date = null;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    date = new Date(`${raw}T00:00:00.000Z`);
  } else {
    const ms = Date.parse(raw);
    date = Number.isNaN(ms) ? null : new Date(ms);
  }
  if (!date || Number.isNaN(date.getTime())) {
    errors.push({ code: "drilled_at_invalid", field: "drilledAt", message: "drilledAt/date is invalid" });
    return null;
  }
  return date.toISOString();
}

function parseEvidenceUrl(value, warnings) {
  if (blank(value)) return "";
  const text = cleanText(value, 500);
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("bad protocol");
    return url.toString();
  } catch {
    warnings.push({ code: "evidence_url_invalid", field: "evidenceUrl", message: "Evidence URL was ignored because it is not HTTP(S)" });
    return "";
  }
}

function normalizeCoordinates(latValue, lngValue, errors, warnings) {
  if (blank(latValue)) errors.push({ code: "lat_required", field: "lat", message: "lat is required" });
  if (blank(lngValue)) errors.push({ code: "lng_required", field: "lng", message: "lng is required" });
  if (blank(latValue) || blank(lngValue)) return { lat: null, lng: null, location: null };

  let lat = Number(String(latValue).trim());
  let lng = Number(String(lngValue).trim());
  if (!Number.isFinite(lat)) errors.push({ code: "lat_not_number", field: "lat", message: "lat must be a number" });
  if (!Number.isFinite(lng)) errors.push({ code: "lng_not_number", field: "lng", message: "lng must be a number" });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { lat: null, lng: null, location: null };

  if (Math.abs(lat) > 90 && Math.abs(lat) <= 180 && Math.abs(lng) <= 90) {
    [lat, lng] = [lng, lat];
    warnings.push({ code: "coordinates_swapped", field: "lat,lng", message: "Latitude/longitude appeared swapped and were normalized" });
  }
  if (lat < -90 || lat > 90) errors.push({ code: "lat_out_of_range", field: "lat", message: "lat must be between -90 and 90" });
  if (lng < -180 || lng > 180) errors.push({ code: "lng_out_of_range", field: "lng", message: "lng must be between -180 and 180" });
  if (errors.some((e) => e.field === "lat" || e.field === "lng" || e.field === "lat,lng")) return { lat: null, lng: null, location: null };

  lat = round(lat, 6);
  lng = round(lng, 6);
  return { lat, lng, location: { type: "Point", coordinates: [lng, lat] } };
}

export function scoreRecordQuality(record, { sourceReference = "" } = {}) {
  let score = 0;
  if (Number.isFinite(record.lat) && Number.isFinite(record.lng)) score += 25;
  if (typeof record.success === "boolean") score += 20;
  if (record.depthFt != null) score += 10;
  if (record.waterStrikeFt != null || record.yieldLpm != null) score += 10;
  if (record.drilledAt) score += 10;
  if (record.sourceRecordId) score += 10;
  if (record.evidenceUrl || sourceReference) score += 5;
  if (record.placeName || record.district || record.state) score += 5;
  if (record.strata) score += 5;
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    band: score >= 85 ? "high" : score >= QUALITY_THRESHOLD ? "medium" : "low",
  };
}

export function normalizeBorewellRow(parsedRow, source) {
  const errors = [];
  const warnings = [];
  const values = parsedRow.values || {};
  const coords = normalizeCoordinates(values.lat, values.lng, errors, warnings);
  const success = parseSuccess(values.success, errors);

  let depthFt = parseNumber(values.depthFt, "depthFt", errors, { min: 0, max: 5000 });
  if (depthFt == null && !blank(values.depthM)) {
    depthFt = parseNumber(values.depthM, "depthFt", errors, { min: 0, max: 5000, factor: 3.28084, warningCode: "depth_m_to_ft", warnings });
  }
  let waterStrikeFt = parseNumber(values.waterStrikeFt, "waterStrikeFt", errors, { min: 0, max: 5000 });
  if (waterStrikeFt == null && !blank(values.waterStrikeM)) {
    waterStrikeFt = parseNumber(values.waterStrikeM, "waterStrikeFt", errors, { min: 0, max: 5000, factor: 3.28084, warningCode: "water_strike_m_to_ft", warnings });
  }
  let yieldLpm = parseNumber(values.yieldLpm, "yieldLpm", errors, { min: 0, max: 100000 });
  if (yieldLpm == null && !blank(values.yieldLps)) {
    yieldLpm = parseNumber(values.yieldLps, "yieldLpm", errors, { min: 0, max: 100000, factor: 60, warningCode: "yield_lps_to_lpm", warnings });
  }
  if (depthFt != null && waterStrikeFt != null && waterStrikeFt > depthFt) {
    warnings.push({ code: "water_strike_exceeds_depth", field: "waterStrikeFt", message: "Water strike depth exceeds total depth" });
  }
  if (success === false && yieldLpm != null && yieldLpm > 0) {
    warnings.push({ code: "dry_with_positive_yield", field: "yieldLpm", message: "Dry outcome has positive yield" });
  }

  const contextFeatures = {
    rainfallMmAnnual: parseNumber(values.rainfallMmAnnual, "rainfallMmAnnual", errors, { min: 0, max: 20000 }),
    geologyClass: cleanText(values.geologyClass, 160),
    soilType: cleanText(values.soilType, 160),
    elevationM: parseNumber(values.elevationM, "elevationM", errors, { min: -500, max: 9000 }),
    slopeDeg: parseNumber(values.slopeDeg, "slopeDeg", errors, { min: 0, max: 90 }),
    landUseClass: cleanText(values.landUseClass, 160),
    groundwaterLevelM: parseNumber(values.groundwaterLevelM, "groundwaterLevelM", errors, { min: 0, max: 5000 }),
    ndvi: parseNumber(values.ndvi, "ndvi", errors, { min: -1, max: 1 }),
    ndwi: parseNumber(values.ndwi, "ndwi", errors, { min: -1, max: 1 }),
    lineamentDensity: parseNumber(values.lineamentDensity, "lineamentDensity", errors, { min: 0, max: 100000 }),
    drainageDensity: parseNumber(values.drainageDensity, "drainageDensity", errors, { min: 0, max: 100000 }),
  };

  const normalized = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    rowNumber: parsedRow.rowNumber,
    lat: coords.lat,
    lng: coords.lng,
    location: coords.location,
    placeName: cleanText(values.placeName, 120),
    district: cleanText(values.district, 120),
    state: cleanText(values.state, 120),
    depthFt,
    strata: cleanText(values.strata, 160),
    waterStrikeFt,
    yieldLpm,
    success,
    drilledAt: parseDate(values.drilledAt, errors),
    sourceRecordId: cleanText(values.sourceRecordId, 160),
    evidenceUrl: parseEvidenceUrl(values.evidenceUrl, warnings),
    contextFeatures,
    rawRow: parsedRow.raw || {},
    validation: { valid: errors.length === 0, errors, warnings },
  };
  normalized.drilledDate = normalized.drilledAt ? normalized.drilledAt.slice(0, 10) : "";
  normalized.quality = scoreRecordQuality(normalized, source);
  return normalized;
}

const normKey = (value) => cleanText(value, 200).toLowerCase();
export function buildDuplicateFingerprint(record, source) {
  const sourceName = normKey(source?.sourceName);
  const sourceType = normKey(source?.sourceType);
  let signature;
  if (record.sourceRecordId) {
    signature = ["source-id", sourceType, sourceName, normKey(record.sourceRecordId)].join("|");
  } else {
    const latBucket = Number.isFinite(record.lat) ? record.lat.toFixed(4) : "";
    const lngBucket = Number.isFinite(record.lng) ? record.lng.toFixed(4) : "";
    const depthBucket = record.depthFt == null ? "" : String(Math.round(record.depthFt / 5) * 5);
    signature = ["spatial", latBucket, lngBucket, record.drilledDate || "", String(record.success), depthBucket].join("|");
  }
  return createHash("sha256").update(signature).digest("hex");
}

export function withEligibility(record, duplicateOf = null) {
  const blockedByValidation = !record.validation?.valid;
  const blockedByDuplicate = !!duplicateOf;
  const eligible = !blockedByValidation && !blockedByDuplicate && record.quality.score >= QUALITY_THRESHOLD;
  return {
    ...record,
    duplicateOf,
    datasetEligible: eligible,
    eligibilityReasons: [
      ...(blockedByValidation ? ["validation_failed"] : []),
      ...(blockedByDuplicate ? ["duplicate"] : []),
      ...(record.quality.score < QUALITY_THRESHOLD ? ["quality_below_threshold"] : []),
    ],
  };
}

export function initialReviewStatus(record) {
  if (!record.validation?.valid) return "blocked_invalid";
  if (record.duplicateOf) return "blocked_duplicate";
  if (!record.datasetEligible) return "blocked_quality";
  return "pending_review";
}

export function rawArtifactMetadata(csvText, batchId) {
  return {
    objectKey: `ingestion/${batchId}/source.csv`,
    mediaType: "text/csv",
    byteSize: Buffer.byteLength(csvText, "utf8"),
    sha256: createHash("sha256").update(csvText).digest("hex"),
    storageStatus: "metadata_only",
  };
}

export function buildQualityReport(records) {
  const total = records.length;
  const counts = {
    total,
    valid: 0,
    invalid: 0,
    duplicates: 0,
    eligible: 0,
    pendingReview: 0,
    approved: 0,
    rejected: 0,
    published: 0,
  };
  const errorCodes = {};
  const warningCodes = {};
  let qualityTotal = 0;
  for (const record of records) {
    if (record.validation?.valid) counts.valid += 1; else counts.invalid += 1;
    if (record.duplicateOf) counts.duplicates += 1;
    if (record.datasetEligible) counts.eligible += 1;
    if (record.reviewStatus === "pending_review") counts.pendingReview += 1;
    if (record.reviewStatus === "approved") counts.approved += 1;
    if (record.reviewStatus === "rejected") counts.rejected += 1;
    if (record.publishedAt) counts.published += 1;
    qualityTotal += Number(record.quality?.score || 0);
    for (const issue of record.validation?.errors || []) errorCodes[issue.code] = (errorCodes[issue.code] || 0) + 1;
    for (const issue of record.validation?.warnings || []) warningCodes[issue.code] = (warningCodes[issue.code] || 0) + 1;
  }
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    qualityThreshold: QUALITY_THRESHOLD,
    counts,
    averageQualityScore: total ? Math.round((qualityTotal / total) * 10) / 10 : 0,
    errorCodes,
    warningCodes,
  };
}

export function toPublishedBorewell(staged, { verifiedBy, publishedAt }) {
  return {
    id: staged.id,
    schemaVersion: DATASET_SCHEMA_VERSION,
    lat: staged.lat,
    lng: staged.lng,
    location: staged.location,
    placeName: staged.placeName || "",
    district: staged.district || "",
    state: staged.state || "",
    depthFt: staged.depthFt ?? null,
    strata: staged.strata || "",
    waterStrikeFt: staged.waterStrikeFt ?? null,
    yieldLpm: staged.yieldLpm ?? null,
    success: staged.success,
    drilledAt: staged.drilledAt || null,
    drilledDate: staged.drilledDate || "",
    operatorId: null,
    operatorName: "",
    language: "",
    flagged: false,
    flagReason: "",
    verified: true,
    verifiedAt: staged.reviewedAt || publishedAt,
    verifiedBy: staged.reviewedBy || verifiedBy,
    createdAt: publishedAt,
    ingestionBatchId: staged.batchId,
    ingestionFingerprint: staged.fingerprint,
    qualityScore: staged.quality?.score ?? null,
    contextFeatures: staged.contextFeatures || {},
    datasetEligibility: { eligible: true, status: "approved", approvedAt: staged.reviewedAt || publishedAt },
    provenance: staged.provenance,
  };
}
