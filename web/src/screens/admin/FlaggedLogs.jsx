// FlaggedLogs.jsx (/admin/flagged) — every log currently flagged for review.
import { useMemo } from "react";
import { Flag, ShieldCheck, Loader2 } from "lucide-react";
import AppHeader from "../../components/AppHeader.jsx";
import LogItem from "../../components/LogItem.jsx";
import { useAdminData } from "../../adminData.jsx";

export default function FlaggedLogs() {
  const { logs, loading, flagLog, clearFlag, setLogVerified } = useAdminData();
  const flagged = useMemo(() => logs.filter((l) => l.flagged), [logs]);
  const adminActions = { flagLog, clearFlag, setLogVerified };

  return (
    <div className="op">
      <AppHeader subtitle="Flagged logs" />
      <div className="hist-body op-anim">
        <header className="hist-head">
          <h1>Flagged logs</h1>
          <p className="hist-summary"><strong>{flagged.length}</strong> log{flagged.length === 1 ? "" : "s"} awaiting review</p>
        </header>

        {loading && logs.length === 0 ? (
          <div className="dash-loading"><Loader2 className="spin" size={30} /> Loading…</div>
        ) : flagged.length === 0 ? (
          <div className="card hist-empty">
            <div className="hist-empty-badge"><ShieldCheck size={26} strokeWidth={2} /></div>
            <p>Nothing flagged. Flag a log from an operator's detail page and it will appear here.</p>
          </div>
        ) : (
          <ul className="hist-list">
            {flagged.map((l) => <LogItem key={l.id} log={l} showOperator adminActions={adminActions} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
