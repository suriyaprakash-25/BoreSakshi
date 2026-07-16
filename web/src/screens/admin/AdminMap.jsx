// AdminMap.jsx (/admin/map) — every logged well across all operators, colour-coded
// by outcome, filterable by operator, date range and outcome. Reuses react-leaflet
// + OpenStreetMap (same stack as the farmer map).
import { useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { Link } from "react-router-dom";
import AppHeader from "../../components/AppHeader.jsx";
import { useAdminData } from "../../adminData.jsx";
import { placeLabel, fmtDate } from "../../metrics.js";

const CENTER = [11.4, 77.9]; // Namakkal / Tiruchengode belt
const OUTCOMES = [
  { key: "all", label: "All" },
  { key: "water", label: "Water found" },
  { key: "dry", label: "Dry hole" },
];

export default function AdminMap() {
  const { operators, logs } = useAdminData();
  const [operatorId, setOperatorId] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const shown = useMemo(() => logs.filter((l) => {
    if (operatorId && l.operatorId !== operatorId) return false;
    if (outcome === "water" && !l.success) return false;
    if (outcome === "dry" && l.success) return false;
    const day = l.createdAt.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return typeof l.lat === "number" && typeof l.lng === "number";
  }), [logs, operatorId, outcome, from, to]);

  return (
    <div className="op">
      <AppHeader subtitle="Wells map" />
      <div className="adminmap-body op-anim">
        <div className="adminmap-controls card">
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
          <div className="adminmap-field">
            <span>Outcome</span>
            <div className="hist-filters">
              {OUTCOMES.map((o) => (
                <button key={o.key} className={`op-chip ${outcome === o.key ? "active" : ""}`} onClick={() => setOutcome(o.key)}>{o.label}</button>
              ))}
            </div>
          </div>
          <div className="adminmap-count">{shown.length} well{shown.length === 1 ? "" : "s"}</div>
        </div>

        <div className="adminmap-map card">
          <MapContainer center={CENTER} zoom={9} className="map" scrollWheelZoom>
            <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {shown.map((l) => (
              <CircleMarker
                key={l.id}
                center={[l.lat, l.lng]}
                radius={7}
                pathOptions={{
                  color: l.flagged ? "#f0a318" : "#ffffff",
                  weight: l.flagged ? 3 : 2,
                  fillColor: l.success ? "#16b98a" : "#ff5d6c",
                  fillOpacity: 0.9,
                }}
              >
                <Popup>
                  <div className="wellpop">
                    <strong>{placeLabel(l)}</strong>
                    <div>{l.success ? "💧 Water found" : "Dry hole"} · {l.depthFt ? `${l.depthFt} ft` : "—"}</div>
                    <div>By {l.operatorName} · {fmtDate(l.createdAt)}</div>
                    {l.flagged && <div className="wellpop-flag">Flagged: {l.flagReason || "for review"}</div>}
                    <Link to={`/admin/operators/${l.operatorId}`}>View operator →</Link>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>

        <div className="adminmap-legend">
          <span><i className="dot dot-green" /> Water found</span>
          <span><i className="dot dot-red" /> Dry hole</span>
          <span><i className="dot dot-amber" /> Flagged</span>
        </div>
      </div>
    </div>
  );
}
