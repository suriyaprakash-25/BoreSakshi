// LogItem.jsx — one log card used by operator/admin views.
import { useState } from "react";
import {
  MapPin, Droplets, DropletOff, Ruler, Waves, Layers, BadgeCheck, Flag, FlagOff,
  Clock3, Camera, Video, LocateFixed,
} from "lucide-react";
import toast from "react-hot-toast";
import { placeLabel, fmtDate } from "../metrics.js";

export default function LogItem({ log, showOperator = false, adminActions = null }) {
  const [flagging, setFlagging] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn, successMsg) {
    setBusy(true);
    try {
      await fn();
      if (successMsg) toast.success(successMsg);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const photoCount = log.evidenceSummary?.photoCount ?? (log.evidence || []).filter((item) => item.kind === "photo").length;
  const videoCount = log.evidenceSummary?.videoCount ?? (log.evidence || []).filter((item) => item.kind === "video").length;

  return (
    <li className={`card log-card ${log.flagged ? "is-flagged" : ""}`}>
      <div className="log-card-top">
        <div className="log-card-main">
          <div className="log-card-place">
            <MapPin size={15} strokeWidth={2.2} /> {placeLabel(log)}
            {log.verified ? (
              <span className="log-badge verified" title="Verified log">
                <BadgeCheck size={13} strokeWidth={2.4} /> Verified
              </span>
            ) : (
              <span className="log-badge" title="Submitted and awaiting verification">
                <Clock3 size={13} strokeWidth={2.4} /> Pending verification
              </span>
            )}
          </div>
          <div className="log-card-sub">
            {fmtDate(log.drilledAt || log.createdAt)}
            {log.drillingDate ? <> · drilled {log.drillingDate}</> : null}
            {showOperator && log.operatorName && <> · <span className="log-card-op">{log.operatorName}</span></>}
          </div>
        </div>

        <div className="log-card-badges">
          <span className={`hist-badge ${log.success ? "ok" : "dry"}`}>
            {log.success ? <Droplets size={14} strokeWidth={2.2} /> : <DropletOff size={14} strokeWidth={2.2} />}
            {log.success ? "Water found" : "Dry hole"}
          </span>
          {log.flagged && (
            <span className="log-badge flagged" title={log.flagReason || "Flagged for review"}>
              <Flag size={13} strokeWidth={2.4} /> Flagged
            </span>
          )}
        </div>
      </div>

      <div className="hist-item-facts">
        <span><Ruler size={13} strokeWidth={2.2} /> {log.depthFt != null ? `${log.depthFt} ft` : "—"} depth</span>
        <span><Droplets size={13} strokeWidth={2.2} /> {log.waterStrikeFt ? `${log.waterStrikeFt} ft` : "—"} strike</span>
        <span><Waves size={13} strokeWidth={2.2} /> {log.yieldLpm ? `${log.yieldLpm} LPM` : "—"}</span>
        <span><Layers size={13} strokeWidth={2.2} /> {log.geologicalLayers?.length ? `${log.geologicalLayers.length} layer${log.geologicalLayers.length === 1 ? "" : "s"}` : (log.strata || "—")}</span>
        {log.gps?.accuracyM != null && <span><LocateFixed size={13} strokeWidth={2.2} /> GPS ±{log.gps.accuracyM} m</span>}
        {photoCount > 0 && <span><Camera size={13} strokeWidth={2.2} /> {photoCount} photo{photoCount === 1 ? "" : "s"}</span>}
        {videoCount > 0 && <span><Video size={13} strokeWidth={2.2} /> {videoCount} video{videoCount === 1 ? "" : "s"}</span>}
      </div>

      {log.flagged && log.flagReason && (
        <div className="log-flag-note">
          <Flag size={13} strokeWidth={2.2} /> {log.flagReason}
          {log.flaggedBy ? <span className="log-flag-by"> — flagged by {log.flaggedBy}</span> : null}
        </div>
      )}

      {adminActions && (
        flagging ? (
          <div className="log-actions log-flag-form">
            <input className="op-input log-flag-input" placeholder="Reason for flag (optional) — e.g. implausible yield"
              value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            <button className="btn btn-primary btn-sm" disabled={busy}
              onClick={() => run(async () => { await adminActions.flagLog(log.id, reason); setFlagging(false); setReason(""); }, "Log flagged successfully")}>
              <Flag size={14} strokeWidth={2.2} /> Flag
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setFlagging(false); setReason(""); }}>Cancel</button>
          </div>
        ) : (
          <div className="log-actions">
            {log.flagged ? (
              <button className="btn btn-ghost btn-sm" disabled={busy}
                onClick={() => run(() => adminActions.clearFlag(log.id), "Flag cleared")}>
                <FlagOff size={14} strokeWidth={2.2} /> Clear flag
              </button>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => setFlagging(true)}>
                <Flag size={14} strokeWidth={2.2} /> Flag
              </button>
            )}
            <button className={`btn btn-ghost btn-sm ${log.verified ? "is-on" : ""}`} disabled={busy}
              onClick={() => run(() => adminActions.setLogVerified(log.id, !log.verified), log.verified ? "Log moved back to pending" : "Log verified — ledger eligibility updated")}>
              <BadgeCheck size={14} strokeWidth={2.2} /> {log.verified ? "Unverify" : "Verify"}
            </button>
          </div>
        )
      )}
    </li>
  );
}
