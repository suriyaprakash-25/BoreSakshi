// ledgerMatching.js — decides which prediction a verified drill outcome scores.
// One well scores at most one prediction, so a single outcome cannot be counted
// repeatedly. A prediction the operator linked by code wins; otherwise the nearest
// open prediction inside MATCH_RADIUS_KM is used. NEAR_KM (5 km) is deliberately
// not used here: it is an evidence radius, too wide to say a pin was "right".
import { nanoid } from "nanoid";
import { distanceKm } from "./predict.js";
import { reopenPredictionAccountability, scorePredictionAgainstOutcome } from "./accountability.js";

export const MATCH_RADIUS_KM = Number(process.env.LEDGER_MATCH_RADIUS_KM || 0.25);
export const LINKED_MATCH_RADIUS_KM = 1;
export const MATCH_WINDOW_DAYS = Number(process.env.LEDGER_MATCH_WINDOW_DAYS || 365);
const DAY_MS = 24 * 60 * 60 * 1000;

async function appendAudit(db, { prediction, action, actor, details, now }) {
  if (typeof db.addIngestionAudit !== "function") return;
  await db.addIngestionAudit({
    id: nanoid(14),
    batchId: null,
    recordId: null,
    scopeType: "prediction_accountability",
    scopeId: prediction.id,
    action,
    actor: actor ? { id: actor.id, name: actor.name, role: actor.role || "admin" } : { id: "system", name: "BoreSakshi", role: "system" },
    details,
    createdAt: now,
  });
}

// A prediction only counts if it was issued before drilling and is recent enough
// to still be the advice that drilling acted on. Fallback records never score.
function eligible(prediction, drilledAtMs) {
  if (!prediction || prediction.actual != null) return false;
  if (prediction.predictionSource === "heuristic_fallback") return false;
  const predictionAtMs = Date.parse(prediction.createdAt || prediction.predictionTimestamp || "");
  if (!Number.isFinite(predictionAtMs) || !Number.isFinite(drilledAtMs)) return false;
  return predictionAtMs <= drilledAtMs && drilledAtMs - predictionAtMs <= MATCH_WINDOW_DAYS * DAY_MS;
}

async function candidatesFor(db, record, drilledAtMs) {
  const point = { lat: record.lat, lng: record.lng };
  const withDistance = (prediction) => ({ prediction, matchDistanceKm: distanceKm(point, prediction) });
  const candidates = [];
  if (record.predictionId) {
    const linked = await db.getPrediction(record.predictionId);
    if (eligible(linked, drilledAtMs) && distanceKm(point, linked) <= LINKED_MATCH_RADIUS_KM) {
      candidates.push(withDistance(linked));
    }
  }
  const nearby = await db.findOpenPredictionsNear({ ...point, radiusKm: MATCH_RADIUS_KM });
  candidates.push(...nearby
    .filter((prediction) => eligible(prediction, drilledAtMs) && prediction.id !== record.predictionId)
    .map(withDistance)
    .sort((a, b) => a.matchDistanceKm - b.matchDistanceKm));
  return candidates;
}

export async function scoreVerifiedOutcome({ db, record, now, actor }) {
  const drilledAtMs = Date.parse(record.drilledAt || record.drilledDate || "");
  for (const { prediction, matchDistanceKm } of await candidatesFor(db, record, drilledAtMs)) {
    const patch = scorePredictionAgainstOutcome(prediction, record, { now, matchDistanceKm });
    // Atomic: if a concurrent review already closed this one, try the next.
    if (!await db.claimPredictionOutcome(prediction.id, patch)) continue;
    await appendAudit(db, {
      prediction,
      action: "verified_outcome_scored",
      actor,
      now,
      details: {
        borewellId: record.id,
        verificationStatus: record.verificationStatus || (record.verified ? "VERIFIED" : "UNKNOWN"),
        matchDistanceKm,
        linkedByCode: record.predictionId === prediction.id,
        successCorrect: patch.correct,
        metrics: patch.accountability.metrics,
      },
    });
    return 1;
  }
  return 0;
}

export async function reopenPredictionsForRecord(db, borewellId, { actor, reason, now }) {
  let reopened = 0;
  for (const prediction of await db.getPredictionsByOutcome(borewellId)) {
    await db.updatePrediction(prediction.id, reopenPredictionAccountability(prediction, { now, reason }));
    await appendAudit(db, { prediction, action: "outcome_reopened", actor, now, details: { borewellId, reason } });
    reopened += 1;
  }
  return reopened;
}
