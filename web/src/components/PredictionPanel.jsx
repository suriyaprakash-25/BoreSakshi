// PredictionPanel.jsx — the result card (empty / loading / result states).
// Beyond the headline number it now exposes the *reasoning*:
//   • "Why this prediction?"  — factor decomposition (item 1)
//   • "Why this confidence?"  — nearby-data reasoning (item 2)
//   • Nearby borewell explorer — the raw evidence, as proof (item 3)
//   • Ask BoreSakshi          — a templated plain-language answer (item 4)
// Everything here is derived from data the backend already returns for the pin.
import { useState } from "react";
import {
  Droplets, DropletOff, AlertTriangle, Loader2, Ruler, Waves, Layers, MapPin,
  ChevronDown, Info, Clock, Send, Sparkles, TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import ProbabilityRing from "./ProbabilityRing.jsx";
import { averageDepth, fmtDate } from "../metrics.js";

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

// ---- item 1: factor decomposition ------------------------------------------
// Renders the `factors` array (from predict.js). Impacts are in probability
// points; bars are scaled to the largest magnitude so they read at a glance.
// This is the exact shape the real model's SHAP / feature-importance output
// will fill later — no UI change needed when the model lands.
function FactorBars({ factors }) {
  const max = Math.max(1, ...factors.map((f) => Math.abs(f.impact)));
  return (
    <div className="factors">
      {factors.map((f) => {
        const pos = f.impact > 0, neg = f.impact < 0;
        const cls = f.base ? "base" : pos ? "pos" : neg ? "neg" : "zero";
        const width = `${Math.round((Math.abs(f.impact) / max) * 100)}%`;
        return (
          <div className={`factor factor-${cls}`} key={f.label}>
            <div className="factor-top">
              <span className="factor-label">{f.label}</span>
              <span className="factor-impact">
                {f.base ? null : pos ? <TrendingUp size={13} strokeWidth={2.4} />
                  : neg ? <TrendingDown size={13} strokeWidth={2.4} /> : <Minus size={13} strokeWidth={2.4} />}
                {f.base ? f.impact : `${pos ? "+" : ""}${f.impact}`}
              </span>
            </div>
            <div className="factor-track"><span className="factor-fill" style={{ width }} /></div>
          </div>
        );
      })}
      <p className="factors-note">
        Contributions in probability points — the baseline plus each factor add up to the score.
        <br />Heuristic weighting today; swaps to the trained model's feature importance later.
      </p>
    </div>
  );
}

// ---- item 2: confidence reasoning ------------------------------------------
function WhyConfidence({ reason }) {
  const fresh = reason.latestNearbyLogAt ? fmtDate(reason.latestNearbyLogAt) : null;
  return (
    <div className="why-conf">
      <div className="why-conf-row">
        <MapPin size={14} strokeWidth={2.2} />
        <span><strong>{reason.nearbyCount}</strong> verified well{reason.nearbyCount === 1 ? "" : "s"} within {reason.radiusKm} km
          {reason.nearbyCount > 0 ? ` (${reason.successCount} success, ${reason.failCount} dry)` : ""}</span>
      </div>
      <div className="why-conf-row">
        <Clock size={14} strokeWidth={2.2} />
        <span>Data freshness: {fresh ? <strong>{fresh}</strong> : "no nearby logs yet"}</span>
      </div>
      <p className="why-conf-note">Confidence rises as more nearby wells are logged — it reflects how much local ground-truth backs this estimate.</p>
    </div>
  );
}

// ---- item 3: nearby borewell explorer --------------------------------------
function NearbyExplorer({ nearby }) {
  if (!nearby?.length) {
    return (
      <div className="nearby-empty">
        <Info size={15} strokeWidth={2.2} /> No verified wells within 5 km yet — this estimate leans on regional geology alone.
      </div>
    );
  }
  return (
    <ul className="nearby-list">
      {nearby.map((w) => (
        <li className="nearby-item" key={w.id}>
          <span className={`nearby-dot ${w.success ? "ok" : "dry"}`}>
            {w.success ? <Droplets size={13} strokeWidth={2.2} /> : <DropletOff size={13} strokeWidth={2.2} />}
          </span>
          <span className="nearby-main">
            <span className="nearby-place">{w.placeName || "Unnamed site"}</span>
            <span className="nearby-meta">
              {w.depthFt != null ? `${w.depthFt} ft` : "depth n/a"}
              {w.strata ? ` · ${w.strata}` : ""} · {w.success ? "water found" : "dry hole"}
            </span>
          </span>
          <span className="nearby-dist">{w.distanceKm} km</span>
        </li>
      ))}
    </ul>
  );
}

// ---- item 4: Ask BoreSakshi ------------------------------------------------
// IMPORTANT: this is NOT an AI model and makes NO extra network / LLM call.
// It is pure string templating over the prediction + nearby data already on
// screen — a plain-language restatement of the same numbers. Honest to say to
// judges: "it summarises our computed result in words, it does not 'think'."
function askAnswer(data) {
  const r = data.confidenceReason || {};
  const n = r.nearbyCount ?? (data.nearby?.length || 0);
  const avg = averageDepth(data.nearby || []);
  const prob = data.successProbability;
  const verdict =
    prob >= 65 ? "Conditions look favourable — a reasonable spot to drill."
    : prob >= 45 ? "It's borderline — worth a second opinion or trying a nearby spot."
    : "Odds look poor here — a different location may drill better.";
  const evidence = n
    ? `There ${n === 1 ? "is" : "are"} ${n} verified well${n === 1 ? "" : "s"} within ${r.radiusKm || 5} km (${r.successCount} successful, ${r.failCount} dry)${avg != null ? `, averaging ${avg} ft deep` : ""}.`
    : "There are no verified wells nearby yet, so this leans on regional geology.";
  return `${evidence} Likely strata is ${data.rockType.toLowerCase()}. Estimated success here is ${prob}% (${data.confidence.toLowerCase()} confidence). ${verdict}`;
}

function AskBoreSakshi({ data }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  function handleAsk(e) {
    e.preventDefault();
    // No model call — just template the already-computed result into words.
    setAnswer(askAnswer(data));
  }
  return (
    <form className="ask" onSubmit={handleAsk}>
      <label className="ask-label"><Sparkles size={14} strokeWidth={2.2} /> Ask BoreSakshi</label>
      <div className="ask-row">
        <input
          className="op-input ask-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Should I drill here?"
          aria-label="Ask about this location"
        />
        <button className="btn btn-primary ask-send" type="submit" aria-label="Ask">
          <Send size={16} strokeWidth={2.2} />
        </button>
      </div>
      {answer && <div className="ask-answer">{answer}</div>}
    </form>
  );
}

// ---- collapsible section shell ---------------------------------------------
function Disclosure({ icon, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`disclosure ${open ? "open" : ""}`}>
      <button type="button" className="disclosure-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="disclosure-title">{icon} {title}</span>
        <ChevronDown size={16} strokeWidth={2.4} className="disclosure-chev" />
      </button>
      {open && <div className="disclosure-body">{children}</div>}
    </div>
  );
}

export default function PredictionPanel({ status, data, coords, onPinCurrentLocation }) {
  if (status === "idle") {
    return (
      <div className="panel panel-empty">
        <div className="empty-badge"><Droplets size={30} strokeWidth={2} /></div>
        <h2>Know before you drill</h2>
        <p>Tap anywhere on the map to check the groundwater outlook for that spot — success odds, likely depth and expected yield.</p>
        <button className="btn btn-primary" onClick={onPinCurrentLocation} style={{ marginTop: '1.5rem', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <MapPin size={18} /> Pin current location
        </button>
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

      {/* item 4 — plain-language wrapper over the same numbers (no AI call) */}
      <AskBoreSakshi data={data} />

      {/* item 1 — factor decomposition, open by default (it's the headline value) */}
      {data.factors?.length > 0 && (
        <Disclosure icon={<Info size={15} strokeWidth={2.2} />} title="Why this prediction?" defaultOpen>
          <FactorBars factors={data.factors} />
        </Disclosure>
      )}

      {/* item 2 — confidence reasoning */}
      {data.confidenceReason && (
        <Disclosure icon={<Info size={15} strokeWidth={2.2} />} title="Why this confidence?">
          <WhyConfidence reason={data.confidenceReason} />
        </Disclosure>
      )}

      {/* item 3 — the raw evidence, so a skeptic can check the factors above */}
      <Disclosure
        icon={<MapPin size={15} strokeWidth={2.2} />}
        title={`Nearby verified wells (${data.nearby?.length || 0})`}
        defaultOpen={(data.nearby?.length || 0) > 0}
      >
        <NearbyExplorer nearby={data.nearby} />
      </Disclosure>

      <div className="advisory">
        <strong>Advisory, not a guarantee.</strong> This is a probability from data,
        not a promise of water. Confidence rises as more nearby wells are logged.
      </div>
    </div>
  );
}
