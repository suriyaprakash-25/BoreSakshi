import test from "node:test";
import assert from "node:assert/strict";
import {
  CsvImportError,
  DATASET_SCHEMA_VERSION,
  QUALITY_THRESHOLD,
  parseCsvRows,
  parseBorewellCsv,
  normalizeBorewellRow,
  buildDuplicateFingerprint,
  withEligibility,
  initialReviewStatus,
  buildQualityReport,
  toPublishedBorewell,
} from "../ingestion.js";

const source = { sourceType: "government", sourceName: "TN Groundwater", sourceReference: "dataset-2026" };

test("CSV parser handles quoted commas and escaped quotes", () => {
  const rows = parseCsvRows('lat,lng,success,place_name\n11.36,77.80,yes,"A, ""North"""\n');
  assert.equal(rows[1][3], 'A, "North"');
});

test("CSV requires lat, lng and success headers", () => {
  assert.throws(() => parseBorewellCsv("lat,lng\n11,77\n"), (err) => err instanceof CsvImportError && err.code === "csv_missing_required_header");
});

test("header aliases normalize canonical fields", () => {
  const [row] = parseBorewellCsv("latitude,longitude,outcome,total_depth_m,yield_lps\n11.36,77.8,wet,100,2\n");
  const normalized = normalizeBorewellRow(row, source);
  assert.equal(normalized.schemaVersion, DATASET_SCHEMA_VERSION);
  assert.equal(normalized.success, true);
  assert.equal(normalized.depthFt, 328.084);
  assert.equal(normalized.yieldLpm, 120);
});

test("coordinates are swapped only when the numeric ranges clearly imply it", () => {
  const [row] = parseBorewellCsv("lat,lng,success\n120,11.36,yes\n");
  const normalized = normalizeBorewellRow(row, source);
  assert.equal(normalized.lat, 11.36);
  assert.equal(normalized.lng, 120);
  assert.ok(normalized.validation.warnings.some((w) => w.code === "coordinates_swapped"));
});

test("invalid coordinates block eligibility", () => {
  const [row] = parseBorewellCsv("lat,lng,success\n95,190,yes\n");
  const normalized = withEligibility(normalizeBorewellRow(row, source));
  assert.equal(normalized.validation.valid, false);
  assert.equal(normalized.datasetEligible, false);
  assert.equal(initialReviewStatus(normalized), "blocked_invalid");
});

test("DD/MM/YYYY dates are normalized deterministically", () => {
  const [row] = parseBorewellCsv("lat,lng,success,drilled_date\n11,77,yes,15/09/2026\n");
  const normalized = normalizeBorewellRow(row, source);
  assert.equal(normalized.drilledDate, "2026-09-15");
});

test("source record IDs make duplicate fingerprints stable", () => {
  const [row] = parseBorewellCsv("lat,lng,success,source_record_id\n11,77,yes,ABC-1\n");
  const normalized = normalizeBorewellRow(row, source);
  assert.equal(buildDuplicateFingerprint(normalized, source), buildDuplicateFingerprint({ ...normalized, lat: 12 }, source));
});

test("duplicate rows are never dataset eligible", () => {
  const [row] = parseBorewellCsv("lat,lng,success,depth_ft,yield_lpm,drilled_date,source_record_id,place_name,strata\n11,77,yes,300,40,2026-09-10,A1,Village,Granite\n");
  const normalized = normalizeBorewellRow(row, source);
  assert.ok(normalized.quality.score >= QUALITY_THRESHOLD);
  const staged = withEligibility(normalized, "existing-1");
  assert.equal(staged.datasetEligible, false);
  assert.equal(initialReviewStatus(staged), "blocked_duplicate");
});

test("high quality valid records enter pending review, not live data", () => {
  const [row] = parseBorewellCsv("lat,lng,success,depth_ft,yield_lpm,drilled_date,source_record_id,place_name,strata\n11,77,yes,300,40,2026-09-10,A1,Village,Granite\n");
  const staged = withEligibility(normalizeBorewellRow(row, source));
  assert.equal(staged.datasetEligible, true);
  assert.equal(initialReviewStatus(staged), "pending_review");
});

test("quality report aggregates errors, warnings and workflow counts", () => {
  const goodRow = parseBorewellCsv("lat,lng,success,depth_ft,yield_lpm,drilled_date,source_record_id,place_name,strata\n11,77,yes,300,40,2026-09-10,A1,Village,Granite\n")[0];
  const badRow = parseBorewellCsv("lat,lng,success\n190,100,maybe\n")[0];
  const good = { ...withEligibility(normalizeBorewellRow(goodRow, source)), reviewStatus: "pending_review" };
  const bad = { ...withEligibility(normalizeBorewellRow(badRow, source)), reviewStatus: "blocked_invalid" };
  const report = buildQualityReport([good, bad]);
  assert.equal(report.counts.total, 2);
  assert.equal(report.counts.valid, 1);
  assert.equal(report.counts.invalid, 1);
  assert.equal(report.counts.pendingReview, 1);
  assert.ok(report.errorCodes.lat_out_of_range >= 1);
});

test("published canonical records preserve provenance and eligibility", () => {
  const staged = {
    id: "row-1", batchId: "batch-1", lat: 11, lng: 77,
    location: { type: "Point", coordinates: [77, 11] },
    placeName: "Village", district: "Namakkal", state: "Tamil Nadu",
    depthFt: 300, strata: "Granite", waterStrikeFt: 220, yieldLpm: 40,
    success: true, drilledAt: "2026-09-10T00:00:00.000Z", drilledDate: "2026-09-10",
    fingerprint: "abc", quality: { score: 95 }, provenance: { sourceType: "government" },
    reviewedAt: "2026-09-15T00:00:00.000Z", reviewedBy: "admin-1",
  };
  const published = toPublishedBorewell(staged, { verifiedBy: "admin-1", publishedAt: "2026-09-15T01:00:00.000Z" });
  assert.equal(published.verified, true);
  assert.equal(published.datasetEligibility.eligible, true);
  assert.equal(published.ingestionBatchId, "batch-1");
});

test("contextual ML features from rainfall/geology/soil/DEM/LULC/groundwater/satellite columns are normalized", () => {
  const [row] = parseBorewellCsv("lat,lng,success,rainfall_mm,geology,soil_type,elevation_m,slope_deg,lulc,groundwater_level_m,ndvi,ndwi\n11,77,yes,850,Granite,Red Soil,210,4.5,Cropland,18,0.42,0.12\n");
  const normalized = normalizeBorewellRow(row, source);
  assert.equal(normalized.contextFeatures.rainfallMmAnnual, 850);
  assert.equal(normalized.contextFeatures.geologyClass, "Granite");
  assert.equal(normalized.contextFeatures.soilType, "Red Soil");
  assert.equal(normalized.contextFeatures.elevationM, 210);
  assert.equal(normalized.contextFeatures.landUseClass, "Cropland");
  assert.equal(normalized.contextFeatures.ndvi, 0.42);
});
