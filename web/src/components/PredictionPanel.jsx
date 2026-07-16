// PredictionPanel.jsx — the result card (empty / loading / result states).
import { Droplets, AlertTriangle, Loader2, Ruler, Waves, Layers, MapPin } from "lucide-react";
import ProbabilityRing from "./ProbabilityRing.jsx";

function Stat({ icon, label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}{sub ? <span className="stat-sub"> · {sub}</span> : null}</div>
      </div>
    </div>
  );
}

const confidenceStyle = {
  Low: { bg: "rgba(255,93,108,.12)", fg: "var(--red)" },
  Medium: { bg: "rgba(255,176,32,.14)", fg: "var(--amber)" },
  High: { bg: "rgba(22,185,138,.14)", fg: "var(--mint)" },
};

export default function PredictionPanel({ status, data, coords }) {
  if (status === "idle") {
    return (
      <div className="panel panel-empty">
        <div className="empty-badge"><Droplets size={30} strokeWidth={2} /></div>
        <h2>Know before you drill</h2>
        <p>Tap anywhere on the map to check the groundwater outlook for that spot — success odds, likely depth and expected yield.</p>
        <div className="empty-hint">A ₹500 check instead of a ₹3&nbsp;lakh gamble.</div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="panel panel-loading">
        <Loader2 className="spin" size={34} strokeWidth={2.4} />
        <p>Reading geology, satellite signals &amp; nearby verified wells…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="panel panel-empty">
        <div className="empty-badge empty-badge-warn"><AlertTriangle size={28} strokeWidth={2} /></div>
        <h2>Couldn't reach the server</h2>
        <p>Make sure the BoreSakshi API is running on <code>localhost:4000</code>, then tap the map again.</p>
      </div>
    );
  }

  const conf = confidenceStyle[data.confidence] || confidenceStyle.Low;

  return (
    <div className="panel panel-result">
      <div className="result-head">
        <ProbabilityRing value={data.successProbability} />
        <div className="result-head-text">
          <div className="result-title">Drilling outlook</div>
          <div className="result-coords">
            {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
          </div>
          <span className="chip" style={{ background: conf.bg, color: conf.fg }}>
            {data.confidence} confidence
          </span>
        </div>
      </div>

      <div className="stats">
        <Stat
          icon={<Ruler size={18} strokeWidth={2.2} />}
          label="Expected depth"
          value={`${data.depthBandFt[0]}–${data.depthBandFt[1]} ft`}
        />
        <Stat
          icon={<Waves size={18} strokeWidth={2.2} />}
          label="Expected yield"
          value={`${data.expectedYieldLpm[0]}–${data.expectedYieldLpm[1]} LPM`}
        />
        <Stat
          icon={<Layers size={18} strokeWidth={2.2} />}
          label="Likely strata"
          value={data.rockType}
        />
        <Stat
          icon={<MapPin size={18} strokeWidth={2.2} />}
          label="Verified wells nearby"
          value={data.nearbyVerifiedLogs}
          sub="within 5 km"
        />
      </div>

      <div className="basis">{data.basis}</div>

      <div className="advisory">
        <strong>Advisory, not a guarantee.</strong> This is a probability from data,
        not a promise of water. Confidence rises as more nearby wells are logged.
      </div>
    </div>
  );
}
