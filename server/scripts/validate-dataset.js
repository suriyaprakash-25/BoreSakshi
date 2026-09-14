// Offline Phase 2 CSV preflight/cleaning utility.
// It never connects to MongoDB. Server-side ingestion remains authoritative for
// duplicate detection against existing/staged records and for human review.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseBorewellCsv,
  normalizeBorewellRow,
  buildDuplicateFingerprint,
  withEligibility,
  initialReviewStatus,
  buildQualityReport,
} from "../ingestion.js";

const args = process.argv.slice(2);
const input = args.find((arg) => !arg.startsWith("--"));
if (!input) {
  console.error("Usage: node scripts/validate-dataset.js <file.csv> [--source-type=government] [--source-name=Name] [--source-reference=Ref] [--clean-out=cleaned.json] [--report-out=quality-report.json]");
  process.exit(2);
}

const option = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const source = {
  sourceType: option("source-type", "historical"),
  sourceName: option("source-name", "Offline dataset preflight"),
  sourceReference: option("source-reference", ""),
};
const csv = await readFile(resolve(input), "utf8");
const parsed = parseBorewellCsv(csv);
const seen = new Map();
const rows = parsed.map((parsedRow) => {
  const normalized = normalizeBorewellRow(parsedRow, source);
  const fingerprint = buildDuplicateFingerprint(normalized, source);
  const duplicateOf = normalized.validation.valid ? seen.get(fingerprint) || null : null;
  if (normalized.validation.valid && !seen.has(fingerprint)) seen.set(fingerprint, `row:${parsedRow.rowNumber}`);
  const eligible = withEligibility(normalized, duplicateOf);
  return { ...eligible, fingerprint, reviewStatus: initialReviewStatus(eligible) };
});

const report = buildQualityReport(rows);
console.log(JSON.stringify(report, null, 2));

const cleanOut = option("clean-out");
if (cleanOut) {
  const cleaned = rows
    .filter((row) => row.validation.valid && !row.duplicateOf)
    .map(({ rawRow, ...row }) => row);
  await writeFile(resolve(cleanOut), `${JSON.stringify(cleaned, null, 2)}\n`, "utf8");
}
const reportOut = option("report-out");
if (reportOut) await writeFile(resolve(reportOut), `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.counts.invalid > 0 || report.counts.duplicates > 0) process.exitCode = 1;
