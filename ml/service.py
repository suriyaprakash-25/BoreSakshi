from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from boresakshi_ml.continuous import ContinuousLearningError, load_runtime_deployment
from boresakshi_ml.phase7 import attach_prediction_metadata, validate_ml_prediction_contract
from boresakshi_ml.serving import CoverageError, ServingBundle, ServingBundleError


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("boresakshi.ml")


class NearbyBorewell(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = None
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    success: bool | None = None
    depthFt: float | None = None
    yieldLpm: float | None = None
    drilledAt: str | None = None
    createdAt: str | None = None
    verified: bool = False
    flagged: bool = False
    datasetEligibility: dict[str, Any] | None = None


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    nearbyBorewells: list[NearbyBorewell] = Field(default_factory=list, max_length=500)
    predictionTimestamp: datetime | None = None


class BundleManager:
    def __init__(
        self,
        bundle: ServingBundle | None = None,
        error: str | None = None,
        deployment: dict[str, Any] | None = None,
    ):
        self.bundle = bundle
        self.error = error
        self.deployment = deployment

    @property
    def ready(self) -> bool:
        return self.bundle is not None and self.error is None

    @classmethod
    def from_environment(cls) -> "BundleManager":
        approved = os.getenv("BORESAKSHI_PHASE6_APPROVED", "").strip().upper() == "YES"
        deployment_pointer = os.getenv("BORESAKSHI_DEPLOYMENT_MANIFEST", "").strip()
        deployment = None
        try:
            if deployment_pointer:
                deployment = load_runtime_deployment(deployment_pointer)
                phase4_dir = str(deployment["phase4RunDir"])
                phase5_dir = str(deployment["phase5EvaluationDir"])
                feature_manifest = str(deployment["featureManifest"])
            else:
                phase4_dir = os.getenv("BORESAKSHI_PHASE4_RUN_DIR", "").strip()
                phase5_dir = os.getenv("BORESAKSHI_PHASE5_EVALUATION_DIR", "").strip()
                feature_manifest = os.getenv("BORESAKSHI_FEATURE_MANIFEST", "").strip()

            if not phase4_dir or not phase5_dir or not feature_manifest:
                return cls(error="Phase 7/10 artifact paths are not fully configured", deployment=deployment)
            if not approved:
                return cls(error="BORESAKSHI_PHASE6_APPROVED must remain YES as the global production-serving kill switch", deployment=deployment)

            bundle = ServingBundle(
                phase4_run_dir=phase4_dir,
                phase5_evaluation_dir=phase5_dir,
                feature_manifest_path=feature_manifest,
                approved=True,
                min_feature_coverage_pct=float(os.getenv("BORESAKSHI_MIN_FEATURE_COVERAGE_PCT", "60")),
                warning_feature_coverage_pct=float(os.getenv("BORESAKSHI_WARN_FEATURE_COVERAGE_PCT", "80")),
            )
            if deployment and deployment.get("modelVersion") != bundle.model_version:
                raise ContinuousLearningError("deployment pointer modelVersion does not match the loaded artifact chain")
            return cls(bundle=bundle, deployment=deployment)
        except (ServingBundleError, ContinuousLearningError, ValueError, OSError, KeyError) as exc:
            logger.error("ml_bundle_load_failed error=%s", exc)
            return cls(error=str(exc), deployment=deployment)


def create_app(manager: BundleManager | None = None) -> FastAPI:
    state: dict[str, BundleManager | None] = {"manager": manager}

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if state["manager"] is None:
            state["manager"] = BundleManager.from_environment()
        current = state["manager"]
        logger.info("ml_service_start ready=%s error=%s", current.ready, current.error)
        yield

    app = FastAPI(
        title="BoreSakshi ML Service",
        version="1.2.0",
        description="Phase 10-aware prediction service. Serving remains checksummed, human-approval-gated and rollbackable.",
        lifespan=lifespan,
    )

    def current_manager() -> BundleManager:
        value = state["manager"]
        if value is None:
            value = BundleManager.from_environment()
            state["manager"] = value
        return value

    @app.get("/ml/health")
    def health(response: Response):
        active = current_manager()
        if not active.ready:
            response.status_code = 503
            return {
                "ok": False,
                "service": "boresakshi-ml",
                "ready": False,
                "modelLoaded": False,
                "error": active.error or "ML bundle unavailable",
                "deploymentId": active.deployment.get("deploymentId") if active.deployment else None,
            }
        info = active.bundle.model_info()
        return {
            "ok": True,
            "service": "boresakshi-ml",
            "ready": True,
            "modelLoaded": True,
            "modelVersion": info["modelVersion"],
            "featureVersion": info["featureVersion"],
            "featureManifestSha256": info["featureManifestSha256"],
            "predictionContractVersion": "1.0.0",
            "deploymentId": active.deployment.get("deploymentId") if active.deployment else None,
            "deploymentManaged": bool(active.deployment),
        }

    @app.get("/ml/model-info")
    def model_info():
        active = current_manager()
        if not active.ready:
            raise HTTPException(status_code=503, detail={"code": "MODEL_NOT_READY", "message": active.error or "ML bundle unavailable"})
        info = active.bundle.model_info()
        info["predictionContractVersion"] = "1.0.0"
        info["deployment"] = None if not active.deployment else {
            "deploymentId": active.deployment.get("deploymentId"),
            "status": active.deployment.get("status"),
            "activatedAt": active.deployment.get("activatedAt"),
            "activatedBy": active.deployment.get("activatedBy"),
            "productionActivated": active.deployment.get("productionActivated"),
            "monitoringRequired": active.deployment.get("monitoringRequired"),
        }
        return info

    @app.post("/ml/predict")
    def predict(request: PredictRequest):
        active = current_manager()
        if not active.ready:
            raise HTTPException(status_code=503, detail={"code": "MODEL_NOT_READY", "message": active.error or "ML bundle unavailable"})
        started = time.perf_counter()
        timestamp = request.predictionTimestamp or datetime.now(timezone.utc)
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        try:
            result = active.bundle.predict(
                lat=request.lat,
                lng=request.lng,
                nearby_borewells=[well.model_dump() for well in request.nearbyBorewells],
                prediction_time=timestamp,
            )
            result = attach_prediction_metadata(active.bundle, result)
            if active.deployment:
                result["deploymentId"] = active.deployment.get("deploymentId")
            validate_ml_prediction_contract(result)
        except CoverageError as exc:
            logger.warning(
                "ml_prediction_rejected reason=coverage coverage=%s duration_ms=%.1f",
                exc.coverage.get("coveragePct"),
                (time.perf_counter() - started) * 1000,
            )
            raise HTTPException(
                status_code=422,
                detail={"code": "INSUFFICIENT_FEATURE_COVERAGE", "message": str(exc), "coverage": exc.coverage},
            ) from exc
        except Exception as exc:
            logger.exception("ml_prediction_failed duration_ms=%.1f", (time.perf_counter() - started) * 1000)
            raise HTTPException(status_code=500, detail={"code": "INFERENCE_FAILED", "message": "ML inference failed contract or runtime checks"}) from exc
        logger.info(
            "ml_prediction_ok model=%s deployment=%s snapshot=%s confidence=%s coverage=%s duration_ms=%.1f",
            result["modelVersion"],
            result.get("deploymentId"),
            result["featureSnapshotRef"],
            result["confidence"],
            result["featureCoverage"]["coveragePct"],
            (time.perf_counter() - started) * 1000,
        )
        return result

    return app


app = create_app()
