from __future__ import annotations

import hashlib
import json
import math
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from .inference import load_candidate, predict_candidate
from .live_features import FeatureExtractor
from .schema import ALL_FEATURES, MODEL_SCHEMA_VERSION


class ServingBundleError(RuntimeError):
    pass


class CoverageError(RuntimeError):
    def __init__(self, message: str, coverage: dict[str, Any]):
        super().__init__(message)
        self.coverage = coverage


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_sidecar(document_path: Path, sidecar_path: Path) -> str:
    if not document_path.exists() or not sidecar_path.exists():
        raise ServingBundleError(f"missing checksummed artifact: {document_path}")
    expected = sidecar_path.read_text(encoding="utf-8").strip().split()[0].lower()
    actual = _sha256_file(document_path)
    if not expected or expected != actual:
        raise ServingBundleError(f"checksum mismatch: {document_path}")
    return actual


def _verify_artifact(path: Path, metadata: dict[str, Any]) -> None:
    if not path.exists():
        raise ServingBundleError(f"artifact missing: {path}")
    expected = str(metadata.get("sha256") or "").lower()
    if not expected or _sha256_file(path) != expected:
        raise ServingBundleError(f"artifact checksum mismatch: {path}")


def _logit(probability: float) -> np.ndarray:
    p = min(1 - 1e-6, max(1e-6, float(probability)))
    return np.asarray([[math.log(p / (1 - p))]], dtype=float)


def _entropy(probability: float) -> float:
    p = min(1 - 1e-12, max(1e-12, float(probability)))
    return float(-(p * math.log(p) + (1 - p) * math.log(1 - p)) / math.log(2))


FEATURE_LABELS = {
    "terrainElevationM": "Elevation",
    "terrainSlopeDeg": "Terrain slope",
    "terrainAspectDeg": "Terrain aspect",
    "terrainCurvature": "Terrain curvature",
    "hydrologyDistanceToDrainageM": "Distance to drainage",
    "hydrologyDrainageDensityKmPerKm2": "Drainage density",
    "hydrologyWatershedId": "Watershed",
    "hydrologyFlowAccumulation": "Flow accumulation",
    "geologyFormation": "Geological formation",
    "geologyLithology": "Lithology",
    "geologyLineamentDensityKmPerKm2": "Lineament density",
    "geologyDistanceToLineamentM": "Distance to lineament",
    "geologyFractureProximityScore": "Fracture proximity",
    "climateAnnualRainfallMm": "Annual rainfall",
    "climateSeasonalRainfallMm": "Seasonal rainfall",
    "climateRecentRainfallMm": "Recent rainfall",
    "climateRainfallAnomalyPct": "Rainfall anomaly",
    "satelliteNdvi": "Vegetation index (NDVI)",
    "satelliteNdwi": "Water index (NDWI)",
    "satelliteLandUseClass": "Land-use class",
    "nearbyNearestDistanceKm": "Nearest verified well",
    "nearbyCount": "Nearby verified-well count",
    "nearbySuccessRate": "Nearby success rate",
    "nearbyFailureRate": "Nearby failure rate",
    "nearbyAverageDepthFt": "Nearby average depth",
    "nearbyAverageYieldLpm": "Nearby average yield",
}


@dataclass(frozen=True)
class LoadedTask:
    name: str
    candidate: str
    algorithm: str
    model: Any
    source_artifact: dict[str, Any]
    auxiliary: dict[str, Any]


class ServingBundle:
    def __init__(
        self,
        *,
        phase4_run_dir: str | Path,
        phase5_evaluation_dir: str | Path,
        feature_manifest_path: str | Path,
        approved: bool,
        min_feature_coverage_pct: float = 60.0,
        warning_feature_coverage_pct: float = 80.0,
    ):
        if not approved:
            raise ServingBundleError("Phase 6 serving approval is not enabled")
        self.phase4_run_dir = Path(phase4_run_dir).resolve()
        self.phase5_evaluation_dir = Path(phase5_evaluation_dir).resolve()
        self.min_feature_coverage_pct = float(min_feature_coverage_pct)
        self.warning_feature_coverage_pct = max(self.min_feature_coverage_pct, float(warning_feature_coverage_pct))

        phase4_manifest_path = self.phase4_run_dir / "run-manifest.json"
        phase4_sha = _verify_sidecar(phase4_manifest_path, self.phase4_run_dir / "run-manifest.sha256")
        self.phase4 = json.loads(phase4_manifest_path.read_text(encoding="utf-8"))
        if self.phase4.get("modelSchemaVersion") != MODEL_SCHEMA_VERSION:
            raise ServingBundleError("unsupported Phase 4 model schema version")

        evaluation_path = self.phase5_evaluation_dir / "evaluation-manifest.json"
        evaluation_sha = _verify_sidecar(evaluation_path, self.phase5_evaluation_dir / "evaluation-manifest.sha256")
        self.evaluation = json.loads(evaluation_path.read_text(encoding="utf-8"))
        if self.evaluation.get("phase4RunId") != self.phase4.get("runId"):
            raise ServingBundleError("Phase 5 evaluation does not reference this Phase 4 run")
        if self.evaluation.get("trainingDataset", {}).get("datasetHash") != self.phase4.get("trainingDataset", {}).get("datasetHash"):
            raise ServingBundleError("Phase 4/5 dataset hash mismatch")
        if self.evaluation.get("blockedTasks"):
            raise ServingBundleError("Phase 5 evaluation contains blocked tasks")
        if self.evaluation.get("phaseBoundary", {}).get("scientificEvaluationComplete") is not True:
            raise ServingBundleError("Phase 5 scientific evaluation is incomplete")

        self.feature_extractor = FeatureExtractor(feature_manifest_path)
        training_version = self.phase4.get("trainingDataset", {}).get("datasetVersion")
        if training_version and training_version != self.feature_extractor.dataset_version:
            raise ServingBundleError(
                f"live feature datasetVersion {self.feature_extractor.dataset_version!r} does not match model training datasetVersion {training_version!r}"
            )

        self.phase4_manifest_sha256 = phase4_sha
        self.evaluation_manifest_sha256 = evaluation_sha
        self.tasks = {task: self._load_task(task) for task in ("success", "depth", "yield")}
        self.model_version = f"{self.phase4['runId']}@{self.evaluation['evaluationId']}"
        self.feature_version = self.feature_extractor.feature_version

    def _candidate_report(self, task: str, candidate_name: str) -> dict[str, Any]:
        candidates = self.evaluation["tasks"][task].get("candidates", [])
        try:
            return next(candidate for candidate in candidates if candidate.get("candidate") == candidate_name)
        except StopIteration as exc:
            raise ServingBundleError(f"selected {task} candidate is missing from Phase 5 report") from exc

    def _resolve_evaluation_artifact(self, task: str, metadata: dict[str, Any]) -> Path:
        raw_path = str(metadata.get("path") or "")
        direct = self.phase5_evaluation_dir / raw_path
        if direct.exists():
            return direct
        # Phase 5 v1 interval metadata used the basename while writing the file
        # under selected/<task>/. Keep serving backward-compatible with that
        # checksummed artifact contract rather than mutating historical reports.
        fallback = self.phase5_evaluation_dir / "selected" / task / raw_path
        if fallback.exists():
            return fallback
        return direct

    def _load_task(self, task: str) -> LoadedTask:
        task_eval = self.evaluation.get("tasks", {}).get(task) or {}
        selection = task_eval.get("selection") or {}
        candidate_name = selection.get("selectedCandidate")
        if not candidate_name:
            raise ServingBundleError(f"Phase 5 did not select a {task} candidate")
        candidate = self._candidate_report(task, candidate_name)
        source_artifact = candidate.get("sourceArtifact") or {}
        model_path = self.phase4_run_dir.parent / str(source_artifact.get("path") or "")
        _verify_artifact(model_path, source_artifact)
        model = load_candidate(model_path)

        selected_aux = task_eval.get("selectedAuxiliaryArtifacts") or {}
        auxiliary: dict[str, Any] = {}
        if task == "success":
            calibration = selected_aux.get("calibration") or {}
            artifact = calibration.get("artifact") or {}
            path = self._resolve_evaluation_artifact(task, artifact)
            _verify_artifact(path, artifact)
            auxiliary = {"calibration": calibration, "calibrator": joblib.load(path)}
        else:
            uncertainty = selected_aux.get("uncertainty") or {}
            artifact = uncertainty.get("artifact") or {}
            path = self._resolve_evaluation_artifact(task, artifact)
            _verify_artifact(path, artifact)
            interval = json.loads(path.read_text(encoding="utf-8"))
            auxiliary = {"uncertainty": uncertainty, "interval": interval}
        return LoadedTask(
            name=task,
            candidate=candidate_name,
            algorithm=str(candidate.get("algorithm") or selection.get("algorithm") or ""),
            model=model,
            source_artifact=source_artifact,
            auxiliary=auxiliary,
        )

    def _calibrated_success(self, features: dict[str, Any]) -> tuple[float, float]:
        task = self.tasks["success"]
        raw = float(predict_candidate(task.model, "success", features)["successProbability"])
        calibrator = task.auxiliary["calibrator"]
        calibrated = float(calibrator.predict_proba(_logit(raw))[0][1])
        return raw, calibrated

    def _local_explanations(self, features: dict[str, Any], calibrated_probability: float, limit: int = 6) -> list[dict[str, Any]]:
        explanations: list[dict[str, Any]] = []
        for feature_name in ALL_FEATURES:
            if features.get(feature_name) is None:
                continue
            ablated = deepcopy(features)
            ablated[feature_name] = None
            try:
                _, ablated_probability = self._calibrated_success(ablated)
            except Exception:
                continue
            impact = round((calibrated_probability - ablated_probability) * 100, 1)
            explanations.append({
                "feature": feature_name,
                "label": FEATURE_LABELS.get(feature_name, feature_name),
                "impact": impact,
                "method": "single_feature_ablation_to_pipeline_imputation",
            })
        explanations.sort(key=lambda item: abs(item["impact"]), reverse=True)
        return explanations[:limit]

    def predict(self, *, lat: float, lng: float, nearby_borewells: list[dict[str, Any]], prediction_time: datetime | None = None) -> dict[str, Any]:
        prediction_time = (prediction_time or datetime.now(timezone.utc)).astimezone(timezone.utc)
        extracted = self.feature_extractor.extract(lat, lng, nearby_borewells, as_of=prediction_time)
        coverage = extracted["coverage"]
        if coverage["coveragePct"] < self.min_feature_coverage_pct:
            raise CoverageError(
                f"feature coverage {coverage['coveragePct']}% is below the serving minimum {self.min_feature_coverage_pct}%",
                coverage,
            )
        features = extracted["features"]
        raw_probability, calibrated_probability = self._calibrated_success(features)

        depth_value = max(0.0, float(predict_candidate(self.tasks["depth"].model, "depth", features)["estimatedWaterStrikeFt"]))
        yield_value = max(0.0, float(predict_candidate(self.tasks["yield"].model, "yield", features)["estimatedYieldLpm"]))
        depth_interval = self.tasks["depth"].auxiliary["interval"]
        yield_interval = self.tasks["yield"].auxiliary["interval"]
        depth_radius = max(0.0, float(depth_interval["radius"]))
        yield_radius = max(0.0, float(yield_interval["radius"]))

        max_class_probability = max(calibrated_probability, 1 - calibrated_probability)
        normalized_entropy = _entropy(calibrated_probability)
        if max_class_probability >= 0.80 and coverage["coveragePct"] >= 80:
            confidence = "High"
        elif max_class_probability >= 0.65 and coverage["coveragePct"] >= 65:
            confidence = "Medium"
        else:
            confidence = "Low"

        coverage_warning = None
        if coverage["coveragePct"] < self.warning_feature_coverage_pct:
            coverage_warning = (
                f"Model feature coverage is {coverage['coveragePct']}%; missing: "
                + ", ".join(coverage["missingFeatures"][:8])
                + ("…" if len(coverage["missingFeatures"]) > 8 else "")
            )

        geology = features.get("geologyLithology") or features.get("geologyFormation") or "Geospatial model context"
        explanations = self._local_explanations(features, calibrated_probability)
        return {
            "successProbability": round(calibrated_probability * 100, 1),
            "estimatedDepthFt": {
                "estimate": round(depth_value, 1),
                "min": round(max(0.0, depth_value - depth_radius), 1),
                "max": round(depth_value + depth_radius, 1),
            },
            "estimatedYieldLpm": {
                "estimate": round(yield_value, 1),
                "min": round(max(0.0, yield_value - yield_radius), 1),
                "max": round(yield_value + yield_radius, 1),
            },
            "confidence": confidence,
            "modelVersion": self.model_version,
            "featureVersion": self.feature_version,
            "explanations": explanations,
            "uncertainty": {
                "success": {
                    "rawProbability": raw_probability,
                    "calibratedProbability": calibrated_probability,
                    "normalizedEntropy": normalized_entropy,
                    "maxClassProbability": max_class_probability,
                },
                "depth": {
                    "method": depth_interval.get("method"),
                    "targetCoverage": depth_interval.get("targetCoverage"),
                    "radiusFt": depth_radius,
                },
                "yield": {
                    "method": yield_interval.get("method"),
                    "targetCoverage": yield_interval.get("targetCoverage"),
                    "radiusLpm": yield_radius,
                },
                "featureCoveragePct": coverage["coveragePct"],
            },
            "featureCoverage": coverage,
            "coverageWarning": coverage_warning,
            "geologySummary": str(geology),
            "nearbySummary": extracted["nearbySummary"],
            "predictionTimestamp": prediction_time.isoformat().replace("+00:00", "Z"),
            "predictionSource": "ml",
            "isMock": False,
        }

    def model_info(self) -> dict[str, Any]:
        return {
            "ready": True,
            "modelVersion": self.model_version,
            "featureVersion": self.feature_version,
            "phase4RunId": self.phase4["runId"],
            "phase5EvaluationId": self.evaluation["evaluationId"],
            "trainingDataset": self.phase4.get("trainingDataset"),
            "phase4ManifestSha256": self.phase4_manifest_sha256,
            "phase5EvaluationManifestSha256": self.evaluation_manifest_sha256,
            "featureManifestSha256": self.feature_extractor.manifest_sha256,
            "selectedModels": {
                task: {
                    "candidate": loaded.candidate,
                    "algorithm": loaded.algorithm,
                    "artifactSha256": loaded.source_artifact.get("sha256"),
                }
                for task, loaded in self.tasks.items()
            },
            "servingPolicy": {
                "approved": True,
                "minimumFeatureCoveragePct": self.min_feature_coverage_pct,
                "coverageWarningBelowPct": self.warning_feature_coverage_pct,
                "fallbackOwner": "Node API",
            },
        }
