from __future__ import annotations

from production_preflight import validate_environment


def test_phase18_ml_preflight_rejects_missing_approval_and_artifact_pointer():
    errors = validate_environment({
        "DEPLOYMENT_ENV": "production",
        "RELEASE_VERSION": "2026.09.15-abc123",
        "BORESAKSHI_PHASE6_APPROVED": "NO",
    })
    assert any("BORESAKSHI_PHASE6_APPROVED=YES" in item for item in errors)
    assert any("BORESAKSHI_DEPLOYMENT_MANIFEST" in item for item in errors)


def test_phase18_ml_preflight_rejects_relative_artifact_mount():
    errors = validate_environment({
        "DEPLOYMENT_ENV": "production",
        "RELEASE_VERSION": "2026.09.15-abc123",
        "BORESAKSHI_PHASE6_APPROVED": "YES",
        "BORESAKSHI_DEPLOYMENT_MANIFEST": "artifacts/deployments/active.json",
    })
    assert any("absolute mounted artifact path" in item for item in errors)


def test_phase18_ml_preflight_accepts_deployment_shape_before_bundle_integrity_check():
    errors = validate_environment({
        "DEPLOYMENT_ENV": "staging",
        "RELEASE_VERSION": "ci-0123456789abcdef",
        "BORESAKSHI_PHASE6_APPROVED": "YES",
        "BORESAKSHI_DEPLOYMENT_MANIFEST": "/opt/boresakshi/artifacts/deployments/active.json",
    })
    assert errors == []
