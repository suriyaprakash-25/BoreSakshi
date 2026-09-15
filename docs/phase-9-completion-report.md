# BoreSakshi Phase 9 Completion Report

**Phase:** 9 — Verification & Data Trust  
**Implementation branch:** `phase-9-verification-data-trust`  
**Base branch:** `phase-8-rig-operator-data`  
**Pull request:** #9  
**Status:** Software implementation complete and CI-verified on the final runtime/test implementation head. Phase 10 remains responsible for continuous learning; Phase 15/17/18 retain security, full-system testing and production deployment obligations.

## Completion decision

**Verification lifecycle gate: PASS.**  
**Untrusted-by-default gate: PASS.**  
**Suspicious-data review gate: PASS.**  
**Human override/audit gate: PASS.**  
**Operator trust gate: PASS.**  
**Direct legacy Verify bypass gate: PASS.**  
**Public/live ML contamination gate: PASS.**  
**Offline training contamination gate: PASS.**  
**Ledger promotion/reversal gate: PASS.**  
**Operator appeal/re-review gate: PASS.**  
**Phase 2 imported-data compatibility gate: PASS.**  
**Phase 8 regression gate: PASS.**  
**Phase 7 regression gate: PASS.**  
**Web production-build gate: PASS.**  
**Inherited Phase 4–8 compatibility: PASS on verified implementation head.**  
**Phase 15 dependency-security gate: PENDING.**  
**Phase 17 full-system testing: PENDING.**  
**Phase 18 durable production deployment/storage: PENDING.**

## What Phase 9 adds

Phase 9 replaces the Phase 8 transitional verification toggle for operator-origin drilling outcomes with a formal review lifecycle:

```text
SUBMITTED
   ↓ admin starts review
UNDER_REVIEW
   ↓ human evidence/data decision
VERIFIED  or  REJECTED
```

Verified/rejected records can be reopened only through the dedicated reopen action with a documented reason. A rejected operator can request re-review, which moves the record back to `SUBMITTED` while keeping it untrusted.

Direct `verified=true/false` admin patches are rejected for operator-origin records. The legacy toggle remains available only for non-operator/imported Phase 2 records so existing reviewed-data semantics are preserved.

## Authoritative trust predicate

An operator outcome is authoritative only when:

```text
verificationStatus === VERIFIED
verified === true
flagged !== true
datasetEligibility.eligible !== false
```

This predicate is now enforced for public borewell data and the offline ML feature/training path. The existing live prediction path already requires verified/unflagged/eligible nearby evidence, so the lifecycle state prevents pending/rejected operator records from becoming live model evidence.

## Deterministic suspicious-data review

Phase 9 adds a versioned review analyzer with explainable signals for:

- poor/missing GPS accuracy;
- invalid GPS timing;
- delayed historical submissions;
- missing evidence/checksum integrity;
- missing/partial/overlapping geology;
- inconsistent success/dry-hole outcomes;
- extreme depth/yield values;
- exact duplicate fingerprints;
- same-date records within 100 m;
- unusual same-day operator submission bursts.

Signals receive deterministic severity/risk points. High or critical signals require an explicit `overrideRisk` plus a written override reason before verification.

These rules are review-assistance heuristics, not a learned fraud detector and not a groundwater confidence score.

## Server-computed operator trust

Phase 9 replaces the previous client-side contribution indicator with a versioned server trust profile.

Trust combines:

- smoothed verified/rejected review reliability;
- evidence/GPS/geology/outcome completeness;
- reviewed-record anomaly risk;
- amount of reviewed evidence;
- manual-flag penalty.

New operators are deliberately provisional: fewer than three reviewed records always display as `NEW`, and the score is shrunk toward a neutral 50 while review evidence is sparse.

Trust tiers after sufficient review history are:

```text
HIGH_TRUST  85–100
TRUSTED     70–84
BUILDING    50–69
WATCH        0–49
```

A score below 40 requires a documented trust-gate override before an admin may verify another record.

This is an operational reliability/review score. It is **not scientifically calibrated as a probability of operator honesty** and must not be represented as such.

## Append-only review audit

The existing audit collection is reused rather than adding a parallel datastore. Phase 9 review events use:

```text
scopeType = rig_verification
scopeId   = borewellId
```

Events include:

- review started;
- approved;
- rejected;
- review reopened;
- operator re-review requested;
- manually flagged for review;
- flag cleared.

Audit events preserve reviewer/operator identity, state transition, reasons, risk/signal snapshot, trust snapshots, override reasons and ledger effects.

There is no Phase 9 API to rewrite or delete review-history events.

## Manual flag semantics

Flagging a Phase 9 operator record immediately removes its trusted state:

```text
verified = false
verificationStatus = UNDER_REVIEW
dataset eligible = false
```

If the record had already closed accountability-ledger predictions, those predictions are reopened. The flag transition is appended to the verification audit.

Clearing a flag is also audited but does not restore trust automatically. A fresh review decision is required.

## Accountability ledger interaction

A Phase 9 verified record can close an open nearby prediction only when the prediction existed before drilling:

```text
prediction.createdAt <= borewell.drilledAt
```

Reopening/rejecting/flagging a trusted record reopens predictions previously closed by that record.

This preserves the Phase 8 temporal accountability correction while putting the authoritative truth decision behind Phase 9 review.

## Admin review UI

Added `/admin/review` with:

- lifecycle counts;
- suspicious/high-risk visibility;
- lifecycle filters;
- risk-prioritized queue;
- drilling/GPS/outcome details;
- geology intervals;
- evidence links;
- deterministic review signals;
- operator trust score/tier/explanation;
- start review;
- verify/promote;
- reject with reason;
- documented risk override;
- documented low-trust override;
- reopen review;
- flag/clear flag.

Operator-origin records in existing admin log views route into the review workflow instead of exposing one-click Verify.

## Operator UX

The operator dashboard now displays the server-generated trust profile and confidence in that score.

History shows explicit lifecycle states:

- Submitted
- Under review
- Verified
- Rejected

Rejected records allow the authenticated owner to submit a written re-review request. The appeal never promotes the record by itself.

## API delivered

Admin endpoints:

```text
GET  /api/admin/review/stats
GET  /api/admin/review/queue
GET  /api/admin/review/logs/:id
GET  /api/admin/review/logs/:id/audit
POST /api/admin/review/logs/:id/start
POST /api/admin/review/logs/:id/decision
POST /api/admin/review/logs/:id/reopen
GET  /api/admin/operators/:id/trust
```

Operator endpoints:

```text
GET  /api/operator/trust
GET  /api/borewells/:id/verification
POST /api/borewells/:id/request-review
```

## ML/training boundary

`server/featurePipeline.js` now requires Phase 9 lifecycle state `VERIFIED` for operator-origin training targets and historical nearby evidence.

Feature-dataset provenance explicitly records:

```text
phase9VerifiedLifecycleRequired = true
```

Therefore a boolean-only legacy state, `SUBMITTED`, `UNDER_REVIEW`, `REJECTED`, or flagged operator record cannot silently enter future retraining.

## Tests and CI

The final implementation/test head used for verification was:

```text
d5846b4129b5c7787a2307ac90cbdab6caf685f4
```

On that head:

- **Phase 9 Verification and Data Trust: success**
- **Phase 8 Rig Operator Data: success**
- **Phase 7 Real Prediction Engine: success**
- **Phase 6 ML Service: success**
- **Phase 5 Scientific Evaluation: success**
- **Phase 4 ML: success**
- Phase 9 web production build: **success**

Dedicated Phase 9 suite:

```text
10 passed
0 failed
0 skipped
```

It covers:

1. deterministic suspicious-data signals;
2. trust-score smoothing and reviewed-outcome response;
3. explicit lifecycle transition rules;
4. mandatory review-start before decision;
5. verification promotion + ledger scoring + trust persistence + audit;
6. high-risk verification override requirement;
7. rejection + operator re-review request;
8. lifecycle-required public/offline ML predicates;
9. legacy one-click Verify bypass prevention;
10. reopen-reason and manual-flag audit hardening.

Phase 8 regression suite and Phase 7 Node prediction-contract suite also pass on the descendant branch.

## CI issues caught during implementation

CI caught intentional contract drift in older Phase 8 tests: those tests were still using the Phase 8 transitional direct operator Verify endpoint. They were updated on the Phase 9 descendant branch to assert that the shortcut is now rejected, while retaining Phase 2 imported-record compatibility.

A separate hardening pass found that decided records could otherwise reuse the generic review-start transition and avoid the dedicated reopen reason. The start endpoint is now restricted to `SUBMITTED`; `VERIFIED`/`REJECTED` records must use the documented reopen route.

Manual flag transitions are now explicitly audited and reopen any linked ledger truth before the record can be reconsidered.

## Security/deployment findings carried forward

Latest CI dependency installation still reports:

```text
server: 4 vulnerabilities (3 moderate, 1 high)
web:    8 vulnerabilities (3 moderate, 5 high)
```

These remain explicit **Phase 15 production-security blockers**. Phase 9 does not apply an unreviewed `npm audit fix --force` because breaking dependency upgrades need to be evaluated deliberately.

Phase 18 still owns durable/private production evidence storage, backups, retention, deployment secrets, monitoring and disaster recovery. The Phase 8 filesystem storage adapter remains an application-level contract, not a production durability claim.

## Scientific honesty boundary

Phase 9 does not produce or modify BoreSakshi groundwater-model Accuracy/Precision/Recall/F1/ROC-AUC/Brier/MAE/RMSE/R² metrics. Those remain Phase 5 scientific-validation concerns.

The Phase 9 risk and operator-trust scores are deterministic operational review tools. No production fraud-detection accuracy or calibrated trust probability is claimed.

## Phase 10 handoff

Phase 10 — Continuous Learning should consume only outcomes satisfying the complete Phase 9 trusted predicate.

It must preserve:

- review/audit provenance;
- spatial/temporal leakage controls;
- scientific evaluation before model selection;
- human approval before model promotion;
- rollback/versioning of promoted models.

Verified new data may trigger a retraining candidate, but it must **not automatically deploy a new groundwater model**.

## Final Phase 9 status

**Phase 9 software implementation: COMPLETE.**  
**Formal verification/data-trust gate: PASS.**  
**PR merge: intentionally not performed — review gate remains open.**
