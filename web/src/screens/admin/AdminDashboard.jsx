// AdminDashboard.jsx (/admin) — platform overview for admins.
import { Link } from "react-router-dom";
import {
  Users, UserCheck, ClipboardList, Droplets, Flag, TrendingUp, Trophy,
  Download, Loader2, BadgeCheck, DropletOff,
} from "lucide-react";
import AppHeader from "../../components/AppHeader.jsx";
import MonthlyBars from "../../components/MonthlyBars.jsx";
import { useAdminData } from "../../adminData.jsx";
import { downloadCSV } from "../../csv.js";
import { successRate, logsPerMonth, operatorRows, placeLabel, fmtDate } from "../../metrics.js";

const DAY = 86400000;

export default function AdminDashboard() {
  const { operators, logs, loading } = useAdminData();

  const rows = operatorRows(operators, logs);
  const now = Date.now();
  const active7 = rows.filter((r) => r.lastActiveAt && now - r.lastActiveAt <= 7 * DAY).length;
  const active30 = rows.filter((r) => r.lastActiveAt && now - r.lastActiveAt <= 30 * DAY).length;
  const inactive = operators.length - active30;
  const flagged = logs.filter((l) => l.flagged).length;
  const rate = successRate(logs);
  const trend = logsPerMonth(logs, 6);

  const topByLogs = [...rows].filter((r) => r.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
  const topByRate = [...rows].filter((r) => r.count >= 3).sort((a, b) => b.successRate - a.successRate).slice(0, 5);
  const recent = logs.slice(0, 6);

  return (
    <div className="op">
      <AppHeader subtitle="Admin overview" />
      <div className="dash-body op-anim">
        <header className="dash-greet">
          <div>
            <h1>Platform overview</h1>
            <p>{operators.length} operators · {logs.length} logs across the network</p>
          </div>
          <button className="btn btn-ghost" onClick={() => downloadCSV(`boresakshi-all-logs-${Date.now()}`, logs)} disabled={!logs.length}>
            <Download size={17} strokeWidth={2.2} /> Export all logs
          </button>
        </header>

        {loading && operators.length === 0 ? (
          <div className="dash-loading"><Loader2 className="spin" size={30} /> Loading platform data…</div>
        ) : (
          <>
            <section className="dash-stats admin-stats">
              <Stat icon={<Users size={18} strokeWidth={2.2} />} value={operators.length} label="Rig operators" />
              <Stat icon={<UserCheck size={18} strokeWidth={2.2} />} value={active7} label="Active (7 days)" accent
                sub={`${active30} in 30d · ${inactive} inactive`} />
              <Stat icon={<ClipboardList size={18} strokeWidth={2.2} />} value={logs.length} label="Total logs" />
              <Stat icon={<Droplets size={18} strokeWidth={2.2} />} value={rate != null ? `${rate}%` : "—"} label="Overall success rate" />
              <Link to="/admin/flagged" className="stat-card card flag-stat">
                <div className="stat-card-icon flag"><Flag size={18} strokeWidth={2.2} /></div>
                <div className="stat-card-value">{flagged}</div>
                <div className="stat-card-label">Flagged for review</div>
              </Link>
            </section>

            <section className="card">
              <div className="dash-card-head">
                <span className="dash-card-title"><TrendingUp size={16} strokeWidth={2.2} /> Logs per month — whole platform</span>
                <span className="dash-card-sub">last 6 months</span>
              </div>
              <MonthlyBars data={trend} />
            </section>

            <section className="dash-charts">
              <Leaderboard title="Top operators by logs" icon={<Trophy size={16} strokeWidth={2.2} />}
                rows={topByLogs} metric={(r) => `${r.count} logs`} />
              <Leaderboard title="Top by success rate" icon={<Droplets size={16} strokeWidth={2.2} />}
                rows={topByRate} metric={(r) => `${r.successRate}%`}
                empty="Needs operators with 3+ logs." />
            </section>

            <section className="card dash-recent">
              <div className="dash-card-head">
                <span className="dash-card-title">Recent activity — all operators</span>
                <Link to="/admin/logs" className="dash-link">View all logs</Link>
              </div>
              {recent.length === 0 ? (
                <div className="dash-empty-row">No logs yet across the platform.</div>
              ) : (
                <ul className="dash-activity">
                  {recent.map((l) => (
                    <li key={l.id}>
                      <span className={`act-dot ${l.success ? "ok" : "dry"}`}>
                        {l.success ? <Droplets size={14} strokeWidth={2.2} /> : <DropletOff size={14} strokeWidth={2.2} />}
                      </span>
                      <span className="act-place">
                        {placeLabel(l)}
                        {l.verified && <BadgeCheck size={13} strokeWidth={2.4} className="act-inline-verified" />}
                        {l.flagged && <Flag size={13} strokeWidth={2.4} className="act-inline-flag" />}
                      </span>
                      <Link to={`/admin/operators/${l.operatorId}`} className="act-op">{l.operatorName}</Link>
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

function Stat({ icon, value, label, sub, accent }) {
  return (
    <div className={`card stat-card ${accent ? "accent" : ""}`}>
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
      {sub && <div className="stat-card-sub">{sub}</div>}
    </div>
  );
}

function Leaderboard({ title, icon, rows, metric, empty }) {
  return (
    <div className="card">
      <div className="dash-card-head"><span className="dash-card-title">{icon} {title}</span></div>
      {rows.length === 0 ? (
        <div className="dash-empty-row">{empty || "No data yet."}</div>
      ) : (
        <ol className="leaderboard">
          {rows.map((r, i) => (
            <li key={r.operator.id}>
              <span className="lb-rank">{i + 1}</span>
              <Link to={`/admin/operators/${r.operator.id}`} className="lb-name">
                {r.operator.name}
                {r.operator.verified && <BadgeCheck size={13} strokeWidth={2.4} className="lb-verified" />}
              </Link>
              <span className="lb-metric">{metric(r)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
