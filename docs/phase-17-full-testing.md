# Phase 17 — Full Testing

## Purpose

Phase 17 turns BoreSakshi's accumulated Phase 2–15 checks into a release-oriented test gate. It does not replace working application code or bypass any review gate. It adds testable frontend contracts, a complete backend regression run, a real MongoDB/real Node end-to-end lifecycle, full ML regression coverage, production-build smoke checks and a single aggregate CI gate.

Phase 17 is stacked on `phase-15-production-security-reliability`. Phase 18 remains responsible for deployment and production operations.

## Release test architecture

```text
Phase 17 Full Testing
├── backend-full-suite
│   ├── server syntax checks
│   ├── all Node unit/API integration tests
│   └── production dependency audit
├── backend-real-mongo-e2e
│   ├── MongoDB 7 service
│   ├── real server/index.js process
│   └── full drilling/accountability lifecycle
├── frontend-component-and-flow-tests
│   ├── auth/form validation
│   ├── map interaction
│   ├── auth-storage/API flow
│   ├── real PredictionPanel SSR state checks
│   ├── Vite production build
│   ├── Vite production-preview smoke
│   └── production dependency audit
├── ml-full-regression
│   ├── pip environment check
│   ├── full historical ML suite
│   └── Phase 17 schema/leakage/inference guards
└── phase17-release-gate
    └── requires every layer above
```

## Frontend coverage

Phase 17 keeps the existing React/Vite stack and uses Node's built-in test runner plus Vite SSR instead of introducing another browser-test framework.

Production code now routes reusable behavior through small tested contracts:

- `web/src/authValidation.js` owns signup/signin form validation and mirrors the backend strong-password requirements.
- `web/src/mapInteraction.js` normalizes map picks and geolocation coordinates and rejects non-finite/out-of-range values.
- `web/src/authState.js` projects login/signup responses into a safe browser profile; bearer tokens, password hashes and recovery codes are not retained in local storage.
- `AuthScreen.jsx`, `auth.jsx`, and `FarmerScreen.jsx` consume those tested helpers.

`web/test/phase17-ui.test.js` verifies:

1. strong-password and confirmation validation;
2. valid/invalid map and geolocation interactions;
3. safe auth-state projection;
4. the real `PredictionPanel.jsx` idle and explicit `heuristic_fallback` states through Vite SSR;
5. cookie credential mode and safe browser persistence in the auth API flow.

CI then performs a production `vite build`, starts `vite preview`, waits for the rendered application shell, and runs the production-only npm dependency audit.

This is component/flow + production-preview smoke coverage, not full browser automation. Cross-stack HTTP behavior is covered by the backend E2E below.

## Backend coverage

`npm run test:phase17` executes every Node test sequentially so shared environment/file fixtures cannot race. It covers the existing Phase 2–15 unit and API integration tests, including ingestion validation, geospatial feature construction, ML client behavior, prediction contracts, rig evidence, verification/trust, accountability, security, privacy, backup primitives, CSRF and observability.

The generic suite intentionally skips two tests:

- the Phase 17 real-Mongo lifecycle, because it has a dedicated MongoDB CI job;
- the pre-existing Phase 2 admin ingestion HTTP contract, which remains intentionally skipped by its original contract-test guard.

The server production dependency audit remains blocking after the suite.

## Real MongoDB end-to-end lifecycle

`server/test/phase17-e2e.test.js` launches the real Node server against an ephemeral MongoDB 7 service and a temporary evidence directory. The controlled lifecycle is:

```text
Register operator
   ↓
Sign out → Login
   ↓
Verified admin login
   ↓
Admin verifies operator account
   ↓
Persist farmer prediction
   ↓ ML intentionally unavailable for this fixture
Explicit heuristic_fallback (never presented as ML)
   ↓
Upload photo evidence
   ↓
Submit structured borewell/GPS/geology/outcome
   ↓
Start Phase 9 review
   ↓
Human verification decision
   ↓
Phase 11 ledger score + Brier/accountability update
   ↓
Public borewell privacy projection check
   ↓
Reopen verification
   ↓
Outcome removed from current score
   ↓
Issued/scored/reopened audit history retained
```

The fixture deliberately points the ML client at an unavailable local port. This tests the production failure policy and verifies that fallback remains explicitly labelled. It does **not** claim that a real production ML artifact is activated. Real-ML serving contracts, calibration/uncertainty and artifact integrity are covered by the Python and Node ML tests from Phases 4–10.

The drilling fixture backdates its persisted prediction relative to the date-only drilling completion timestamp so the production historical-accountability rule is exercised without weakening that rule.

The first Phase 17 E2E run exposed a test assertion mismatch: the test expected the internal prediction field `id`, while the privacy-safe public ledger contract exposes `predictionId`. No production route was changed. The E2E assertion was corrected to use the public contract, and the subsequent full run passed.

## ML coverage

CI runs the entire `ml/tests` suite, not only Phase 17 tests. `ml/tests/test_phase17_regression.py` adds release-level guards for:

- the exact 26-feature contract (22 numeric + 4 categorical);
- raw latitude/longitude exclusion from model inputs;
- label leakage rejection;
- feature-schema drift rejection;
- `waterStrikeFt` remaining the depth-regression target rather than total drilled depth;
- classification and regression metric sanity;
- real ML vs `heuristic_fallback` separation;
- immutable feature-snapshot timestamp integrity;
- impossible prediction-range rejection.

These tests complement, rather than replace, the existing candidate-training, grouped scientific evaluation, calibration, uncertainty, serving, activation and continuous-learning tests.

## CI workflow

Workflow: `.github/workflows/phase17-full-testing.yml`

The aggregate `phase17-release-gate` succeeds only when all four independent test jobs succeed. This makes the release test state explicit instead of relying on a collection of unrelated historical workflow checks.

Verified runtime head: `30cac98c31c5153e326edfc091990a823d1de2aa`

Verified Phase 17 workflow run: `34927411360`

Results on that head:

| Gate | Result |
|---|---|
| Backend full suite | 79 discovered; 77 passed; 0 failed; 2 intentionally skipped |
| Real MongoDB E2E | 1 passed; 0 failed |
| Frontend Phase 17 tests | 5 passed; 0 failed |
| Frontend production build | passed |
| Frontend production-preview smoke | passed |
| Server production dependency audit | 0 vulnerabilities |
| Web production dependency audit | 0 production vulnerabilities |
| Full ML suite | 29 passed; 0 failed; 2 dependency deprecation warnings |
| Aggregate Phase 17 release gate | passed |

On the same runtime head, the inherited Phase 4, 5, 6, 7, 8, 9, 10, 11 and 15 workflows also completed successfully.

## Known non-blocking warnings

- GitHub's runner reports that some `actions/checkout@v4`, `actions/setup-node@v4` and `actions/setup-python@v5` internals target deprecated Node 20 and are being forced to Node 24 by the platform.
- The current FastAPI/Starlette test environment reports two upstream deprecation warnings around `httpx`/TestClient and the AnyIO `BlockingPortal` alias.
- `web/npm ci` can report two vulnerabilities in development-only dependencies. The Phase 17 release gate runs `npm audit --omit=dev --audit-level=high`; the production web dependency audit reports zero vulnerabilities. Phase 17 does not hide or reinterpret this distinction.

## Boundary after Phase 17

Phase 17 validates the software and release-test surface. It does not deploy BoreSakshi, configure TLS termination, create production secrets, provision durable private evidence storage, schedule off-host backups, configure centralized alerts, execute migrations in production, or activate a real model artifact chain. Those operational responsibilities remain Phase 18 and the existing human-reviewed ML activation gates.
