// MonthlyBars.jsx — single-series monthly bar chart (one hue, rounded tops on a
// recessive baseline, direct value labels, per-bar hover tooltip). Shared by the
// operator Dashboard and the admin platform trend. `data` = output of logsPerMonth.
import { Inbox } from "lucide-react";

export default function MonthlyBars({ data, label = "Logs per month" }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((a, b) => a + b.count, 0);
  if (total === 0) {
    return <div className="dash-empty-row dash-empty-chart"><Inbox size={18} strokeWidth={2} /> No logs in this period yet.</div>;
  }
  return (
    <div className="bars" role="img" aria-label={`${label} for the last ${data.length} months`}>
      {data.map((d) => (
        <div className="bar-col" key={d.key} title={`${d.label} ${d.year}: ${d.count} log${d.count === 1 ? "" : "s"}`}>
          <span className="bar-val" style={{ opacity: d.count ? 1 : 0.35 }}>{d.count}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ height: `${(d.count / max) * 100}%` }} />
          </div>
          <span className="bar-label">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
