// PredictionPanel.jsx — farmer prediction result card.
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

function FactorBars({ factors, isMock }) {
  const max = Math.max(1, ...factors.map((f) => Math.abs(f.impact)));
  return (
    <div className="factors">
      {factors.map((f) => {
        const pos = f.impact > 0, neg = f.impact < 0;
        const cls = f.base ? "base" : pos ? "pos" : neg ? "neg" : "zero";
        const width = `${Math.round((Math.abs(f.impact) / max) * 100)}%`;
        return (
          <div className={`factor factor-${cls}`} key={`${f.label}-${f.method || "factor"}`}>
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
        {isMock
          ? "Heuristic probability-point decomposition. This is the labelled fallback, not the trained ML model."
          : "Local model sensitivity in probability points, estimated by single-feature ablation to the trained preprocessing baseline. Values are explanatory sensitivities and do not need to sum to the final probability."}
      </p>
    </div>
  );
}

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
        <span>Data freshness: {fresh ? <strong>{fresh}</strong> : "no nearby verified logs yet"}</span>
      </div>
      {reason.modelCoveragePct != null && (
        <div className="why-conf-row">
          <Info size={14} strokeWidth={2.2} />
          <span>Feature coverage: <strong>{reason.modelCoveragePct}%</strong></span>
        </div>
      )}
      {reason.normalizedEntropy != null && (
        <div className="why-conf-row">
          <Info size={14} strokeWidth={2.2} />
          <span>Probability uncertainty (normalized entropy): <strong>{Number(reason.normalizedEntropy).toFixed(2)}</strong></span>
        </div>
      )}
      <p className="why-conf-note">Confidence combines calibrated model certainty, feature coverage, and verified local evidence. It is not a guarantee of groundwater.</p>
    </div>
  );
}

function NearbyExplorer({ nearby }) {
  if (!nearby?.length) {
    return (
      <div className="nearby-empty">
        <Info size={15} strokeWidth={2.2} /> No verified wells within 5 km yet.
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

function askAnswer(data) {
  const r = data.confidenceReason || {};
  const n = r.nearbyCount ?? (data.nearby?.length || 0);
  const avg = averageDepth(data.nearby || []);
  const prob = data.successProbability;
  const verdict =
    prob >= 65 ? "Conditions look favourable, but drilling is still uncertain."
    : prob >= 45 ? "It's borderline — consider a hydrogeological second opinion or nearby alternatives."
    : "The estimated odds are low here — compare nearby locations before drilling.";
  const evidence = n
    ? `There ${n === 1 ? "is" : "are"} ${n} verified well${n === 1 ? "" : "s"} within ${r.radiusKm || 5} km (${r.successCount} successful, ${r.failCount} dry)${avg != null ? `, averaging ${avg} ft deep` : ""}.`
    : "There are no verified wells nearby yet.";
  const source = data.predictionSource === "ml" ? `This is trained-model output (${data.modelVersion}).` : "The trained model is unavailable, so this is the labelled heuristic fallback.";
  return `${source} ${evidence} Likely strata/context is ${String(data.rockType || "unknown").toLowerCase()}. Estimated success here is ${prob}% (${data.confidence.toLowerCase()} confidence). ${verdict}`;
}

function AskBoreSakshi({ data }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  function handleAsk(e) {
    e.preventDefault();
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

function ModelDetails({ data }) {
  const depth = data.uncertainty?.depth;
  const yieldUncertainty = data.uncertainty?.yield;
  return (
    <div className="why-conf">
      <div className="why-conf-row"><Info size={14} /><span>Source: <strong>{data.predictionSource === "ml" ? "trained ML" : "heuristic fallback"}</strong></span></div>
      {data.modelVersion && <div className="why-conf-row"><Info size={14} /><span>Model: <strong>{data.modelVersion}</strong></span></div>}
      {data.featureVersion && <div className="why-conf-row"><Info size={14} /><span>Features: <strong>{data.featureVersion}</strong></span></div>}
      {data.predictionTimestamp && <div className="why-conf-row"><Clock size={14} /><span>Predicted: <strong>{fmtDate(data.predictionTimestamp)}</strong></span></div>}
      {depth?.radiusFt != null && <div className="why-conf-row"><Ruler size={14} /><span>Depth interval radius: <strong>±{Math.round(depth.radiusFt)} ft</strong> ({Math.round((depth.targetCoverage || 0) * 100)}% target coverage)</span></div>}
      {yieldUncertainty?.radiusLpm != null && <div className="why-conf-row"><Waves size={14} /><span>Yield interval radius: <strong>±{Math.round(yieldUncertainty.radiusLpm)} LPM</strong> ({Math.round((yieldUncertainty.targetCoverage || 0) * 100)}% target coverage)</span></div>}
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
  const fallback = data.predictionSource === "heuristic_fallback" || data.isMock;

  return (
    <div className="panel panel-result">
      {fallback && (
        <div className="advisory">
          <strong>Trained model unavailable.</strong> This result is the explicitly labelled heuristic fallback, not an ML prediction.
        </div>
      )}
      {data.coverageWarning && !fallback && (
        <div className="advisory"><strong>Coverage warning.</strong> {data.coverageWarning}</div>
      )}

      <div className="result-head">
        <ProbabilityRing value={data.successProbability} />
        <div className="result-head-text">
          <div className="result-title">Drilling outlook</div>
          <div className="result-coords">{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</div>
          <span className="chip" style={{ background: conf.bg, color: conf.fg }}>{data.confidence} confidence</span>
        </div>
      </div>

      <div className="stats">
        <Stat icon={<Ruler size={18} strokeWidth={2.2} />} label="Expected depth" value={`${data.depthBandFt[0]}–${data.depthBandFt[1]} ft`} />
        <Stat icon={<Waves size={18} strokeWidth={2.2} />} label="Expected yield" value={`${data.expectedYieldLpm[0]}–${data.expectedYieldLpm[1]} LPM`} />
        <Stat icon={<Layers size={18} strokeWidth={2.2} />} label="Likely strata" value={data.rockType} />
        <Stat icon={<MapPin size={18} strokeWidth={2.2} />} label="Verified wells nearby" value={data.nearbyVerifiedLogs} sub="within 5 km" />
      </div>

      <div className="basis">{data.basis}</div>
      <AskBoreSakshi data={data} />

      {data.factors?.length > 0 && (
        <Disclosure icon={<Info size={15} strokeWidth={2.2} />} title="Why this prediction?" defaultOpen>
          <FactorBars factors={data.factors} isMock={fallback} />
        </Disclosure>
      )}

      {data.confidenceReason && (
        <Disclosure icon={<Info size={15} strokeWidth={2.2} />} title="Why this confidence?">
          <WhyConfidence reason={data.confidenceReason} />
        </Disclosure>
      )}

      <Disclosure icon={<Info size={15} strokeWidth={2.2} />} title="Model & uncertainty">
        <ModelDetails data={data} />
      </Disclosure>

      <Disclosure icon={<MapPin size={15} strokeWidth={2.2} />} title={`Nearby verified wells (${data.nearby?.length || 0})`} defaultOpen={(data.nearby?.length || 0) > 0}>
        <NearbyExplorer nearby={data.nearby} />
      </Disclosure>

      <div className="advisory">
        <strong>Advisory, not a guarantee.</strong> Groundwater is uncertain even with validated models. Use this result together with local hydrogeological expertise before spending on drilling.
      </div>
    </div>
  );
}
