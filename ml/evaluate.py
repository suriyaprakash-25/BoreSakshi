from __future__ import annotations

import argparse
import json
from pathlib import Path

from boresakshi_ml.data import load_feature_dataset
from boresakshi_ml.scientific import ScientificEvaluationConfig, evaluate_scientifically


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scientifically evaluate BoreSakshi Phase 4 candidates with spatial holdouts.")
    parser.add_argument("--dataset", required=True, help="Phase 3 feature dataset JSON")
    parser.add_argument("--phase4-run", required=True, help="Directory containing Phase 4 run-manifest.json + candidate artifacts")
    parser.add_argument("--out", default="evaluations", help="Output directory for Phase 5 artifacts")
    parser.add_argument("--evaluation-id", default="", help="Stable evaluation ID")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--inner-folds", type=int, default=3)
    parser.add_argument("--interval-coverage", type=float, default=0.90)
    parser.add_argument("--min-rows", type=int, default=30)
    parser.add_argument("--min-spatial-blocks", type=int, default=5)
    parser.add_argument("--calibration-bins", type=int, default=10)
    parser.add_argument("--bootstrap-iterations", type=int, default=500)
    parser.add_argument("--confidence-level", type=float, default=0.95)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    dataset = load_feature_dataset(args.dataset)
    phase4_run = Path(args.phase4_run)
    evaluation_id = args.evaluation_id.strip() or f"phase5-{phase4_run.name}-{dataset['datasetHash'][:10]}"
    report = evaluate_scientifically(
        dataset,
        phase4_run,
        ScientificEvaluationConfig(
            output_dir=Path(args.out),
            evaluation_id=evaluation_id,
            folds=args.folds,
            inner_folds=args.inner_folds,
            interval_coverage=args.interval_coverage,
            min_rows=args.min_rows,
            min_spatial_blocks=args.min_spatial_blocks,
            calibration_bins=args.calibration_bins,
            bootstrap_iterations=args.bootstrap_iterations,
            confidence_level=args.confidence_level,
            seed=args.seed,
        ),
    )
    summary = {
        "evaluationId": report["evaluationId"],
        "trainingDataset": report["trainingDataset"],
        "blockedTasks": report["blockedTasks"],
        "tasks": {
            task: {
                "status": details["status"],
                "selection": details["selection"],
                "coverage": {
                    "eligibleRows": details["coverage"]["eligibleRows"],
                    "spatialBlockCount": details["coverage"]["spatialBlockCount"],
                    "geographicBounds": details["coverage"]["geographicBounds"],
                },
            }
            for task, details in report["tasks"].items()
        },
        "servingApproved": report["servingApproved"],
        "phaseBoundary": report["phaseBoundary"],
        "artifacts": report["artifacts"],
    }
    print(json.dumps(summary, indent=2))
    return 1 if report["blockedTasks"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
