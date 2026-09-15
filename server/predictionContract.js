export const PREDICTION_CONTRACT_VERSION = "1.0.0";

export class PredictionContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "PredictionContractError";
    this.code = "ML_CONTRACT_INVALID";
  }
}

const finite = (value, field) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new PredictionContractError(`${field} must be finite`);
  return value;
};

export function assertMlPredictionContract(result) {
  const required = [
    "successProbability", "estimatedDepthFt", "estimatedYieldLpm", "confidence",
    "modelVersion", "featureVersion", "predictionTimestamp", "predictionContractVersion",
    "featureSnapshotRef", "featureSnapshot", "explanations", "uncertainty",
    "featureCoverage", "coverageWarning", "predictionSource", "isMock",
  ];
  const missing = required.filter((key) => !(key in (result || {})));
  if (missing.length) throw new PredictionContractError(`missing fields: ${missing.join(", ")}`);

  const probability = finite(result.successProbability, "successProbability");
  if (probability < 0 || probability > 100) throw new PredictionContractError("successProbability must be 0..100");
  if (!["Low", "Medium", "High"].includes(result.confidence)) throw new PredictionContractError("invalid confidence");
  for (const key of ["modelVersion", "featureVersion", "predictionTimestamp", "featureSnapshotRef"]) {
    if (typeof result[key] !== "string" || !result[key].trim()) throw new PredictionContractError(`${key} is required`);
  }
  if (result.predictionContractVersion !== PREDICTION_CONTRACT_VERSION) throw new PredictionContractError("unsupported prediction contract version");
  if (result.predictionSource !== "ml" || result.isMock !== false) throw new PredictionContractError("real prediction must be predictionSource=ml and isMock=false");
  if (!Array.isArray(result.explanations)) throw new PredictionContractError("explanations must be an array");
  if (!result.uncertainty || typeof result.uncertainty !== "object") throw new PredictionContractError("uncertainty must be an object");
  if (!result.featureCoverage || typeof result.featureCoverage !== "object") throw new PredictionContractError("featureCoverage must be an object");
  const coverage = finite(result.featureCoverage.coveragePct, "featureCoverage.coveragePct");
  if (coverage < 0 || coverage > 100) throw new PredictionContractError("feature coverage must be 0..100");

  for (const key of ["estimatedDepthFt", "estimatedYieldLpm"]) {
    const group = result[key];
    if (!group || typeof group !== "object") throw new PredictionContractError(`${key} must be an object`);
    const estimate = finite(group.estimate, `${key}.estimate`);
    const min = finite(group.min, `${key}.min`);
    const max = finite(group.max, `${key}.max`);
    if (min < 0 || min > estimate || estimate > max) throw new PredictionContractError(`${key} must satisfy 0 <= min <= estimate <= max`);
  }

  const snapshot = result.featureSnapshot;
  if (!snapshot || typeof snapshot !== "object" || snapshot.ref !== result.featureSnapshotRef) {
    throw new PredictionContractError("feature snapshot reference mismatch");
  }
  if (snapshot.featureVersion !== result.featureVersion || snapshot.predictionAsOf !== result.predictionTimestamp) {
    throw new PredictionContractError("feature snapshot/version/timestamp mismatch");
  }
  if (typeof snapshot.featureManifestSha256 !== "string" || snapshot.featureManifestSha256.length !== 64) {
    throw new PredictionContractError("invalid feature manifest checksum");
  }
  return result;
}
