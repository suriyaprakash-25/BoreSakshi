// Dashboard.jsx — operator home (default landing after sign-in).
// All figures derive from the operator's own logs (shared OperatorDataProvider),
// so a new log on the Log screen shows up here immediately.
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
  trustScore, placeLabel, fmtDate,
} from "../metrics.js";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const { operator } = useAuth();
  const { logs, assignments, loading } = useOperatorData();
  const navigate = useNavigate();

  const trust = trustScore(logs, { verified: operator?.verified });
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
            {/* trust + headline stats */}
            <section className="dash-top">
              <div className="card dash-trust">
                <div className="dash-trust-head">
                  <span className="dash-card-title">Field trust score</span>
                  <span className="dash-trust-badge">{trust.label}</span>
                </div>
                <ProbabilityRing value={trust.score} size={148} suffix="" label={trust.label} />
                <p className="dash-trust-note">Based on your logging volume, data completeness and recency.</p>
              </div>

              <div className="dash-stats">
                <StatCard icon={<ListChecks size={18} strokeWidth={2.2} />} value={logs.length} label="Wells logged" />
                <StatCard icon={<Droplets size={18} strokeWidth={2.2} />} value={rate != null ? `${rate}%` : "—"} label="Water-strike rate" accent />
                <StatCard icon={<Ruler size={18} strokeWidth={2.2} />} value={avg != null ? `${avg} ft` : "—"} label="Avg. total depth" />
                <StatCard icon={<CalendarDays size={18} strokeWidth={2.2} />} value={logsThisWeek(logs)} label="Logged this week" />
              </div>
            </section>

            {/* assigned sites awaiting a log */}
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
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => navigate("/log", { state: { site: { lat: a.lat, lng: a.lng, village: a.village } } })}
                      >
                        Log now <ArrowRight size={15} strokeWidth={2.2} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* charts */}
            <section className="dash-charts">
              <div className="card">
                <div className="dash-card-head">
                  <span className="dash-card-title"><TrendingUp size={16} strokeWidth={2.2} /> Logs per month</span>
                  <span className="dash-card-sub">last 6 months</span>
                </div>
                <MonthlyBars data={months} />
              </div>

              <div className="card">
                <div className="dash-card-head">
                  <span className="dash-card-title"><Layers size={16} strokeWidth={2.2} /> Strata encountered</span>
                  <span className="dash-card-sub">shallow → deep</span>
                </div>
                <StrataBreakdown data={strata} total={logs.length} />
              </div>
            </section>

            {/* recent activity */}
            <section className="card dash-recent">
              <div className="dash-card-head">
                <span className="dash-card-title">Recent activity</span>
                <Link to="/history" className="dash-link">View all in History <ArrowRight size={14} strokeWidth={2.2} /></Link>
              </div>
              {recent.length === 0 ? (
                <div className="dash-empty-row">
                  <Inbox size={18} strokeWidth={2} /> No logs yet — <Link to="/log" className="dash-link-inline">log your first drill</Link>.
                </div>
              ) : (
                <ul className="dash-activity">
                  {recent.map((l) => (
                    <li key={l.id}>
                      <span className={`act-dot ${l.success ? "ok" : "dry"}`}>
                        {l.success ? <Droplets size={14} strokeWidth={2.2} /> : <DropletOff size={14} strokeWidth={2.2} />}
                      </span>
                      <span className="act-place">{placeLabel(l)}</span>
                      <span className="act-meta">{l.depthFt ? `${l.depthFt} ft` : "—"}</span>
                      <span className="act-date">{fmtDate(l.createdAt)}</span>
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

// ---- pieces ---------------------------------------------------------------
function StatCard({ icon, value, label, accent }) {
  return (
    <div className={`card stat-card ${accent ? "accent" : ""}`}>
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}

// strata composition — sequential light→dark ramp, 100% stacked bar with 2px
// gaps + a direct-labeled legend.
function StrataBreakdown({ data, total }) {
  if (!data.length) {
    return <div className="dash-empty-row dash-empty-chart"><Inbox size={18} strokeWidth={2} /> No strata recorded yet.</div>;
  }
  return (
    <div className="strata">
      <div className="strata-bar">
        {data.map((b) => (
          <div
            key={b.key}
            className="strata-seg"
            style={{ flexGrow: b.count, background: b.color }}
            title={`${b.label}: ${b.count} (${Math.round((b.count / total) * 100)}%)`}
          />
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
