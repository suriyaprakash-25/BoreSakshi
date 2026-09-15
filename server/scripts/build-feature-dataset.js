// Phase 3 CLI: build a versioned ML-ready feature dataset from real geospatial layers.
// This is intentionally offline/reviewable: it reads approved canonical borewell
// exports plus source layers, verifies checksums, then emits a deterministic JSON artifact.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseAsciiGrid, parseGeoJson, validateLayerManifest } from "../geospatial.js";
import { buildFeatureDataset, serializeFeatureDataset, artifactSha256, featureDatasetSummary, deterministicDatasetDigest } from "../featurePipeline.js";

const args = process.argv.slice(2);
const option = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const arg = args.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
};

const manifestPath = option("manifest");
const targetPath = option("targets");
const outputPath = option("out", "feature-artifacts/feature-dataset.json");
if (!manifestPath || !targetPath) {
  console.error("Usage: node scripts/build-feature-dataset.js --manifest=<manifest.json> --targets=<approved-borewells.json> [--out=<features.json>]");
  process.exit(2);
}

const absManifest = resolve(manifestPath);
const manifestDir = dirname(absManifest);
const manifest = JSON.parse(await readFile(absManifest, "utf8"));
const manifestCheck = validateLayerManifest(manifest);
if (!manifestCheck.valid) {
  console.error("Invalid manifest:\n- " + manifestCheck.errors.join("\n- "));
  process.exit(2);
}

const loadedLayers = [];
for (const layer of manifest.layers) {
  const path = resolve(manifestDir, layer.path);
  const raw = await readFile(path);
  const actualSha = createHash("sha256").update(raw).digest("hex");
  if (actualSha !== layer.sha256.toLowerCase()) {
    throw new Error(`Checksum mismatch for layer '${layer.id}': expected ${layer.sha256}, got ${actualSha}`);
  }
  const text = raw.toString("utf8");
  const data = layer.format === "esri_ascii" ? parseAsciiGrid(text) : parseGeoJson(text);
  loadedLayers.push({ ...layer, sha256: actualSha, data });
}

const targetParsed = JSON.parse(await readFile(resolve(targetPath), "utf8"));
const targets = Array.isArray(targetParsed) ? targetParsed : targetParsed.items;
if (!Array.isArray(targets) || !targets.length) throw new Error("No approved borewell targets found");

const dataset = buildFeatureDataset({
  manifest,
  loadedLayers,
  targets,
  borewells: targets,
  nearbyRadiusKm: Number(option("nearby-radius-km", manifest.parameters?.nearbyRadiusKm ?? 5)),
  densityRadiusKm: Number(option("density-radius-km", manifest.parameters?.densityRadiusKm ?? 2)),
  spatialBlockDeg: Number(option("spatial-block-deg", manifest.parameters?.spatialBlockDeg ?? 0.1)),
});
const serialized = serializeFeatureDataset(dataset);
const out = resolve(outputPath);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, serialized, "utf8");

const summary = {
  ...featureDatasetSummary(dataset),
  deterministicDigest: deterministicDatasetDigest(dataset),
  artifact: {
    objectKey: outputPath.replace(/\\/g, "/"),
    mediaType: "application/json",
    byteSize: Buffer.byteLength(serialized),
    sha256: artifactSha256(serialized),
  },
};
console.log(JSON.stringify(summary, null, 2));
if (dataset.report.rowsSkipped > 0) process.exitCode = 1;
