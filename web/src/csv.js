// csv.js — client-side CSV export (no dependency). Used by the global admin log
// list and an individual operator's log list.
import { placeLabel } from "./metrics.js";

const COLUMNS = [
  ["Date", (l) => new Date(l.createdAt).toISOString()],
  ["Operator", (l) => l.operatorName || ""],
  ["Operator ID", (l) => l.operatorId || ""],
  ["Location", (l) => l.placeName || placeLabel(l)],
  ["Latitude", (l) => l.lat],
  ["Longitude", (l) => l.lng],
  ["Outcome", (l) => (l.success ? "Water found" : "Dry hole")],
  ["Total depth (ft)", (l) => (l.depthFt ?? "")],
  ["Water strike (ft)", (l) => (l.waterStrikeFt ?? "")],
  ["Yield (LPM)", (l) => (l.yieldLpm ?? "")],
  ["Strata", (l) => l.strata || ""],
  ["Flagged", (l) => (l.flagged ? "yes" : "no")],
  ["Flag reason", (l) => l.flagReason || ""],
  ["Verified", (l) => (l.verified ? "yes" : "no")],
];

// wrap every field in quotes and double any internal quotes (RFC-4180 safe)
const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function toCSV(logs) {
  const header = COLUMNS.map((c) => cell(c[0])).join(",");
  const rows = logs.map((l) => COLUMNS.map((c) => cell(c[1](l))).join(","));
  return [header, ...rows].join("\r\n");
}

export function downloadCSV(filename, logs) {
  const blob = new Blob(["﻿" + toCSV(logs)], { type: "text/csv;charset=utf-8;" }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
