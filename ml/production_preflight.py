from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

from service import BundleManager

_RELEASE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def validate_environment(env: dict[str, str] | None = None) -> list[str]:
    env = env or dict(os.environ)
    errors: list[str] = []
    if env.get("DEPLOYMENT_ENV") not in {"staging", "production"}:
        errors.append("DEPLOYMENT_ENV must be staging or production")
    release = env.get("RELEASE_VERSION", "")
    if not _RELEASE_RE.fullmatch(release):
        errors.append("RELEASE_VERSION is required and must use safe release characters")
    if env.get("BORESAKSHI_PHASE6_APPROVED", "").upper() != "YES":
        errors.append("BORESAKSHI_PHASE6_APPROVED=YES is required")
    manifest = env.get("BORESAKSHI_DEPLOYMENT_MANIFEST", "")
    if not manifest:
        errors.append("BORESAKSHI_DEPLOYMENT_MANIFEST is required for Phase 18 production deployment")
    elif not Path(manifest).is_absolute():
        errors.append("BORESAKSHI_DEPLOYMENT_MANIFEST must be an absolute mounted artifact path")
    return errors


def main() -> int:
    errors = validate_environment()
    if errors:
        print(json.dumps({"ok": False, "phase": 18, "errors": errors}), file=sys.stderr)
        return 2

    manager = BundleManager.from_environment()
    if not manager.ready:
        print(json.dumps({
            "ok": False,
            "phase": 18,
            "errors": [manager.error or "ML bundle is not ready"],
        }), file=sys.stderr)
        return 3

    info = manager.bundle.model_info()
    print(json.dumps({
        "ok": True,
        "phase": 18,
        "modelVersion": info.get("modelVersion"),
        "featureVersion": info.get("featureVersion"),
        "deploymentId": manager.deployment.get("deploymentId") if manager.deployment else None,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
