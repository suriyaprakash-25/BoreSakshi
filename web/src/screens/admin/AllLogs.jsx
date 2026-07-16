// AllLogs.jsx (/admin/logs) — every log from every operator, with rich filtering,
// sorting, and CSV export of the current filtered set. Reuses the shared LogItem.
import { useMemo, useState } from "react";
import { Search, Download, ArrowUpDown, Loader2, Inbox } from "lucide-react";
import AppHeader from "../../components/AppHeader.jsx";
import LogItem from "../../components/LogItem.jsx";
import { useAdminData } from "../../adminData.jsx";
import { downloadCSV } from "../../csv.js";
import { filterLogs } from "../../metrics.js";

const OUTCOMES = [
  { key: "all", label: "All" },
  { key: "water", label: "Water found" },
  { key: "dry", label: "Dry hole" },
];
const FLAGS = [
  { key: "all", label: "All" },
  { key: "flagged", label: "Flagged" },
  { key: "clean", label: "Not flagged" },
];
const SORTS = [
  { key: "date", label: "Date", value: (l) => new Date(l.createdAt).getTime() },
  { key: "depth", label: "Depth", value: (l) => (l.depthFt ?? -Infinity) },
  { key: "yield", label: "Yield", value: (l) => (l.yieldLpm ?? -Infinity) },
];

export default function AllLogs() {
  const { logs, operators, loading, flagLog, clearFlag, setLogVerified } = useAdminData();
  const adminActions = { flagLog, clearFlag, setLogVerified };

  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [operatorId, setOperatorId] = useState("");
  const [flag, setFlag] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState("date");
  const [dir, setDir] = useState("desc");

  const shown = useMemo(() => {
    let list = logs.filter((l) => {
      if (operatorId && l.operatorId !== operatorId) return false;
      if (flag === "flagged" && !l.flagged) return false;
      if (flag === "clean" && l.flagged) return false;
      const day = l.createdAt.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
    list = filterLogs(list, { query, outcome }); // search (op/place/rock) + outcome
    const col = SORTS.find((s) => s.key === sortKey) || SORTS[0];
    list = [...list].sort((a, b) => {
      const av = col.value(a), bv = col.value(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [logs, query, outcome, operatorId, flag, from, to, sortKey, dir]);

  const active = query || outcome !== "all" || operatorId || flag !== "all" || from || to;
  function reset() {
    setQuery(""); setOutcome("all"); setOperatorId(""); setFlag("all"); setFrom(""); setTo("");
  }

  return (
    <div className="op">
      <AppHeader subtitle="All logs" />
      <div className="admin-body op-anim">
        <header className="hist-head">
          <h1>All logs</h1>
          <p className="hist-summary">
            Showing <strong>{shown.length}</strong> of {logs.length} log{logs.length === 1 ? "" : "s"}
          </p>
        </header>

        <div className="alllogs-controls card">
          <div className="hist-search">
            <Search size={16} strokeWidth={2.2} />
            <input className="hist-search-input" placeholder="Search by operator, village / location or rock type…"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <div className="alllogs-filters">
            <div className="adminmap-field">
              <span>Outcome</span>
              <div className="hist-filters">
                {OUTCOMES.map((o) => (
                  <button key={o.key} className={`op-chip ${outcome === o.key ? "active" : ""}`} onClick={() => setOutcome(o.key)}>{o.label}</button>
                ))}
              </div>
            </div>

            <div className="adminmap-field">
              <span>Flag</span>
              <div className="hist-filters">
                {FLAGS.map((f) => (
                  <button key={f.key} className={`op-chip ${flag === f.key ? "active" : ""}`} onClick={() => setFlag(f.key)}>{f.label}</button>
                ))}
              </div>
            </div>

            <label className="adminmap-field">
              <span>Operator</span>
              <select className="op-input" value={operatorId} onChange={(e) => setOperatorId(e.target.value)}>
                <option value="">All operators</option>
                {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>

            <label className="adminmap-field">
              <span>From</span>
              <input className="op-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="adminmap-field">
              <span>To</span>
              <input className="op-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>

            <label className="adminmap-field">
              <span>Sort by</span>
              <div className="sort-control">
                <select className="op-input" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <button className="btn btn-ghost btn-sm sort-dir" title={dir === "asc" ? "Ascending" : "Descending"}
                  onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}>
                  <ArrowUpDown size={15} strokeWidth={2.2} /> {dir === "asc" ? "Asc" : "Desc"}
                </button>
              </div>
            </label>
          </div>

          <div className="alllogs-actions">
            {active && <button className="btn btn-ghost btn-sm" onClick={reset}>Clear filters</button>}
            <button className="btn btn-primary btn-sm" disabled={!shown.length}
              onClick={() => downloadCSV(`boresakshi-logs-filtered-${Date.now()}`, shown)}>
              <Download size={15} strokeWidth={2.2} /> Export CSV ({shown.length})
            </button>
          </div>
        </div>

        {loading && logs.length === 0 ? (
          <div className="dash-loading"><Loader2 className="spin" size={30} /> Loading logs…</div>
        ) : shown.length === 0 ? (
          <div className="card hist-empty">
            <div className="hist-empty-badge"><Inbox size={26} strokeWidth={2} /></div>
            <p>No logs match the current filters.</p>
            {active && <button className="btn btn-ghost btn-sm" onClick={reset}>Clear filters</button>}
          </div>
        ) : (
          <ul className="hist-list">
            {shown.map((l) => <LogItem key={l.id} log={l} showOperator adminActions={adminActions} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
