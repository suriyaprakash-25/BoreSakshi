// OperatorsList.jsx (/admin/operators) — every rig operator, searchable + sortable.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ChevronUp, ChevronDown, BadgeCheck, Loader2 } from "lucide-react";
import AppHeader from "../../components/AppHeader.jsx";
import { useAdminData } from "../../adminData.jsx";
import { operatorRows, fmtDate } from "../../metrics.js";

// column def: key, header, value for a row, and a comparable sort value
const COLS = [
  { key: "name", label: "Operator", sort: (r) => r.operator.name.toLowerCase() },
  { key: "createdAt", label: "Signed up", sort: (r) => new Date(r.operator.createdAt).getTime() },
  { key: "lastActive", label: "Last active", sort: (r) => r.lastActiveAt || 0 },
  { key: "count", label: "Logs", sort: (r) => r.count, num: true },
  { key: "success", label: "Success", sort: (r) => (r.successRate == null ? -1 : r.successRate), num: true },
  { key: "trust", label: "Trust", sort: (r) => r.trust, num: true },
  { key: "status", label: "Status", sort: (r) => (r.operator.status === "deactivated" ? 1 : 0) },
];

export default function OperatorsList() {
  const { operators, logs, loading } = useAdminData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("count");
  const [dir, setDir] = useState("desc");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = operatorRows(operators, logs);
    if (q) list = list.filter((r) => r.operator.name.toLowerCase().includes(q));
    const col = COLS.find((c) => c.key === sortKey) || COLS[0];
    list.sort((a, b) => {
      const av = col.sort(a), bv = col.sort(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [operators, logs, query, sortKey, dir]);

  function toggleSort(key) {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setDir(COLS.find((c) => c.key === key)?.num ? "desc" : "asc"); }
  }

  return (
    <div className="op">
      <AppHeader subtitle="Operators" />
      <div className="admin-body op-anim">
        <header className="hist-head">
          <h1>Rig operators</h1>
          <p className="hist-summary"><strong>{operators.length}</strong> accounts</p>
        </header>

        <div className="hist-controls">
          <div className="hist-search">
            <Search size={16} strokeWidth={2.2} />
            <input className="hist-search-input" placeholder="Search by operator name…"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        {loading && operators.length === 0 ? (
          <div className="dash-loading"><Loader2 className="spin" size={30} /> Loading operators…</div>
        ) : (
          <div className="table-wrap card">
            <table className="admin-table">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} className={c.num ? "num" : ""}>
                      <button className="th-sort" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        {sortKey === c.key && (dir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.operator.id} onClick={() => navigate(`/admin/operators/${r.operator.id}`)}>
                    <td>
                      <span className="op-cell-name">
                        {r.operator.name}
                        {r.operator.verified && <BadgeCheck size={14} strokeWidth={2.4} className="op-cell-verified" />}
                      </span>
                    </td>
                    <td>{fmtDate(r.operator.createdAt)}</td>
                    <td>{r.lastActiveAt ? fmtDate(new Date(r.lastActiveAt).toISOString()) : "—"}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{r.successRate == null ? "—" : `${r.successRate}%`}</td>
                    <td className="num">{r.trust}</td>
                    <td>
                      <span className={`status-pill ${r.operator.status === "deactivated" ? "off" : "on"}`}>
                        {r.operator.status === "deactivated" ? "Deactivated" : "Active"}
                      </span>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={COLS.length} className="table-empty">No operators match “{query}”.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
