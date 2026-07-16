// OperatorDetail.jsx (/admin/operators/:id) — full admin view of one operator.
import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Phone, CalendarDays, BadgeCheck, ShieldCheck, Ban, Power,
  Download, ListChecks, Droplets, Ruler, Loader2,
} from "lucide-react";
import AppHeader from "../../components/AppHeader.jsx";
import ProbabilityRing from "../../components/ProbabilityRing.jsx";
import LogFilters from "../../components/LogFilters.jsx";
import LogItem from "../../components/LogItem.jsx";
import { useAdminData } from "../../adminData.jsx";
import { downloadCSV } from "../../csv.js";
import {
  successRate, averageDepth, logsThisWeek, trustScore, filterLogs, fmtDate,
} from "../../metrics.js";

export default function OperatorDetail() {
  const { id } = useParams();
  const {
    operators, logs, loading,
    setOperatorStatus, setOperatorVerified, flagLog, clearFlag, setLogVerified,
  } = useAdminData();

  const operator = operators.find((o) => o.id === id);
  const opLogs = useMemo(() => logs.filter((l) => l.operatorId === id), [logs, id]);

  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [confirming, setConfirming] = useState(null); // "deactivate" | "reactivate" | null
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => filterLogs(opLogs, { query, outcome }), [opLogs, query, outcome]);

  if (loading && !operator) {
    return (
      <div className="op"><AppHeader subtitle="Operator" />
        <div className="admin-body"><div className="dash-loading"><Loader2 className="spin" size={30} /> Loading…</div></div>
      </div>
    );
  }
  if (!operator) {
    return (
      <div className="op"><AppHeader subtitle="Operator" />
        <div className="admin-body">
          <Link to="/admin/operators" className="admin-back"><ArrowLeft size={16} strokeWidth={2.2} /> Back to operators</Link>
          <div className="card hist-empty"><p>Operator not found.</p></div>
        </div>
      </div>
    );
  }

  const deactivated = operator.status === "deactivated";
  const trust = trustScore(opLogs, { verified: operator.verified });
  const rate = successRate(opLogs);
  const adminActions = { flagLog, clearFlag, setLogVerified };

  async function act(fn) {
    setBusy(true);
    try { await fn(); setConfirming(null); } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="op">
      <AppHeader subtitle="Operator" />
      <div className="admin-body op-anim">
        <Link to="/admin/operators" className="admin-back"><ArrowLeft size={16} strokeWidth={2.2} /> Back to operators</Link>

        {/* profile + trust */}
        <section className="dash-top">
          <div className="card detail-profile">
            <div className="detail-name">
              {operator.name}
              {operator.verified && <span className="log-badge verified"><BadgeCheck size={13} strokeWidth={2.4} /> Verified</span>}
              {deactivated && <span className="status-pill off">Deactivated</span>}
            </div>
            <div className="detail-meta"><Phone size={14} strokeWidth={2.2} /> {operator.phone}</div>
            <div className="detail-meta"><CalendarDays size={14} strokeWidth={2.2} /> Joined {fmtDate(operator.createdAt)}</div>

            <div className="detail-actions">
              <button className={`btn btn-ghost btn-sm ${operator.verified ? "is-on" : ""}`} disabled={busy}
                onClick={() => act(() => setOperatorVerified(operator.id, !operator.verified))}>
                <ShieldCheck size={15} strokeWidth={2.2} /> {operator.verified ? "Remove verification" : "Verify operator"}
              </button>

              {confirming ? (
                <span className="confirm-inline">
                  {deactivated ? "Reactivate this account?" : "Deactivate this account?"}
                  <button className="btn btn-primary btn-sm" disabled={busy}
                    onClick={() => act(() => setOperatorStatus(operator.id, deactivated ? "active" : "deactivated"))}>
                    Yes, {deactivated ? "reactivate" : "deactivate"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)}>Cancel</button>
                </span>
              ) : (
                <button className={`btn btn-ghost btn-sm ${deactivated ? "" : "danger"}`}
                  onClick={() => setConfirming(deactivated ? "reactivate" : "deactivate")}>
                  {deactivated ? <><Power size={15} strokeWidth={2.2} /> Reactivate</> : <><Ban size={15} strokeWidth={2.2} /> Deactivate</>}
                </button>
              )}
            </div>
          </div>

          <div className="card dash-trust">
            <div className="dash-trust-head">
              <span className="dash-card-title">Trust score</span>
              {operator.verified && <span className="dash-trust-badge">+{trust.bonus} verified</span>}
            </div>
            <ProbabilityRing value={trust.score} size={140} suffix="" label={trust.label} />
            <p className="dash-trust-note">
              {operator.verified ? `Base ${trust.base} + ${trust.bonus} verification bonus.` : "Volume, completeness and recency."}
            </p>
          </div>
        </section>

        {/* stats — same shape as the operator's own dashboard */}
        <section className="dash-stats">
          <Stat icon={<ListChecks size={18} strokeWidth={2.2} />} value={opLogs.length} label="Wells logged" />
          <Stat icon={<Droplets size={18} strokeWidth={2.2} />} value={rate != null ? `${rate}%` : "—"} label="Water-strike rate" accent />
          <Stat icon={<Ruler size={18} strokeWidth={2.2} />} value={averageDepth(opLogs) != null ? `${averageDepth(opLogs)} ft` : "—"} label="Avg. total depth" />
          <Stat icon={<CalendarDays size={18} strokeWidth={2.2} />} value={logsThisWeek(opLogs)} label="Logged this week" />
        </section>

        {/* logs */}
        <section>
          <div className="detail-logs-head">
            <h2>Logs <span className="detail-logs-count">{opLogs.length}</span></h2>
            <button className="btn btn-ghost btn-sm" disabled={!opLogs.length}
              onClick={() => downloadCSV(`boresakshi-${operator.name.replace(/\s+/g, "-")}-logs`, opLogs)}>
              <Download size={15} strokeWidth={2.2} /> Export CSV
            </button>
          </div>
          <LogFilters query={query} setQuery={setQuery} outcome={outcome} setOutcome={setOutcome} />
          {opLogs.length === 0 ? (
            <div className="card hist-empty"><p>This operator hasn't logged any wells yet.</p></div>
          ) : shown.length === 0 ? (
            <div className="card hist-empty"><p>No logs match your search or filter.</p></div>
          ) : (
            <ul className="hist-list">
              {shown.map((l) => <LogItem key={l.id} log={l} adminActions={adminActions} />)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ icon, value, label, accent }) {
  return (
    <div className={`card stat-card ${accent ? "accent" : ""}`}>
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}
