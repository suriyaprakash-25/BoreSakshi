from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PREDICTION_CONTRACT_VERSION = "1.0.0"
PHASE7_REPORT_SCHEMA_VERSION = "1.0.0"


class PredictionContractError(ValueError):
    pass


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def feature_snapshot_metadata(bundle: Any, prediction_timestamp: str) -> dict[str, Any]:
    """Build a deterministic reference to the exact serving-time feature snapshot.

    Phase 3/6 source manifests are immutable-by-checksum. Dynamic layers are selected
    deterministically from the prediction timestamp, so the manifest SHA + timestamp
    + feature version uniquely identifies the source snapshot used for re-extraction.
    """
    extractor = bundle.feature_extractor
    payload = {
        "datasetVersion": extractor.dataset_version,
        "featureVersion": bundle.feature_version,
        "featureManifestSha256": extractor.manifest_sha256,
        "predictionAsOf": prediction_timestamp,
    }
    return {
        **payload,
        "ref": f"fsnap:{_sha256_text(_canonical_json(payload))}",
    }


def attach_prediction_metadata(bundle: Any, prediction: dict[str, Any]) -> dict[str, Any]:
    timestamp = str(prediction.get("predictionTimestamp") or "").strip()
    if not timestamp:
        raise PredictionContractError("predictionTimestamp is required before Phase 7 metadata can be attached")
    snapshot = feature_snapshot_metadata(bundle, timestamp)
    enriched = dict(prediction)
    enriched["predictionContractVersion"] = PREDICTION_CONTRACT_VERSION
    enriched["featureSnapshotRef"] = snapshot["ref"]
    enriched["featureSnapshot"] = snapshot
    return enriched


def _finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PredictionContractError(f"{field} must be numeric")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise PredictionContractError(f"{field} must be finite")
    return number


def validate_ml_prediction_contract(prediction: dict[str, Any]) -> dict[str, Any]:
    required = (
        "successProbability",
        "estimatedDepthFt",
        "estimatedYieldLpm",
        "confidence",
        "modelVersion",
        "featureVersion",
        "predictionTimestamp",
        "predictionContractVersion",
        "featureSnapshotRef",
        "featureSnapshot",
        "explanations",
        "uncertainty",
        "featureCoverage",
        "coverageWarning",
        "predictionSource",
        "isMock",
    )
    missing = [field for field in required if field not in prediction]
    if missing:
        raise PredictionContractError(f"missing Phase 7 prediction fields: {', '.join(missing)}")

    probability = _finite_number(prediction["successProbability"], "successProbability")
    if not 0 <= probability <= 100:
        raise PredictionContractError("successProbability must be between 0 and 100")

    for group_name in ("estimatedDepthFt", "estimatedYieldLpm"):
        group = prediction.get(group_name)
        if not isinstance(group, dict):
            raise PredictionContractError(f"{group_name} must be an object")
        estimate = _finite_number(group.get("estimate"), f"{group_name}.estimate")
        low = _finite_number(group.get("min"), f"{group_name}.min")
        high = _finite_number(group.get("max"), f"{group_name}.max")
        if min(estimate, low, high) < 0 or low > estimate or estimate > high:
            raise PredictionContractError(f"{group_name} must satisfy 0 <= min <= estimate <= max")

    if prediction["confidence"] not in {"Low", "Medium", "High"}:
        raise PredictionContractError("confidence must be Low, Medium, or High")
    for field in ("modelVersion", "featureVersion", "predictionTimestamp", "featureSnapshotRef"):
        if not isinstance(prediction.get(field), str) or not prediction[field].strip():
            raise PredictionContractError(f"{field} must be a non-empty string")
    if prediction["predictionContractVersion"] != PREDICTION_CONTRACT_VERSION:
        raise PredictionContractError("unsupported predictionContractVersion")
    if prediction["predictionSource"] != "ml" or prediction["isMock"] is not False:
        raise PredictionContractError("real-model prediction must use predictionSource=ml and isMock=false")
    if not isinstance(prediction["explanations"], list):
        raise PredictionContractError("explanations must be an array")
    if not isinstance(prediction["uncertainty"], dict):
        raise PredictionContractError("uncertainty must be an object")
    if not isinstance(prediction["featureCoverage"], dict):
        raise PredictionContractError("featureCoverage must be an object")
    coverage = _finite_number(prediction["featureCoverage"].get("coveragePct"), "featureCoverage.coveragePct")
    if not 0 <= coverage <= 100:
        raise PredictionContractError("featureCoverage.coveragePct must be between 0 and 100")

    snapshot = prediction["featureSnapshot"]
    if not isinstance(snapshot, dict) or snapshot.get("ref") != prediction["featureSnapshotRef"]:
        raise PredictionContractError("featureSnapshot.ref must match featureSnapshotRef")
    for field in ("datasetVersion", "featureVersion", "featureManifestSha256", "predictionAsOf"):
        if not isinstance(snapshot.get(field), str) or not snapshot[field].strip():
            raise PredictionContractError(f"featureSnapshot.{field} is required")
    if snapshot["featureVersion"] != prediction["featureVersion"]:
        raise PredictionContractError("feature snapshot/version mismatch")
    if snapshot["predictionAsOf"] != prediction["predictionTimestamp"]:
        raise PredictionContractError("feature snapshot timestamp mismatch")
    if len(snapshot["featureManifestSha256"]) != 64:
        raise PredictionContractError("feature snapshot manifest SHA-256 is invalid")

    return prediction


def build_activation_report(bundle: Any, prediction: dict[str, Any], activation_id: str) -> dict[str, Any]:
    validate_ml_prediction_contract(prediction)
    info = bundle.model_info()
    if not info.get("ready"):
        raise PredictionContractError("model bundle is not ready")
    if info.get("modelVersion") != prediction.get("modelVersion"):
        raise PredictionContractError("activation smoke prediction modelVersion does not match loaded bundle")
    if info.get("featureVersion") != prediction.get("featureVersion"):
        raise PredictionContractError("activation smoke prediction featureVersion does not match loaded bundle")

    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "schemaVersion": PHASE7_REPORT_SCHEMA_VERSION,
        "phase": 7,
        "activationId": activation_id,
        "createdAt": created_at,
        "status": "ready_for_human_activation_review",
        "productionActivated": False,
        "predictionContractVersion": PREDICTION_CONTRACT_VERSION,
        "modelVersion": info["modelVersion"],
        "featureVersion": info["featureVersion"],
        "featureSnapshotRef": prediction["featureSnapshotRef"],
        "artifactChain": {
            "phase4RunId": info.get("phase4RunId"),
            "phase5EvaluationId": info.get("phase5EvaluationId"),
            "trainingDataset": info.get("trainingDataset"),
            "phase4ManifestSha256": info.get("phase4ManifestSha256"),
            "phase5EvaluationManifestSha256": info.get("phase5EvaluationManifestSha256"),
            "featureManifestSha256": info.get("featureManifestSha256"),
            "selectedModels": info.get("selectedModels"),
        },
        "smokePrediction": {
            "successProbability": prediction["successProbability"],
            "estimatedDepthFt": prediction["estimatedDepthFt"],
            "estimatedYieldLpm": prediction["estimatedYieldLpm"],
            "confidence": prediction["confidence"],
            "featureCoverage": prediction["featureCoverage"],
            "coverageWarning": prediction["coverageWarning"],
            "predictionTimestamp": prediction["predictionTimestamp"],
        },
        "reviewGate": {
            "humanApprovalRequired": True,
            "approvalEnv": "BORESAKSHI_PHASE6_APPROVED=YES",
            "note": "This report proves the configured bundle can produce a contract-valid real-model prediction. It does not itself deploy or enable farmer traffic.",
        },
    }


def write_checksummed_report(report: dict[str, Any], output_dir: str | Path) -> tuple[Path, Path]:
    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    report_path = target_dir / "phase7-activation-report.json"
    text = json.dumps(report, indent=2, sort_keys=True) + "\n"
    report_path.write_text(text, encoding="utf-8")
    checksum = _sha256_text(text)
    checksum_path = target_dir / "phase7-activation-report.sha256"
    checksum_path.write_text(f"{checksum}  {report_path.name}\n", encoding="utf-8")
    return report_path, checksum_path
