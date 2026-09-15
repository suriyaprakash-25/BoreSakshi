# Borewell domain model — Phase 1 increment

## Purpose

This document describes the MongoDB-compatible domain foundation introduced without
rewriting the working MVP. PostgreSQL + PostGIS remains the planned long-term
geospatial store; it is not part of this increment.

## Borewell

A Borewell is a long-lived physical asset and ledger identity.

| Field | Meaning |
|---|---|
| `id` | Internal application ID |
| `publicId` | Shareable, non-sequential ID such as `BW-...` |
| `lat`, `lng` | Exact coordinates, restricted by API authorization |
| `gpsAccuracyM` | Device-reported accuracy when supplied |
| `drillingDate` | Date/time the borewell was drilled |
| `depthFt`, `waterStrikeFt`, `yieldLpm` | Initial drilling measurements |
| `geology`, `strata` | Initial geological description; `strata` remains for MVP compatibility |
| `status` | `ACTIVE`, `LOW_YIELD`, `DRY`, `ABANDONED`, `RECHARGE_CANDIDATE`, or `RECHARGED` |
| `verificationStatus` | `SUBMITTED`, `UNDER_REVIEW`, `VERIFIED`, or `REJECTED` |
| `createdBy`, `operatorId` | Authenticated operator provenance |
| `verifiedBy`, `verifiedAt` | Verification audit metadata |

New drill logs start as `SUBMITTED`; their status is `ACTIVE` if water was
found and `DRY` otherwise. Only non-flagged verified records are eligible for
prediction evidence.

## Borewell observation

A BorewellObservation is a time-stamped fact about a Borewell. The first
observation is created automatically with type `DRILLING` for every newly logged
borewell.

```
Borewell BW-...
  └── BorewellObservation (DRILLING)
```

Future increments can append water-level, yield, maintenance, and recharge
observations without overwriting the original drilling result.

## Compatibility and migration

Existing records remain valid. During the incremental migration:

- `verified: true` is still accepted as verified data.
- New records use both `verified` and `verificationStatus` so older UI/API
  consumers continue working.
- Public IDs and observations are present for newly created records first.
- A dedicated, reversible backfill job must be reviewed before adding these
  fields to historical data.
- No production model will use unverified records, regardless of old/new shape.

## PostGIS direction

Before moving data, create a separate migration plan covering field mapping,
coordinate validation, spatial indexes, backfill batches, rollback, dual-read
validation, and a cutover decision. Do not migrate production records directly
from this document.


## Observation API

These routes require an authenticated cookie session. Write requests also require the
per-session `X-CSRF-Token` header.

| Route | Purpose |
|---|---|
| `GET /api/borewells/:id/observations` | Read observations for an owned borewell; admins may read any borewell |
| `POST /api/borewells/:id/observations` | Append a `WATER_LEVEL`, `YIELD`, or `MAINTENANCE` observation |

Operators may only access borewells they created. The API never updates or deletes
the initial drilling observation; corrections must be represented by a later
observation and a reviewed audit process.
