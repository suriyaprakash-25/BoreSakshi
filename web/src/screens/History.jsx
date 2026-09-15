// History.jsx — the operator's full submission and verification history.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Inbox, Loader2 } from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import LogFilters from "../components/LogFilters.jsx";
import LogItem from "../components/LogItem.jsx";
import { useOperatorData } from "../operatorData.jsx";
import { successRate, filterLogs, trustedOutcomeLogs } from "../metrics.js";

export default function History() {
  const { logs, loading, requestReview } = useOperatorData();
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("all");

  const verified = trustedOutcomeLogs(logs);
  const rejected = logs.filter((log) => log.verificationStatus === "REJECTED").length;
  const inReview = logs.filter((log) => log.verificationStatus === "UNDER_REVIEW").length;
  const rate = successRate(logs);
  const shown = useMemo(() => filterLogs(logs, { query, outcome }), [logs, query, outcome]);

  return (
    <div className="op">
      <AppHeader subtitle="Submission history" />
      <div className="hist-body op-anim">
        <header className="hist-head">
          <h1>Submission history</h1>
          <p className="hist-summary">
            <strong>{logs.length}</strong> submission{logs.length === 1 ? "" : "s"} · <strong>{verified.length}</strong> verified
            {inReview > 0 && <> · <strong>{inReview}</strong> under review</>}
            {rejected > 0 && <> · <strong>{rejected}</strong> rejected</>}
            {rate != null && <> · <strong>{rate}%</strong> verified water-strike rate</>}
          </p>
        </header>

        <LogFilters query={query} setQuery={setQuery} outcome={outcome} setOutcome={setOutcome} />

        {loading && logs.length === 0 ? (
          <div className="dash-loading"><Loader2 className="spin" size={30} /> Loading your submissions…</div>
        ) : logs.length === 0 ? (
          <div className="card hist-empty">
            <div className="hist-empty-badge"><Inbox size={26} strokeWidth={2} /></div>
            <p>No submissions yet. <Link to="/log" className="dash-link-inline">Log your first drill</Link> and it will appear here.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="card hist-empty">
            <div className="hist-empty-badge"><Search size={24} strokeWidth={2} /></div>
            <p>No submissions match your search or filter.</p>
            <button className="btn btn-ghost btn-sm" onClick={() => { setQuery(""); setOutcome("all"); }}>Clear filters</button>
          </div>
        ) : (
          <ul className="hist-list">
            {shown.map((log) => <LogItem key={log.id} log={log} operatorActions={{ requestReview }} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
