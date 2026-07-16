// History.jsx — the operator's full log history: search, outcome filter, and a
// detail card per logged outcome. Reads the shared OperatorDataProvider, so a log
// submitted on the Log screen appears here without a refresh.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Inbox, Loader2 } from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import LogFilters from "../components/LogFilters.jsx";
import LogItem from "../components/LogItem.jsx";
import { useOperatorData } from "../operatorData.jsx";
import { successRate, filterLogs } from "../metrics.js";

export default function History() {
  const { logs, loading } = useOperatorData();
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("all");

  const rate = successRate(logs);
  const shown = useMemo(() => filterLogs(logs, { query, outcome }), [logs, query, outcome]);

  return (
    <div className="op">
      <AppHeader subtitle="Log history" />
      <div className="hist-body op-anim">
        <header className="hist-head">
          <h1>Log history</h1>
          <p className="hist-summary">
            <strong>{logs.length}</strong> log{logs.length === 1 ? "" : "s"}
            {rate != null && <> · <strong>{rate}%</strong> water-strike success rate</>}
          </p>
        </header>

        <LogFilters query={query} setQuery={setQuery} outcome={outcome} setOutcome={setOutcome} />

        {loading && logs.length === 0 ? (
          <div className="dash-loading"><Loader2 className="spin" size={30} /> Loading your logs…</div>
        ) : logs.length === 0 ? (
          <div className="card hist-empty">
            <div className="hist-empty-badge"><Inbox size={26} strokeWidth={2} /></div>
            <p>No logs yet. <Link to="/log" className="dash-link-inline">Log your first drill</Link> and it will appear here.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="card hist-empty">
            <div className="hist-empty-badge"><Search size={24} strokeWidth={2} /></div>
            <p>No logs match your search or filter.</p>
            <button className="btn btn-ghost btn-sm" onClick={() => { setQuery(""); setOutcome("all"); }}>Clear filters</button>
          </div>
        ) : (
          <ul className="hist-list">
            {shown.map((l) => <LogItem key={l.id} log={l} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
