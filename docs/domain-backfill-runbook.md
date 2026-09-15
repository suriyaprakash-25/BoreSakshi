# Legacy borewell domain backfill runbook

## Purpose

This runbook upgrades existing MongoDB borewell records to the incremental Phase 1
domain shape. It is not a PostgreSQL/PostGIS migration and does not retrain or
deploy any ML model.

The backfill only fills missing fields:

- `publicId`
- `drillingDate`
- `status`
- `verificationStatus`
- `geology`
- `createdBy` when an operator ID exists
- one missing `DRILLING` observation per borewell

It does not alter supplied drilling measurements, outcomes, flags, or verification
decisions.

## Required safeguards

1. Run the current CI checks successfully.
2. Back up the target MongoDB database and verify restore instructions.
3. Run the dry run against the exact target environment.
4. Review the resulting counts and a sample of candidate records.
5. Obtain the deployment review approval.
6. Run the apply command once.
7. Verify counts, unique public IDs, and one drilling observation per migrated borewell.
8. Retain the backup until post-deployment validation is complete.

## Commands

From `server/`:

```bash
npm run backfill:domain:dry
# Only after backup + review:
npm run backfill:domain:apply
```

The default command is read-only. The apply command is intentional and must never
be added to CI or run automatically at application startup.

## Rollback

Restore the database backup. Do not attempt an ad-hoc delete of public IDs or
observations in production, because a new record may have been created after the
backfill and may legitimately contain the same domain fields.
