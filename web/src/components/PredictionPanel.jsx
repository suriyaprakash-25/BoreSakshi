// PredictionPanel.jsx — farmer result card: a trained-model estimate, or an honest
// "no estimate" with the verified wells nearby. It never shows a guessed number.
import { useState } from "react";
import {
  Droplets, DropletOff, AlertTriangle, Loader2, Ruler, Waves, Layers, MapPin,
  ChevronDown, Info, Clock, TrendingUp, TrendingDown, Minus, WifiOff, Hash,
} from "lucide-react";
import ProbabilityRing from "./ProbabilityRing.jsx";
import { fmtDate } from "../metrics.js";
import { useI18n } from "../i18n.jsx";

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

function FactorBars({ factors }) {
  const { t } = useI18n();
  const max = Math.max(1, ...factors.map((f) => Math.abs(f.impact)));
  return (
    <div className="factors">
      {factors.map((f) => {
        const pos = f.impact > 0, neg = f.impact < 0;
        const cls = pos ? "pos" : neg ? "neg" : "zero";
        const width = `${Math.round((Math.abs(f.impact) / max) * 100)}%`;
        return (
          <div className={`factor factor-${cls}`} key={`${f.label}-${f.method || "factor"}`}>
            <div className="factor-top">
              <span className="factor-label">{f.label}</span>
              <span className="factor-impact">
                {pos ? <TrendingUp size={13} strokeWidth={2.4} />
                  : neg ? <TrendingDown size={13} strokeWidth={2.4} /> : <Minus size={13} strokeWidth={2.4} />}
                {`${pos ? "+" : ""}${f.impact}`}
              </span>
            </div>
            <div className="factor-track"><span className="factor-fill" style={{ width }} /></div>
          </div>
        );
      })}
      <p className="factors-note">{t("why.factorsNote")}</p>
    </div>
  );
}

function WhyConfidence({ reason }) {
  const { t } = useI18n();
  const fresh = reason.latestNearbyLogAt ? fmtDate(reason.latestNearbyLogAt) : null;
  return (
    <div className="why-conf">
      <div className="why-conf-row">
        <MapPin size={14} strokeWidth={2.2} />
        <span>{t("why.wells", { count: reason.nearbyCount, radius: reason.radiusKm, success: reason.successCount, dry: reason.failCount })}</span>
      </div>
      <div className="why-conf-row">
        <Clock size={14} strokeWidth={2.2} />
        <span>{t("why.freshness")}: {fresh ? <strong>{fresh}</strong> : t("why.noFresh")}</span>
      </div>
      {reason.modelCoveragePct != null && (
        <div className="why-conf-row">
          <Info size={14} strokeWidth={2.2} />
          <span>{t("why.coverage")}: <strong>{reason.modelCoveragePct}%</strong></span>
        </div>
      )}
      {reason.normalizedEntropy != null && (
        <div className="why-conf-row">
          <Info size={14} strokeWidth={2.2} />
          <span>{t("why.uncertainty")}: <strong>{Number(reason.normalizedEntropy).toFixed(2)}</strong></span>
        </div>
      )}
      <p className="why-conf-note">{t("why.note")}</p>
    </div>
  );
}

function NearbyExplorer({ nearby }) {
  const { t } = useI18n();
  if (!nearby?.length) {
    return (
      <div className="nearby-empty">
        <Info size={15} strokeWidth={2.2} /> {t("nearby.empty")}
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
            <span className="nearby-place">{t("nearby.site")}</span>
            <span className="nearby-meta">
              {w.depthFt != null ? `${w.depthFt} ft` : t("nearby.depthNa")}
              {w.strata ? ` · ${w.strata}` : ""} · {t(w.success ? "nearby.water" : "nearby.dry")}
            </span>
          </span>
          <span className="nearby-dist">{t("nearby.about", { km: w.distanceKm })}</span>
        </li>
      ))}
    </ul>
  );
}

function resultSummary(data, t) {
  const reason = data.confidenceReason || {};
  const count = reason.nearbyCount ?? 0;
  const prob = data.successProbability;
  const verdict = prob >= 65 ? t("result.summaryFavourable") : prob >= 45 ? t("result.summaryBorderline") : t("result.summaryLow");
  const evidence = count
    ? t("result.summaryEvidence", { count, radius: reason.radiusKm || 5, success: reason.successCount, dry: reason.failCount })
    : t("result.summaryEvidenceNone");
  return `${t("result.summaryEstimate", { prob })} ${evidence} ${verdict}`;
}

// A plain restatement of the numbers above. It is not an AI assistant.
function ResultSummary({ data }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (open) return <div className="ask-answer">{resultSummary(data, t)}</div>;
  return <button type="button" className="btn btn-ghost btn-block" onClick={() => setOpen(true)}>{t("result.summaryButton")}</button>;
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
  const { t } = useI18n();
  const depth = data.uncertainty?.depth;
  const yieldUncertainty = data.uncertainty?.yield;
  return (
    <div className="why-conf">
      <div className="why-conf-row"><Info size={14} /><span>{t("why.source")}: <strong>{t("why.sourceMl")}</strong></span></div>
      {data.modelVersion && <div className="why-conf-row"><Info size={14} /><span>{t("why.modelVersion")}: <strong>{data.modelVersion}</strong></span></div>}
      {data.featureVersion && <div className="why-conf-row"><Info size={14} /><span>{t("why.features")}: <strong>{data.featureVersion}</strong></span></div>}
      {data.predictionTimestamp && <div className="why-conf-row"><Clock size={14} /><span>{t("why.predicted")}: <strong>{fmtDate(data.predictionTimestamp)}</strong></span></div>}
      {depth?.radiusFt != null && <div className="why-conf-row"><Ruler size={14} /><span>{t("why.depthRange")}: <strong>±{Math.round(depth.radiusFt)} ft</strong> ({Math.round((depth.targetCoverage || 0) * 100)}% {t("why.targetCoverage")})</span></div>}
      {yieldUncertainty?.radiusLpm != null && <div className="why-conf-row"><Waves size={14} /><span>{t("why.yieldRange")}: <strong>±{Math.round(yieldUncertainty.radiusLpm)} LPM</strong> ({Math.round((yieldUncertainty.targetCoverage || 0) * 100)}% {t("why.targetCoverage")})</span></div>}
    </div>
  );
}

function Advisory() {
  const { t } = useI18n();
  return <div className="advisory"><strong>{t("advisory.title")}</strong> {t("advisory.body")}</div>;
}

function NearbySection({ nearby }) {
  const { t } = useI18n();
  const count = nearby?.length || 0;
  return (
    <Disclosure icon={<MapPin size={15} strokeWidth={2.2} />} title={t("nearby.title", { count })} defaultOpen={count > 0}>
      <NearbyExplorer nearby={nearby} />
    </Disclosure>
  );
}

function PredictionCode({ id }) {
  const { t } = useI18n();
  if (!id) return null;
  return (
    <div className="prediction-code">
      <Hash size={15} strokeWidth={2.2} />
      <span>{t("result.code")}: <strong>{id}</strong></span>
      <small>{t("result.codeHelp")}</small>
    </div>
  );
}

function NoEstimate({ data, coords }) {
  const { t } = useI18n();
  return (
    <div className="panel panel-result">
      <div className="result-head">
        <div className="empty-badge empty-badge-warn"><Info size={28} strokeWidth={2} /></div>
        <div className="result-head-text">
          <div className="result-title">{t("none.title")}</div>
          <div className="result-coords">{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</div>
        </div>
      </div>
      <div className="basis">{t(`none.${data.noEstimateReason}`)}</div>
      <div className="basis">{t("none.next")}</div>
      <PredictionCode id={data.predictionId} />
      <NearbySection nearby={data.nearby} />
      <Advisory />
    </div>
  );
}

export default function PredictionPanel({ status, data, coords, onPinCurrentLocation }) {
  const { t } = useI18n();

  if (status === "idle") {
    return (
      <div className="panel panel-empty">
        <div className="empty-badge"><Droplets size={30} strokeWidth={2} /></div>
        <h2>{t("panel.idleTitle")}</h2>
        <p>{t("panel.idleBody")}</p>
        <button className="btn btn-primary" onClick={onPinCurrentLocation} style={{ marginTop: "1.5rem", display: "inline-flex", alignItems: "center", gap: "8px" }}>
          <MapPin size={18} /> {t("panel.pin")}
        </button>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="panel panel-loading">
        <Loader2 className="spin" size={34} strokeWidth={2.4} />
        <p>{t("panel.loading")}</p>
      </div>
    );
  }

  if (status === "offline" || status === "error") {
    const offline = status === "offline";
    return (
      <div className="panel panel-empty">
        <div className="empty-badge empty-badge-warn">
          {offline ? <WifiOff size={28} strokeWidth={2} /> : <AlertTriangle size={28} strokeWidth={2} />}
        </div>
        <h2>{t(offline ? "panel.offlineTitle" : "panel.errorTitle")}</h2>
        <p>{t(offline ? "panel.offlineBody" : "panel.errorBody")}</p>
      </div>
    );
  }

  if (data.estimateAvailable === false) return <NoEstimate data={data} coords={coords} />;

  const conf = confidenceStyle[data.confidence] || confidenceStyle.Low;

  return (
    <div className="panel panel-result">
      {data.coverageWarning && (
        <div className="advisory"><strong>{t("result.coverage")}</strong> {data.coverageWarning}</div>
      )}

      <div className="result-head">
        <ProbabilityRing value={data.successProbability} />
        <div className="result-head-text">
          <div className="result-title">{t("result.title")}</div>
          <div className="result-coords">{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</div>
          <span className="chip" style={{ background: conf.bg, color: conf.fg }}>{t(`result.confidence.${data.confidence}`)}</span>
        </div>
      </div>

      <div className="stats">
        <Stat icon={<Ruler size={18} strokeWidth={2.2} />} label={t("result.depth")} value={`${data.depthBandFt[0]}–${data.depthBandFt[1]} ft`} />
        <Stat icon={<Waves size={18} strokeWidth={2.2} />} label={t("result.yield")} value={`${data.expectedYieldLpm[0]}–${data.expectedYieldLpm[1]} LPM`} />
        <Stat icon={<Layers size={18} strokeWidth={2.2} />} label={t("result.strata")} value={data.rockType} />
        <Stat icon={<MapPin size={18} strokeWidth={2.2} />} label={t("result.nearby")} value={data.nearbyVerifiedLogs} sub={t("result.within")} />
      </div>

      <div className="basis">{data.basis}</div>

      <PredictionCode id={data.predictionId} />

      <ResultSummary data={data} />

      {data.factors?.length > 0 && (
        <Disclosure icon={<Info size={15} strokeWidth={2.2} />} title={t("why.prediction")} defaultOpen>
          <FactorBars factors={data.factors} />
        </Disclosure>
      )}

      {data.confidenceReason && (
        <Disclosure icon={<Info size={15} strokeWidth={2.2} />} title={t("why.confidence")}>
          <WhyConfidence reason={data.confidenceReason} />
        </Disclosure>
      )}

      <Disclosure icon={<Info size={15} strokeWidth={2.2} />} title={t("why.model")}>
        <ModelDetails data={data} />
      </Disclosure>

      <NearbySection nearby={data.nearby} />
      <Advisory />
    </div>
  );
}
