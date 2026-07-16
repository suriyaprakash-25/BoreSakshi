// LogFilters.jsx — shared search + outcome filter row, used by the operator
// History page and the admin operator-detail view so they behave identically.
import { Search } from "lucide-react";

const OUTCOMES = [
  { key: "all", label: "All" },
  { key: "water", label: "Water found" },
  { key: "dry", label: "Dry hole" },
];

export default function LogFilters({ query, setQuery, outcome, setOutcome, placeholder }) {
  return (
    <div className="hist-controls">
      <div className="hist-search">
        <Search size={16} strokeWidth={2.2} />
        <input
          className="hist-search-input"
          placeholder={placeholder || "Search by village / location or rock type…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="hist-filters">
        {OUTCOMES.map((f) => (
          <button
            key={f.key}
            className={`op-chip ${outcome === f.key ? "active" : ""}`}
            onClick={() => setOutcome(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
