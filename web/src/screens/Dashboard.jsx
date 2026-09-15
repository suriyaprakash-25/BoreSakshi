// Dashboard.jsx — operator home (default landing after sign-in).
import { useNavigate, Link } from "react-router-dom";
import {
  Droplets, DropletOff, Layers, Ruler, CalendarDays, ListChecks,
  MapPin, ArrowRight, Loader2, Inbox, TrendingUp,
} from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import ProbabilityRing from "../components/ProbabilityRing.jsx";
import MonthlyBars from "../components/MonthlyBars.jsx";
import { useAuth } from "../auth.jsx";
import { useOperatorData } from "../operatorData.jsx";
import {
  successRate, averageDepth, logsThisWeek, logsPerMonth, strataBreakdown,
  trustedOutcomeLogs, placeLabel, fmtDate,
} from "../metrics.js";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function trustLabel(tier) {
  return ({ NEW: "New", BUILDING: "Building", TRUSTED: "Trusted", HIGH_TRUST: "High trust", WATCH: "Watch" })[tier] || "New";
}

export default function Dashboard() {
  const { operator } = useAuth();
  const { logs, assignments, trust, loading } = useOperatorData();
  const navigate = useNavigate();

  const serverTrust = trust || { score: 50, tier: "NEW", reviewedCount: 0, confidencePct: 0, explanation: "Waiting for server trust profile." };
  const verifiedLogs = trustedOutcomeLogs(logs);
  const rate = successRate(logs);
  const avg = averageDepth(logs);
  const months = logsPerMonth(logs, 6);
  const strata = strataBreakdown(logs);
  const recent = logs.slice(0, 5);

  return (
    <div className="op">
      <AppHeader subtitle="Operator dashboard" />
      <div className="dash-body op-anim">
        <header className="dash-greet">
          <div>
            <h1>{greeting()}, {operator?.name?.split(" ")[0] || "operator"}.</h1>
            <p>{new Date().toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" })}</p>
          </div>
          <button className="btn btn-primary" onClick={() => navigate("/log")}>
            <Droplets size={17} strokeWidth={2.2} /> Log a drill
          </button>
        </header>

        {loading && logs.length === 0 ? (
          <div className="dash-loading"><Loader2 className="spin" size={30} /> Loading your data…</div>
        ) : (
          <>
            <section className="dash-top">
              <div className="card dash-trust">
                <div className="dash-trust-head">
                  <span className="dash-card-title">Verified-data trust</span>
                  <span className="dash-trust-badge">{trustLabel(serverTrust.tier)}</span>
                </div>
                <ProbabilityRing value={serverTrust.score} size={148} suffix="" label={trustLabel(serverTrust.tier)} />
                <p className="dash-trust-note">
                  Server-computed Phase 9 trust · {serverTrust.reviewedCount} reviewed record{serverTrust.reviewedCount === 1 ? "" : "s"} · {serverTrust.confidencePct}% confidence.
                  {" "}{serverTrust.explanation}
                </p>
              </div>

              <div className="dash-stats">
                <StatCard icon={<ListChecks size={18} strokeWidth={2.2} />} value={logs.length} label="Submissions" />
                <StatCard icon={<Droplets size={18} strokeWidth={2.2} />} value={rate != null ? `${rate}%` : "—"} label="Verified water-strike rate" accent />
                <StatCard icon={<Ruler size={18} strokeWidth={2.2} />} value={avg != null ? `${avg} ft` : "—"} label="Verified avg. depth" />
                <StatCard icon={<CalendarDays size={18} strokeWidth={2.2} />} value={logsThisWeek(logs)} label="Submitted this week" />
              </div>
            </section>

            <section className="card dash-assign">
              <div className="dash-card-head">
                <span className="dash-card-title"><MapPin size={16} strokeWidth={2.2} /> Assigned sites awaiting a log</span>
                <span className="dash-count">{assignments.length}</span>
              </div>
              {assignments.length === 0 ? (
                <div className="dash-empty-row"><Inbox size={18} strokeWidth={2} /> No pending sites — you're all caught up.</div>
              ) : (
                <ul className="dash-assign-list">
                  {assignments.map((a) => (
                    <li key={a.id}>
                      <div className="dash-assign-info">
                        <span className="dash-assign-name">{a.village}</span>
                        <span className="dash-assign-meta">{a.note} · {a.lat.toFixed(3)}, {a.lng.toFixed(3)}</span>
                      </div>
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => navigate("/log", { state: { site: { lat: a.lat, lng: a.lng, village: a.village } } })}>
                        Log now <ArrowRight size={15} strokeWidth={2.2} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="dash-charts">
              <div className="card">
                <div className="dash-card-head">
                  <span className="dash-card-title"><TrendingUp size={16} strokeWidth={2.2} /> Submissions per month</span>
                  <span className="dash-card-sub">last 6 months</span>
                </div>
                <MonthlyBars data={months} />
              </div>

              <div className="card">
                <div className="dash-card-head">
                  <span className="dash-card-title"><Layers size={16} strokeWidth={2.2} /> Verified strata encountered</span>
                  <span className="dash-card-sub">{verifiedLogs.length} verified outcome{verifiedLogs.length === 1 ? "" : "s"}</span>
                </div>
                <StrataBreakdown data={strata} total={verifiedLogs.length} />
              </div>
            </section>

            <section className="card dash-recent">
              <div className="dash-card-head">
                <span className="dash-card-title">Recent submissions</span>
                <Link to="/history" className="dash-link">View all in History <ArrowRight size={14} strokeWidth={2.2} /></Link>
              </div>
              {recent.length === 0 ? (
                <div className="dash-empty-row">
                  <Inbox size={18} strokeWidth={2} /> No logs yet — <Link to="/log" className="dash-link-inline">log your first drill</Link>.
                </div>
              ) : (
                <ul className="dash-activity">
                  {recent.map((log) => (
                    <li key={log.id}>
                      <span className={`act-dot ${log.success ? "ok" : "dry"}`}>
                        {log.success ? <Droplets size={14} strokeWidth={2.2} /> : <DropletOff size={14} strokeWidth={2.2} />}
                      </span>
                      <span className="act-place">{placeLabel(log)}</span>
                      <span className="act-meta">{log.verificationStatus || (log.verified ? "VERIFIED" : "SUBMITTED")} · {log.depthFt ? `${log.depthFt} ft` : "—"}</span>
                      <span className="act-date">{fmtDate(log.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, value, label, accent }) {
  return (
    <div className={`card stat-card ${accent ? "accent" : ""}`}>
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}

function StrataBreakdown({ data, total }) {
  if (!data.length || !total) {
    return <div className="dash-empty-row dash-empty-chart"><Inbox size={18} strokeWidth={2} /> No verified strata recorded yet.</div>;
  }
  return (
    <div className="strata">
      <div className="strata-bar">
        {data.map((b) => (
          <div key={b.key} className="strata-seg" style={{ flexGrow: b.count, background: b.color }}
            title={`${b.label}: ${b.count} (${Math.round((b.count / total) * 100)}%)`} />
        ))}
      </div>
      <ul className="strata-legend">
        {data.map((b) => (
          <li key={b.key}>
            <span className="strata-swatch" style={{ background: b.color }} />
            <span className="strata-name">{b.label}</span>
            <span className="strata-count">{b.count} · {Math.round((b.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
