from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from boresakshi_ml.continuous import (
    ComparisonThresholds,
    ContinuousLearningConfig,
    ContinuousLearningError,
    activate_deployment,
    approve_candidate,
    assess_monitoring_snapshot,
    rollback_deployment,
    stage_continuous_learning_candidate,
    stage_deployment,
)


def _algorithms(raw: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in raw.split(",") if item.strip())


def _stage(args: argparse.Namespace) -> dict:
    thresholds = ComparisonThresholds(
        max_brier_absolute_regression=args.max_brier_regression,
        max_roc_auc_absolute_regression=args.max_roc_auc_regression,
        max_calibration_absolute_regression=args.max_calibration_regression,
        max_regression_relative_mae_increase=args.max_mae_increase,
        max_regression_relative_rmse_increase=args.max_rmse_increase,
    )
    return stage_continuous_learning_candidate(
        dataset_path=args.dataset,
        production_phase4_dir=args.production_phase4_run,
        production_phase5_dir=args.production_phase5_evaluation,
        feature_manifest_path=args.feature_manifest,
        config=ContinuousLearningConfig(
            output_dir=Path(args.out),
            run_id=args.run_id,
            seed=args.seed,
            min_rows=args.min_rows,
            profile=args.profile,
            algorithms=_algorithms(args.algorithms),
            folds=args.folds,
            inner_folds=args.inner_folds,
            interval_coverage=args.interval_coverage,
            min_spatial_blocks=args.min_spatial_blocks,
            calibration_bins=args.calibration_bins,
            bootstrap_iterations=args.bootstrap_iterations,
            confidence_level=args.confidence_level,
        ),
        thresholds=thresholds,
    )


def _approve(args: argparse.Namespace) -> dict:
    return approve_candidate(
        promotion_candidate_path=args.candidate,
        reviewer=args.reviewer,
        reason=args.reason,
        override_comparison_hold=args.override_comparison_hold,
    )


def _stage_deploy(args: argparse.Namespace) -> dict:
    return stage_deployment(
        promotion_candidate_path=args.candidate,
        approval_path=args.approval,
        deployment_id=args.deployment_id,
        current_pointer_path=args.current,
    )


def _activate(args: argparse.Namespace) -> dict:
    return activate_deployment(
        staged_deployment_path=args.deployment,
        current_pointer_path=args.current,
        actor=args.actor,
        reason=args.reason,
        confirm=args.confirm,
    )


def _rollback(args: argparse.Namespace) -> dict:
    return rollback_deployment(
        current_pointer_path=args.current,
        actor=args.actor,
        reason=args.reason,
        confirm=args.confirm,
    )


def _monitor(args: argparse.Namespace) -> dict:
    metrics = json.loads(Path(args.metrics).read_text(encoding="utf-8"))
    if not isinstance(metrics, dict):
        raise ContinuousLearningError("monitoring metrics must contain a JSON object")
    return assess_monitoring_snapshot(
        current_pointer_path=args.current,
        metrics=metrics,
        min_scored=args.min_scored,
        max_brier=args.max_brier,
        max_depth_mae_ft=args.max_depth_mae_ft,
        max_yield_mae_lpm=args.max_yield_mae_lpm,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="BoreSakshi Phase 10 Continuous Learning / Adaptive Retraining. No command automatically replaces production without explicit human approval and deployment confirmation."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    stage = sub.add_parser("stage", help="Freeze a verified dataset version, train/evaluate a candidate and compare it with production")
    stage.add_argument("--dataset", required=True)
    stage.add_argument("--feature-manifest", required=True)
    stage.add_argument("--production-phase4-run", required=True)
    stage.add_argument("--production-phase5-evaluation", required=True)
    stage.add_argument("--out", default="continuous-runs")
    stage.add_argument("--run-id", required=True)
    stage.add_argument("--seed", type=int, default=42)
    stage.add_argument("--min-rows", type=int, default=30)
    stage.add_argument("--profile", choices=["standard", "test"], default="standard")
    stage.add_argument("--algorithms", default="")
    stage.add_argument("--folds", type=int, default=5)
    stage.add_argument("--inner-folds", type=int, default=3)
    stage.add_argument("--interval-coverage", type=float, default=0.90)
    stage.add_argument("--min-spatial-blocks", type=int, default=5)
    stage.add_argument("--calibration-bins", type=int, default=10)
    stage.add_argument("--bootstrap-iterations", type=int, default=500)
    stage.add_argument("--confidence-level", type=float, default=0.95)
    stage.add_argument("--max-brier-regression", type=float, default=0.02)
    stage.add_argument("--max-roc-auc-regression", type=float, default=0.02)
    stage.add_argument("--max-calibration-regression", type=float, default=0.03)
    stage.add_argument("--max-mae-increase", type=float, default=0.05)
    stage.add_argument("--max-rmse-increase", type=float, default=0.05)
    stage.set_defaults(handler=_stage)

    approve = sub.add_parser("approve", help="Create an immutable human approval artifact for one staged candidate")
    approve.add_argument("--candidate", required=True, help="promotion-candidate.json")
    approve.add_argument("--reviewer", required=True)
    approve.add_argument("--reason", required=True)
    approve.add_argument("--override-comparison-hold", action="store_true")
    approve.set_defaults(handler=_approve)

    deploy = sub.add_parser("stage-deployment", help="Create a deployment descriptor from an approved candidate")
    deploy.add_argument("--candidate", required=True)
    deploy.add_argument("--approval", required=True)
    deploy.add_argument("--deployment-id", required=True)
    deploy.add_argument("--current", help="Optional existing deployment pointer used to record rollback target")
    deploy.set_defaults(handler=_stage_deploy)

    activate = sub.add_parser("activate", help="Atomically activate a staged deployment pointer")
    activate.add_argument("--deployment", required=True)
    activate.add_argument("--current", required=True)
    activate.add_argument("--actor", required=True)
    activate.add_argument("--reason", required=True)
    activate.add_argument("--confirm", required=True, help="Must be exactly DEPLOY")
    activate.set_defaults(handler=_activate)

    rollback = sub.add_parser("rollback", help="Restore the previous reviewed deployment from the current pointer")
    rollback.add_argument("--current", required=True)
    rollback.add_argument("--actor", required=True)
    rollback.add_argument("--reason", required=True)
    rollback.add_argument("--confirm", required=True, help="Must be exactly ROLLBACK")
    rollback.set_defaults(handler=_rollback)

    monitor = sub.add_parser("monitor", help="Assess post-deployment ledger metrics without automatic rollback")
    monitor.add_argument("--current", required=True)
    monitor.add_argument("--metrics", required=True, help="JSON object, normally exported from the Phase 11 ledger API")
    monitor.add_argument("--min-scored", type=int, default=20)
    monitor.add_argument("--max-brier", type=float, default=0.30)
    monitor.add_argument("--max-depth-mae-ft", type=float, default=150.0)
    monitor.add_argument("--max-yield-mae-lpm", type=float, default=60.0)
    monitor.set_defaults(handler=_monitor)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        result = args.handler(args)
    except (ContinuousLearningError, ValueError, OSError, KeyError, json.JSONDecodeError) as exc:
        print(f"PHASE10_FAILED: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
