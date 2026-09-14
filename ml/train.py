from __future__ import annotations

import argparse
import json
from pathlib import Path

from boresakshi_ml.data import load_feature_dataset
from boresakshi_ml.training import TrainingConfig, train_model_candidates


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train BoreSakshi Phase 4 candidate models from a Phase 3 feature artifact.")
    parser.add_argument("--dataset", required=True, help="Path to Phase 3 feature dataset JSON")
    parser.add_argument("--out", default="artifacts", help="Directory for generated model artifacts")
    parser.add_argument("--run-id", default="", help="Stable run ID; default derives from dataset hash")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--min-rows", type=int, default=30)
    parser.add_argument("--profile", choices=["standard", "test"], default="standard")
    parser.add_argument("--algorithms", default="", help="Comma-separated candidate names; empty trains all available candidates")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    dataset = load_feature_dataset(args.dataset)
    run_id = args.run_id.strip() or f"phase4-{dataset['datasetVersion']}-{dataset['datasetHash'][:10]}"
    algorithms = tuple(name.strip() for name in args.algorithms.split(",") if name.strip())
    config = TrainingConfig(
        output_dir=Path(args.out),
        run_id=run_id,
        seed=args.seed,
        min_rows=args.min_rows,
        profile=args.profile,
        algorithms=algorithms,
    )
    manifest = train_model_candidates(dataset, config)
    print(json.dumps({
        "runId": manifest["runId"],
        "modelSchemaVersion": manifest["modelSchemaVersion"],
        "featureSchemaVersion": manifest["featureSchemaVersion"],
        "trainingDataset": manifest["trainingDataset"],
        "tasks": {
            task: {
                "status": details["status"],
                "dataSummary": details["dataSummary"],
                "trainedCandidates": [c["name"] for c in details["candidates"] if c["status"] == "trained"],
                "unavailableCandidates": [c["name"] for c in details["candidates"] if c["status"] == "unavailable"],
                "readinessErrors": details["readinessErrors"],
            }
            for task, details in manifest["tasks"].items()
        },
        "phaseBoundary": manifest["phaseBoundary"],
    }, indent=2))
    blocked = [task for task, details in manifest["tasks"].items() if details["status"] == "blocked"]
    return 1 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
