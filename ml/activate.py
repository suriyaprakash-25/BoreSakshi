from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from boresakshi_ml.phase7 import attach_prediction_metadata, build_activation_report, write_checksummed_report
from boresakshi_ml.serving import ServingBundle


def _load_nearby(path: str | None) -> list[dict]:
    if not path:
        return []
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("--nearby-json must contain a JSON array")
    return payload


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(
        description="BoreSakshi Phase 7 real-model activation preflight. It validates the approved artifact chain and writes a checksummed review report; it does not deploy traffic."
    )
    parser.add_argument("--lat", type=float, required=True, help="Smoke-test latitude")
    parser.add_argument("--lng", type=float, required=True, help="Smoke-test longitude")
    parser.add_argument("--nearby-json", help="Optional JSON array of verified historical wells for the smoke location")
    parser.add_argument("--out", default="activations", help="Directory in which to write the checksummed activation report")
    parser.add_argument("--activation-id", default=None, help="Human-readable activation identifier")
    args = parser.parse_args()

    try:
        phase4_dir = _required_env("BORESAKSHI_PHASE4_RUN_DIR")
        phase5_dir = _required_env("BORESAKSHI_PHASE5_EVALUATION_DIR")
        feature_manifest = _required_env("BORESAKSHI_FEATURE_MANIFEST")
        approved = os.getenv("BORESAKSHI_PHASE6_APPROVED", "").strip().upper() == "YES"
        if not approved:
            raise ValueError("BORESAKSHI_PHASE6_APPROVED must be YES before Phase 7 activation preflight")

        bundle = ServingBundle(
            phase4_run_dir=phase4_dir,
            phase5_evaluation_dir=phase5_dir,
            feature_manifest_path=feature_manifest,
            approved=True,
            min_feature_coverage_pct=float(os.getenv("BORESAKSHI_MIN_FEATURE_COVERAGE_PCT", "60")),
            warning_feature_coverage_pct=float(os.getenv("BORESAKSHI_WARN_FEATURE_COVERAGE_PCT", "80")),
        )
        timestamp = datetime.now(timezone.utc)
        prediction = bundle.predict(
            lat=args.lat,
            lng=args.lng,
            nearby_borewells=_load_nearby(args.nearby_json),
            prediction_time=timestamp,
        )
        prediction = attach_prediction_metadata(bundle, prediction)
        activation_id = args.activation_id or f"phase7-{timestamp.strftime('%Y%m%dT%H%M%SZ')}"
        report = build_activation_report(bundle, prediction, activation_id)
        report_path, checksum_path = write_checksummed_report(report, args.out)
    except Exception as exc:
        print(f"PHASE7_PREFLIGHT_FAILED: {exc}", file=sys.stderr)
        return 2

    print(json.dumps({
        "status": report["status"],
        "productionActivated": report["productionActivated"],
        "modelVersion": report["modelVersion"],
        "featureVersion": report["featureVersion"],
        "featureSnapshotRef": report["featureSnapshotRef"],
        "report": str(report_path),
        "checksum": str(checksum_path),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
