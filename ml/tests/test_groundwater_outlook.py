"""Groundwater outlook: endpoint contract and the coverage gates of the live predictor.

No network or model files are needed; the predictor is stubbed where heavy.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sklearn.neighbors import BallTree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "public_data"))

from service import BundleManager, GroundwaterManager, create_app  # noqa: E402

gw_live = pytest.importorskip("gw_live")

GOOD = {
    "available": True, "modelVersion": "gw-test", "preMonsoon": {"depthM": 6.0, "lowM": 4.0, "highM": 9.0},
    "postMonsoon": {"depthM": 3.0, "lowM": 2.0, "highM": 4.5}, "seasonalRiseM": 3.0, "chanceWithin10m": 0.8,
    "intervalCoveragePct": 80, "rockUnit": "Peninsular Gneiss", "nearestStationKm": 4.2,
}


class Stub:
    model_version = "gw-test"

    def __init__(self, error=None):
        self.error = error

    def predict(self, lat, lng):
        if self.error:
            raise self.error
        return dict(GOOD)


def client_for(predictor=None, error="loading"):
    manager = GroundwaterManager(loader=lambda: predictor)
    if predictor is not None:
        manager.load()
    else:
        manager.error = error
    return TestClient(create_app(manager=BundleManager(error="no borewell model"), groundwater=manager))


def test_outlook_is_returned_for_a_covered_location():
    response = client_for(Stub()).post("/ml/groundwater", json={"lat": 11.0, "lng": 78.0})
    assert response.status_code == 200
    assert response.json()["preMonsoon"]["depthM"] == 6.0


@pytest.mark.parametrize("error,status,code", [
    (gw_live.OutsideCoverage("sea"), 422, "OUTSIDE_COVERAGE"),
    (gw_live.LowCoverage("far"), 422, "LOW_COVERAGE"),
    (gw_live.SourceUnavailable("down"), 503, "FEATURE_SOURCE_UNAVAILABLE"),
    (RuntimeError("boom"), 500, "GROUNDWATER_FAILED"),
])
def test_refusals_carry_a_reason_and_never_a_number(error, status, code):
    response = client_for(Stub(error)).post("/ml/groundwater", json={"lat": 11.0, "lng": 78.0})
    assert response.status_code == status
    body = response.json()
    assert body["detail"]["code"] == code
    assert "preMonsoon" not in body


def test_endpoint_reports_not_ready_while_loading():
    client = client_for(None)
    assert client.post("/ml/groundwater", json={"lat": 11.0, "lng": 78.0}).json()["detail"]["code"] == "GROUNDWATER_NOT_READY"
    assert client.get("/ml/groundwater/health").status_code == 503


def test_failed_load_is_reported_not_raised():
    def broken():
        raise FileNotFoundError("model missing")
    manager = GroundwaterManager(loader=broken)
    manager.load()
    assert manager.predictor is None and "model missing" in manager.error


def bare_predictor(stations):
    predictor = object.__new__(gw_live.LiveGroundwater)
    predictor.stations = stations
    predictor.station_tree = BallTree(np.radians(stations[["latitude", "longitude"]].to_numpy()), metric="haversine")
    predictor.cache = {}
    import threading
    predictor.lock = threading.Lock()
    return predictor


def test_live_predictor_refuses_outside_india_and_far_from_any_station():
    predictor = bare_predictor(pd.DataFrame({"latitude": [11.0], "longitude": [78.0]}))
    with pytest.raises(gw_live.OutsideCoverage):
        predictor.predict(51.5, -0.1)  # London
    with pytest.raises(gw_live.LowCoverage):
        predictor.predict(11.0, 79.5)  # about 160 km from the only station


def test_missing_map_layers_are_refused_not_filled():
    predictor = bare_predictor(pd.DataFrame({"latitude": [11.0], "longitude": [78.0], "pre_m": [5.0], "post_m": [3.0],
                                             "pre_head": [100.0], "post_head": [102.0]}))

    class Model:
        def predict(self, table):
            return np.array([1.0])

    predictor.package = {"models": {"pre_m": {"model": Model(), "features": ["elevation_m", "ndvi_dry"], "halfWidth": 0.5},
                                    "post_m": {"model": Model(), "features": ["elevation_m"], "halfWidth": 0.5}}}
    predictor.evidence = lambda frame, target: pd.DataFrame(index=frame.index)
    frame = pd.DataFrame([{"elevation_m": 200.0, "ndvi_dry": float("nan")}])
    with pytest.raises(gw_live.LowCoverage, match="ndvi_dry"):
        predictor.score(frame, 3.0)


def test_blanks_that_were_normal_in_training_are_allowed():
    predictor = bare_predictor(pd.DataFrame({"latitude": [11.0], "longitude": [78.0], "pre_m": [5.0], "post_m": [3.0],
                                             "pre_head": [100.0], "post_head": [102.0]}))

    class Model:
        def predict(self, table):
            return np.array([1.0])

        def predict_proba(self, table):
            return np.array([[0.3, 0.7]])

    class Calibrator:
        def predict(self, values):
            return np.asarray(values)

    predictor.package = {
        "models": {"pre_m": {"model": Model(), "features": ["elevation_m", "et_mm"], "halfWidth": 0.5},
                   "post_m": {"model": Model(), "features": ["elevation_m"], "halfWidth": 0.5}},
        "shallow": {"model": Model(), "calibrator": Calibrator(), "features": ["elevation_m", "et_mm"]},
        "trainingMissingRate": {"elevation_m": 0.0, "et_mm": 0.08},
    }
    predictor.model_version, predictor.validation = "gw-test", {}
    predictor.evidence = lambda frame, target: pd.DataFrame(index=frame.index)
    frame = pd.DataFrame([{"elevation_m": 200.0, "et_mm": float("nan"), "gsi_unit": "Granite", "gsi_family": "granite"}])
    result = predictor.score(frame, 3.0)
    assert result["available"] and result["preMonsoon"]["depthM"] == round(float(np.expm1(1.0)), 2)


def test_accuracy_shown_is_the_one_measured_for_the_farmers_area():
    validation = {"stations": 100, "preMonsoonMaeM": 3.5, "areas": {"tamilNaduBox": {"preMonsoonMaeM": 2.5}, "northIndia": {"preMonsoonMaeM": 4.5}}}
    assert gw_live.validation_for(validation, 9.9, 78.1)["preMonsoonMaeM"] == 2.5   # Madurai
    assert gw_live.validation_for(validation, 26.8, 80.9)["preMonsoonMaeM"] == 4.5  # Lucknow
    assert gw_live.validation_for(validation, 15.4, 75.1)["preMonsoonMaeM"] == 3.5  # no peninsula score: India-wide
    assert "areas" not in gw_live.validation_for(validation, 9.9, 78.1)
