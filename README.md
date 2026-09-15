# BoreSakshi

Know before you drill — a verified-outcome network + AI prediction engine that tells rural households and farmers where a borewell is likely to succeed, how deep, and with what yield, before they spend lakhs.

## Structure

```text
boresakshi/
├── server/   Node + Express + MongoDB API, trusted rig-data collection and accountability ledger
├── web/      React + Vite + Leaflet farmer/operator/admin UI
└── ml/       training + scientific evaluation + FastAPI serving + adaptive retraining/deployment controls
```

## Runtime prediction path

```text
Farmer UI
   ↓
Node /api/predict
   ↓ Phase 9 VERIFIED / unflagged / eligible wells only
Python /ml/predict
   ↓
Live checksum-verified geospatial feature extraction
   ↓
Human-approved active model deployment pointer
   ↓
Phase 5-selected success + depth + yield models
   ↓
Calibration + conformal uncertainty + explanations
   ↓
Phase 7 versioned prediction-contract validation
   ↓
Node contract validation + Phase 11 accountability snapshot
```

Every accepted ML prediction carries a model version, feature version, prediction timestamp, uncertainty, explanations, coverage metadata and an immutable `featureSnapshotRef`. If the Python service is unavailable or returns an invalid/insufficient-coverage response, Node returns the deterministic heuristic **only as an explicitly labelled `heuristic_fallback`**. It is never presented as ML.

## Rig-operator verification path

```text
Authenticated + verified operator account
   ↓
Device GPS + accuracy + drilling date
   ↓
Depth / strike / yield + geological layers
   ↓
Photo evidence (+ optional video)
   ↓
SUBMITTED / untrusted
   ↓
UNDER_REVIEW
   ↓
Deterministic review signals + human evidence review
   ↓
VERIFIED  or  REJECTED
   ↓
Only VERIFIED + unflagged + eligible outcomes become
public data / ML evidence / future training / ledger truth
```

Phase 8 provides structured evidence-backed field collection. Phase 9 provides the formal human verification lifecycle, deterministic suspicious-data review, append-only review audit and server-computed operator trust profile. Phase 15 additionally requires the operator account itself to be verified before it can upload field evidence or submit a drilling record.

The Phase 9 trust/risk scores are operational review aids, not groundwater-model probabilities and not substitutes for Phase 5 scientific ML validation.

## Continuous learning path

```text
Phase 9 VERIFIED outcomes
   ↓
new versioned feature dataset
   ↓
checksummed TrainingDatasetVersion
   ↓
Phase 4 candidate training
   ↓
Phase 5 spatial scientific evaluation
   ↓
production-model comparison
   ↓
HUMAN APPROVAL
   ↓
STAGED deployment
   ↓ explicit DEPLOY
ACTIVE deployment pointer
   ↓
Phase 11 post-deployment accountability metrics
   ↓ human monitoring/review
   ↓ explicit ROLLBACK when required
```

Phase 10 is continuous learning/adaptive retraining, **not reinforcement learning**. A new upload can never directly overwrite the production model. Automated comparison guards can hold a candidate for review, but only a separate human approval artifact and explicit deployment action can activate it.

## Prediction accountability path

```text
Persisted prediction
   ↓
model/deployment/probability/depth/yield snapshot
   ↓
real borewell drilled
   ↓
Phase 9 VERIFIED outcome
   ↓
pre-drilling prediction matched within accountability radius
   ↓
correctness + Brier/calibration + strike/yield errors
   ↓
regional + model-version + source performance
   ↓
Phase 10 monitoring input
```

Phase 11 preserves real ML model versions separately from `heuristic_fallback`. If outcome trust is later reopened or removed, that outcome is removed from current performance metrics and the reopening is retained in append-only accountability history.

## Production security and reliability

Phase 15 adds application-level production controls without replacing the existing Phase 2–11 flows:

- revocable server-side sessions beneath signed JWT identity;
- `HttpOnly`, `Secure`-in-production, `SameSite=Strict` session cookies;
- one-time hashed recovery codes, password reset/change and session revocation;
- verified-admin and verified-field-operator authorization gates;
- same-origin unsafe-write protection, HTTPS checks and security headers;
- request IDs, safe error handling and expanded rate limits;
- public borewell privacy projection;
- append-only `security_event` audit records;
- liveness/readiness and protected low-cardinality Prometheus metrics;
- AES-256-GCM encrypted/checksummed Mongo backups and guarded restore;
- high-severity production dependency-audit gates for server and web.

Phase 15 hardens the application. Phase 18 supplies the deployment/operations package around those controls; real infrastructure credentials and reviewed ML artifacts remain deployment-time inputs rather than committed source data.

## Full release testing

Phase 17 adds a single release-oriented test matrix across the complete BoreSakshi stack:

```text
frontend component/form/map/auth tests + production build/preview
                       ↓
complete Node unit/API/security/accountability suite
                       ↓
real Node + real MongoDB drilling/accountability E2E
                       ↓
complete Python ML regression/leakage/inference suite
                       ↓
              Phase 17 release gate
```

The real-Mongo E2E covers operator registration/login, admin operator verification, farmer prediction persistence, explicit fallback behavior when ML is unavailable, rig evidence upload, structured drilling submission, Phase 9 verification, Phase 11 accountability scoring, public privacy projection and outcome reopening/audit retention.

Verified Phase 17 runtime-head results: 77 active backend tests passed with two intentional skips in the generic suite, the separate Mongo lifecycle passed, 5 frontend tests passed, the production frontend build/preview passed, 29 ML tests passed, and production server/web dependency audits passed with zero production vulnerabilities. See `docs/phase-17-full-testing.md` and `docs/phase-17-completion-report.md` for the exact scope and boundaries.

## Production deployment and operations

Phase 18 adds the provider-neutral production package and delivery controls:

- non-root API, ML and web production containers with read-only filesystems/capability dropping/resource limits;
- production/staging Compose topologies and private internal service networking;
- fail-closed API and ML production preflight checks;
- versioned additive MongoDB migrations with an explicit rollback gate;
- graceful API shutdown/draining;
- immutable commit-SHA image releases, staging-first delivery, smoke validation and previous-release rollback;
- durable private rig-evidence and encrypted-backup volume mounts;
- encrypted off-site restic backup plus scheduled restore rehearsal;
- protected Prometheus metrics, Alertmanager, Loki, Fluent Bit and Grafana configuration;
- GitHub Actions gates for full regression, dependency audits, real migration integration, Docker builds, image publication, staging and production environment approval.

The production templates deliberately default external readiness attestations to `NO`. A live production deployment must provide real HTTPS/DNS, managed/private MongoDB, secrets, durable encrypted storage, off-site backup credentials, a tested alert receiver, deployment hosts/GitHub environment secrets and the human-reviewed active ML artifact chain. See `deploy/README.md` and `docs/phase-18-production-deployment.md`.

## Run locally

**1) Python ML service**

The service remains not-ready until reviewed real Phase 4/5 artifacts, the live geospatial manifest, and the explicit serving approval gate are configured.

```bash
cd ml
python -m venv .venv
# activate environment
python -m pip install -r requirements-candidates.txt
# configure values from ml/.env.example in your shell
python -m uvicorn service:app --host 127.0.0.1 --port 8000
```

For a reviewed real-artifact v1 activation candidate, run the Phase 7 preflight before routing farmer traffic:

```bash
python activate.py --lat 11.36 --lng 77.80 --activation-id boresakshi-v1-candidate --out activations/boresakshi-v1-candidate
```

Phase 10 adaptive retraining is managed through `ml/continuous.py`:

```bash
python continuous.py stage ...
python continuous.py approve ...
python continuous.py stage-deployment ...
python continuous.py activate ... --confirm DEPLOY
python continuous.py monitor ...
python continuous.py rollback ... --confirm ROLLBACK
```

When `BORESAKSHI_DEPLOYMENT_MANIFEST` points to a checksummed ACTIVE Phase 10 deployment pointer, the ML service resolves that exact reviewed model/evaluation/feature chain. `BORESAKSHI_PHASE6_APPROVED=YES` remains a mandatory global serving kill switch.

**2) Node backend**

```bash
cd server
npm install
# copy server/.env.example to .env and configure secrets/origin/security values
node seed.js     # optional demo logs
npm start        # http://localhost:4000
```

Phase 15 operational checks and backup commands:

```bash
npm run test:phase15
npm run security:audit
npm run backup:create
npm run backup:verify -- <backup-directory>
npm run backup:restore -- <backup-directory>   # dry-run by default
```

Phase 17 backend test commands:

```bash
npm run test:phase17
# dedicated real-Mongo lifecycle requires PHASE17_E2E=YES and a MongoDB URI
npm run test:phase17:e2e
```

Phase 8 evidence is stored under `RIG_MEDIA_DIR`. Production deployment must use durable/private storage; the local default is for development and application-contract validation.

Verification review is available to admins at `/admin/review`. Rig operators see their server-computed Phase 9 trust profile on the dashboard and can request re-review for rejected submissions from History.

The public `/ledger` page reports persisted prediction counts, classification accuracy, Brier/calibration, water-strike/yield error, model-version performance and regional performance. `GET /api/ledger`, `/api/ledger/entries`, `/api/ledger/models` and `/api/ledger/regions` expose the same additive accountability contract.

**3) Web**

```bash
cd web
npm install
npm run test:phase17
npm run build
npm run dev      # http://localhost:5173
```

Signup displays a recovery code once. Save it securely; only its hash is stored by the backend. The reset flow is available at `/reset-password`.

## Roadmap status

- [x] Phase 2 — real-data ingestion, provenance, review and quality gates
- [x] Phase 3 — real geospatial feature-engineering pipeline
- [x] Phase 4 — real-model candidate training/registry
- [x] Phase 5 — spatial scientific evaluation/calibration/uncertainty/selection
- [x] Phase 6 — Python ML service + Node orchestration with explicit fallback controls
- [x] Phase 7 — real prediction-engine contract, immutable feature snapshots and activation preflight
- [x] Phase 8 — authenticated structured rig-operator data collection + evidence + untrusted-by-default gate
- [x] Phase 9 — formal verification lifecycle + suspicious-data review + operator/data trust + append-only audit
- [x] Phase 10 — adaptive retraining + production comparison + human approval + staged activation + rollback controls
- [x] Phase 11 — model-version prediction accountability, calibration, depth/yield error and regional performance
- [x] Phase 15 — production application security, privacy, sessions, recovery, audits, backups and monitoring
- [x] Phase 17 — full frontend/backend/ML/integration/end-to-end release testing
- [x] Phase 18 — production deployment package, CI/CD, rollback, monitoring, backup and recovery controls

All BoreSakshi v1 software roadmap phases are now implemented in `main`. Phase 10 still never replaces production automatically, and a live production cutover still requires the real external infrastructure/secrets plus the reviewed active ML artifacts and explicit deployment approvals described in Phase 18.
