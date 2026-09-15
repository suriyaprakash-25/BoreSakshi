import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle, BadgeCheck, Camera, CheckCircle2, Clock3, ExternalLink,
  Eye, Flag, Loader2, RotateCcw, ShieldCheck, ShieldAlert, XCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import AppHeader from "../../components/AppHeader.jsx";
import { rigEvidenceUrl } from "../../api.js";
import { useAdminData } from "../../adminData.jsx";
import { fmtDate, placeLabel } from "../../metrics.js";

const STATUS_OPTIONS = [
  ["", "Pending review"],
  ["SUBMITTED", "Submitted"],
  ["UNDER_REVIEW", "Under review"],
  ["VERIFIED", "Verified"],
  ["REJECTED", "Rejected"],
];

function riskClass(level) {
  if (level === "critical" || level === "high") return "dry";
  if (level === "medium") return "warn";
  return "ok";
}

export default function ReviewQueue() {
  const {
    reviewQueue,
    reviewStats,
    logs,
    loading,
    refreshReview,
    startReview,
    decideReview,
    reopenReview,
    flagLog,
    clearFlag,
  } = useAdminData();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState(params.get("record") || "");
  const [decisionReason, setDecisionReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideRisk, setOverrideRisk] = useState(false);
  const [overrideTrust, setOverrideTrust] = useState(false);
  const [busy, setBusy] = useState(false);

  const source = status
    ? logs.filter((record) => record?.provenance?.sourceType === "operator" && record.verificationStatus === status)
    : reviewQueue;
  const selected = useMemo(() => source.find((item) => item.id === selectedId) || reviewQueue.find((item) => item.id === selectedId) || logs.find((item) => item.id === selectedId) || source[0] || null,
    [source, reviewQueue, logs, selectedId]);

  function choose(id) {
    setSelectedId(id);
    setParams(id ? { record: id } : {});
    setDecisionReason("");
    setOverrideReason("");
    setOverrideRisk(false);
    setOverrideTrust(false);
  }

  async function run(action, success) {
    setBusy(true);
    try {
      const result = await action();
      toast.success(success);
      await refreshReview();
      if (result?.record?.id) choose(result.record.id);
      return result;
    } catch (error) {
      const details = error?.body?.blockingSignalCodes?.length
        ? ` (${error.body.blockingSignalCodes.join(", ")})`
        : "";
      toast.error(`${error.message}${details}`);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleStart(record) {
    await run(() => startReview(record.id, "Review started from Phase 9 admin queue"), "Review started");
  }

  async function handleDecision(record, decision) {
    const payload = {
      decision,
      decisionReason,
      overrideRisk,
      overrideTrustGate: overrideTrust,
      overrideReason,
    };
    const result = await run(
      () => decideReview(record.id, payload),
      decision === "verify" ? "Submission verified and promoted" : "Submission rejected",
    );
    if (result) {
      setDecisionReason("");
      setOverrideReason("");
      setOverrideRisk(false);
      setOverrideTrust(false);
    }
  }

  async function handleReopen(record) {
    const reason = decisionReason.trim();
    if (reason.length < 10) return toast.error("Enter a reopen reason of at least 10 characters");
    await run(() => reopenReview(record.id, reason), "Review reopened");
  }

  return (
    <div className="op">
      <AppHeader subtitle="Verification & data trust" />
      <div className="admin-body op-anim">
        <header className="hist-head">
          <h1>Verification review</h1>
          <p className="hist-summary">Human-reviewed promotion of rig outcomes into trusted groundwater evidence.</p>
        </header>

        <section className="dash-stats">
          <Stat label="Submitted" value={reviewStats?.counts?.SUBMITTED ?? "—"} />
          <Stat label="Under review" value={reviewStats?.counts?.UNDER_REVIEW ?? "—"} />
          <Stat label="Verified" value={reviewStats?.counts?.VERIFIED ?? "—"} />
          <Stat label="Rejected" value={reviewStats?.counts?.REJECTED ?? "—"} />
          <Stat label="Suspicious" value={reviewStats?.suspicious ?? "—"} />
        </section>

        <div className="card alllogs-controls">
          <div className="adminmap-field">
            <span>Status</span>
            <select className="op-input" value={status} onChange={(e) => { setStatus(e.target.value); choose(""); }}>
              {STATUS_OPTIONS.map(([value, label]) => <option key={value || "pending"} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="alllogs-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => refreshReview()} disabled={busy}>Refresh</button>
          </div>
        </div>

        {loading && !source.length ? (
          <div className="dash-loading"><Loader2 className="spin" size={28} /> Loading review queue…</div>
        ) : !source.length ? (
          <div className="card hist-empty"><CheckCircle2 size={28} /><p>No submissions in this review state.</p></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 0.8fr) minmax(0, 1.8fr)", gap: 16, alignItems: "start" }}>
            <ul className="hist-list" style={{ margin: 0 }}>
              {source.map((record) => {
                const analysis = record.verificationPreview || record.verification || {};
                return (
                  <li key={record.id} className={`card log-card ${selected?.id === record.id ? "is-on" : ""}`} onClick={() => choose(record.id)} style={{ cursor: "pointer" }}>
                    <div className="log-card-place">{placeLabel(record)}</div>
                    <div className="log-card-sub">{record.operatorName} · {fmtDate(record.submittedAt || record.createdAt)}</div>
                    <div className="hist-item-facts">
                      <span><Clock3 size={13} /> {record.verificationStatus || "SUBMITTED"}</span>
                      <span className={`hist-badge ${riskClass(analysis.riskLevel)}`}>
                        <ShieldAlert size={13} /> risk {analysis.riskScore ?? 0}/100
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {selected && (
              <ReviewPanel
                record={selected}
                busy={busy}
                decisionReason={decisionReason}
                setDecisionReason={setDecisionReason}
                overrideReason={overrideReason}
                setOverrideReason={setOverrideReason}
                overrideRisk={overrideRisk}
                setOverrideRisk={setOverrideRisk}
                overrideTrust={overrideTrust}
                setOverrideTrust={setOverrideTrust}
                onStart={handleStart}
                onDecision={handleDecision}
                onReopen={handleReopen}
                onFlag={() => run(() => selected.flagged ? clearFlag(selected.id) : flagLog(selected.id, "Flagged during Phase 9 verification review"), selected.flagged ? "Flag cleared — record still requires review" : "Record flagged for review")}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return <div className="card stat-card"><div className="stat-card-value">{value}</div><div className="stat-card-label">{label}</div></div>;
}

function ReviewPanel({
  record, busy, decisionReason, setDecisionReason, overrideReason, setOverrideReason,
  overrideRisk, setOverrideRisk, overrideTrust, setOverrideTrust,
  onStart, onDecision, onReopen, onFlag,
}) {
  const analysis = record.verificationPreview || record.verification || { signals: [], riskScore: 0, riskLevel: "clear" };
  const trust = record.operatorTrust || record.verification?.operatorTrustAtDecision || record.operatorTrustAfterDecision;
  const status = record.verificationStatus || "SUBMITTED";

  return (
    <section className="card" style={{ padding: 20 }}>
      <div className="dash-card-head">
        <div>
          <div className="dash-card-title"><Eye size={16} /> {placeLabel(record)}</div>
          <div className="log-card-sub">{record.operatorName} · {record.drillingDate || record.drilledDate}</div>
        </div>
        <span className={`hist-badge ${status === "VERIFIED" ? "ok" : status === "REJECTED" ? "dry" : ""}`}>{status}</span>
      </div>

      <div className="hist-item-facts" style={{ marginTop: 12 }}>
        <span>Depth {record.depthFt} ft</span>
        <span>Strike {record.waterStrikeFt ?? "—"} ft</span>
        <span>Yield {record.yieldLpm ?? "—"} LPM</span>
        <span>GPS ±{record.gps?.accuracyM ?? "—"} m</span>
        <span>{record.success ? "Water found" : "Dry hole"}</span>
      </div>

      <div className="op-ledger-note" style={{ marginTop: 14 }}>
        <ShieldCheck size={19} />
        <div>
          <strong>Operator trust: {trust?.score ?? "—"}/100 · {trust?.tier || "NEW"}</strong>
          <div>{trust?.explanation || "Trust is computed server-side from reviewed outcomes, evidence quality and anomaly risk."}</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="dash-card-title"><ShieldAlert size={16} /> Deterministic review signals · {analysis.riskScore ?? 0}/100</div>
        {(analysis.signals || []).length ? (
          <ul className="hist-list" style={{ marginTop: 8 }}>
            {analysis.signals.map((signal) => (
              <li className="card log-card" key={signal.code} style={{ padding: 12 }}>
                <div className="log-card-place"><AlertTriangle size={14} /> {signal.code} · {signal.severity}</div>
                <div className="log-card-sub">{signal.message}</div>
              </li>
            ))}
          </ul>
        ) : <div className="dash-empty-row">No deterministic review signals detected.</div>}
      </div>

      {record.geologicalLayers?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="dash-card-title">Geological layers</div>
          <div className="hist-item-facts">
            {record.geologicalLayers.map((layer, index) => <span key={index}>{layer.fromFt}–{layer.toFt} ft · {layer.material}</span>)}
          </div>
        </div>
      )}

      {(record.evidence || []).length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="dash-card-title"><Camera size={16} /> Evidence</div>
          <div className="log-actions">
            {record.evidence.map((item, index) => (
              <a className="btn btn-ghost btn-sm" key={item.id} href={rigEvidenceUrl(record.id, item.id)} target="_blank" rel="noreferrer">
                {item.kind === "photo" ? `Photo ${index + 1}` : `Video ${index + 1}`} <ExternalLink size={12} />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="op-field" style={{ marginTop: 18 }}>
        <label className="op-label">Decision / reopen reason</label>
        <textarea className="op-input" rows="3" value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)}
          placeholder="Required for rejection/reopen; optional note for verification." />
      </div>

      {status === "UNDER_REVIEW" && (
        <>
          <div className="op-field">
            <label className="op-label">Documented override</label>
            <label><input type="checkbox" checked={overrideRisk} onChange={(e) => setOverrideRisk(e.target.checked)} /> Accept high/critical review signals</label><br />
            <label><input type="checkbox" checked={overrideTrust} onChange={(e) => setOverrideTrust(e.target.checked)} /> Override low operator-trust gate</label>
            {(overrideRisk || overrideTrust) && (
              <textarea className="op-input" rows="2" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Override reason (minimum 10 characters)" />
            )}
          </div>
          <div className="log-actions">
            <button className="btn btn-primary btn-sm" disabled={busy || record.flagged} onClick={() => onDecision(record, "verify")}>
              <BadgeCheck size={15} /> Verify & promote
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onDecision(record, "reject")}>
              <XCircle size={15} /> Reject
            </button>
          </div>
        </>
      )}

      {status === "SUBMITTED" && (
        <div className="log-actions">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onStart(record)}><ShieldCheck size={15} /> Start review</button>
        </div>
      )}

      {(status === "VERIFIED" || status === "REJECTED") && (
        <div className="log-actions">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onReopen(record)}><RotateCcw size={15} /> Reopen review</button>
        </div>
      )}

      <div className="log-actions">
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onFlag}>
          <Flag size={14} /> {record.flagged ? "Clear flag" : "Flag for review"}
        </button>
      </div>

      {record.reviewDecisionReason && <div className="log-flag-note">Last decision: {record.reviewDecisionReason}</div>}
    </section>
  );
}
