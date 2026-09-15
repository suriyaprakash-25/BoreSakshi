// metrics.js — pure helpers for operator/admin stats.
// Phase 8 trust rule: outcome/groundwater/trust metrics use verified, unflagged,
// dataset-eligible records only. Submission/activity counts may include pending logs.

export const STRATA_BUCKETS = [
  { key: "weathered",  label: "Weathered rock",        color: "#8fd4e6" },
  { key: "wfract",     label: "Weathered / fractured", color: "#57b3cc" },
  { key: "fractured",  label: "Fractured granite",     color: "#2f90a8" },
  { key: "hard",       label: "Hard crystalline rock", color: "#216f88" },
  { key: "compact",    label: "Compact granite",       color: "#12415f" },
  { key: "other",      label: "Other / unspecified",   color: "#b8c4cf" },
];

export function classifyStrata(strata) {
  const s = String(strata || "").toLowerCase();
  if (s.includes("weathered") && s.includes("fract")) return "wfract";
  if (s.includes("weathered")) return "weathered";
  if (s.includes("fractured")) return "fractured";
  if (s.includes("hard") || s.includes("crystalline")) return "hard";
  if (s.includes("compact") || s.includes("granite")) return "compact";
  return "other";
}

export function trustedOutcomeLogs(logs) {
  return (logs || []).filter((log) =>
    log?.verified === true &&
    log?.flagged !== true &&
    log?.datasetEligibility?.eligible !== false
  );
}

export function successRate(logs) {
  const trusted = trustedOutcomeLogs(logs);
  if (!trusted.length) return null;
  const wins = trusted.filter((l) => l.success).length;
  return Math.round((wins / trusted.length) * 100);
}

export function averageDepth(logs) {
  const depths = trustedOutcomeLogs(logs).map((l) => l.depthFt).filter((d) => typeof d === "number");
  if (!depths.length) return null;
  return Math.round(depths.reduce((a, b) => a + b, 0) / depths.length);
}

export function logsThisWeek(logs) {
  const weekAgo = Date.now() - 7 * 86400000;
  return logs.filter((l) => new Date(l.createdAt).getTime() >= weekAgo).length;
}

// Operational submission-volume chart: deliberately includes pending submissions.
export function logsPerMonth(logs, months = 6) {
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleString("en", { month: "short" }),
      year: d.getFullYear(),
      count: 0,
    });
  }
  const index = new Map(buckets.map((b) => [b.key, b]));
  for (const l of logs) {
    const d = new Date(l.createdAt);
    const b = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (b) b.count++;
  }
  return buckets;
}

export function strataBreakdown(logs) {
  const counts = new Map();
  for (const l of trustedOutcomeLogs(logs)) {
    const k = classifyStrata(l.strata);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return STRATA_BUCKETS
    .map((b) => ({ ...b, count: counts.get(b.key) || 0 }))
    .filter((b) => b.count > 0);
}

// Legacy contribution indicator retained only for UI continuity until Phase 9
// replaces it with the production trust model. Even this indicator uses verified
// outcomes only so pending/flagged data cannot boost a trust-related metric.
export const VERIFIED_TRUST_BONUS = 12;

export function trustScore(logs, { verified = false } = {}) {
  const trusted = trustedOutcomeLogs(logs);
  let base = 0;
  if (trusted.length) {
    const volume = Math.min(1, trusted.length / 20);
    const completeness =
      trusted.reduce((sum, l) => {
        const expected = ["depthFt", "strata"];
        if (l.success) expected.push("waterStrikeFt", "yieldLpm");
        const filled = expected.filter((f) => l[f] !== null && l[f] !== undefined && l[f] !== "").length;
        return sum + filled / expected.length;
      }, 0) / trusted.length;
    const newest = Math.max(...trusted.map((l) => new Date(l.createdAt).getTime()));
    const days = (Date.now() - newest) / 86400000;
    const recency = days <= 30 ? 1 : days <= 60 ? 0.5 : 0;
    base = Math.round(100 * (0.5 * volume + 0.35 * completeness + 0.15 * recency));
  }

  const bonus = verified ? VERIFIED_TRUST_BONUS : 0;
  const score = Math.min(100, base + bonus);
  const label = score >= 75 ? "Trusted" : score >= 50 ? "Building" : score >= 25 ? "Getting started" : "New operator";
  return { score, base, bonus, label, verified };
}

export function lastActiveAt(logs) {
  if (!logs.length) return null;
  return logs.reduce((m, l) => Math.max(m, new Date(l.createdAt).getTime()), 0);
}

export function activeWithin(logs, days) {
  const last = lastActiveAt(logs);
  return last != null && Date.now() - last <= days * 86400000;
}

export function filterLogs(logs, { query = "", outcome = "all" } = {}) {
  const q = query.trim().toLowerCase();
  return logs.filter((l) => {
    if (outcome === "water" && !l.success) return false;
    if (outcome === "dry" && l.success) return false;
    if (!q) return true;
    return (
      placeLabel(l).toLowerCase().includes(q) ||
      (l.placeName || "").toLowerCase().includes(q) ||
      (l.strata || "").toLowerCase().includes(q) ||
      (l.operatorName || "").toLowerCase().includes(q)
    );
  });
}

export function operatorRow(operator, allLogs) {
  const logs = allLogs.filter((l) => l.operatorId === operator.id);
  return {
    operator,
    logs,
    count: logs.length,
    verifiedCount: trustedOutcomeLogs(logs).length,
    successRate: successRate(logs),
    avgDepth: averageDepth(logs),
    lastActiveAt: lastActiveAt(logs),
    trust: trustScore(logs, { verified: operator.verified }).score,
  };
}
export function operatorRows(operators, allLogs) {
  return operators.map((o) => operatorRow(o, allLogs));
}

export function placeLabel(log) {
  return log.placeName?.trim() || `${log.lat.toFixed(3)}, ${log.lng.toFixed(3)}`;
}

export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}
