// LedgerScreen.jsx — public Phase 11 prediction accountability ledger.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Scale, Droplet, DropletOff, Check, X, Activity, Gauge, Ruler, Waves } from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import { getLedger } from "../api.js";

const REFRESH_MS = 10000;

function accuracyColor(pct) {
  if (pct == null) return "var(--slate)";
  if (pct >= 70) return "var(--mint)";
  if (pct >= 50) return "var(--amber)";
  return "var(--red)";
}

function metric(value, suffix = "") {
  return value == null ? "—" : `${value}${suffix}`;
}

export default function LedgerScreen() {
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => getLedger()
      .then((data) => { if (alive) { setLedger(data); setError(false); } })
      .catch(() => { if (alive) setError(true); });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const pending = ledger?.pending ?? (ledger ? ledger.totalPredictions - ledger.scored : 0);
  const accuracy = ledger?.accuracyPct;

  return (
    <div className="op">
      <AppHeader subtitle="Predicted vs. verified outcomes" />

      <div className="ledger-body op-anim">
        <p className="ledger-lead">
          BoreSakshi keeps an accountability record for each <strong>persisted prediction</strong>
          and scores it only when a nearby drilled outcome reaches the verified trust state.
          This view separates real ML model versions from heuristic fallback predictions.
        </p>

        {error && <div className="op-error">Couldn’t reach the BoreSakshi API.</div>}

        <div className="ledger-hero">
          <div className="ledger-acc" style={{ color: accuracyColor(accuracy) }}>
            {accuracy != null ? `${accuracy}%` : "—"}
          </div>
          <div className="ledger-acc-label">
            {accuracy != null
              ? `classification accuracy across ${ledger.scored} currently verified scored prediction${ledger.scored === 1 ? "" : "s"}`
              : "No verified predictions have been scored yet"}
          </div>
        </div>

        <div className="ledger-stats">
          <LedgerStat n={ledger?.totalPredictions ?? "—"} label="Persisted predictions" />
          <LedgerStat n={ledger?.scored ?? "—"} label="Scored (verified)" accent />
          <LedgerStat n={ledger?.correct ?? "—"} label="Success calls correct" />
          <LedgerStat n={ledger ? pending : "—"} label="Pending outcome" muted />
        </div>

        <section className="dash-stats" style={{ marginTop: 16 }}>
          <MetricCard icon={<Gauge size={17} />} value={metric(ledger?.brier)} label="Brier score" note="lower is better" />
          <MetricCard icon={<Activity size={17} />} value={metric(ledger?.expectedCalibrationError)} label="Calibration ECE" note="10-bin observed gap" />
          <MetricCard icon={<Ruler size={17} />} value={metric(ledger?.depth?.maeFt, " ft")} label="Water-strike MAE" note={`${ledger?.depth?.count ?? 0} scored strikes`} />
          <MetricCard icon={<Waves size={17} />} value={metric(ledger?.yield?.maeLpm, " LPM")} label="Yield MAE" note={`${ledger?.yield?.count ?? 0} scored yields`} />
        </section>

        <PerformanceTable title="Model-version performance" items={ledger?.byModelVersion || []} />
        <PerformanceTable title="Regional performance" items={ledger?.byRegion || []} />

        <div className="ledger-recent">
          <div className="ledger-recent-head">
            <h3>Recent verified scores</h3>
            <span className="ledger-live"><i className="ledger-live-dot" /> live</span>
          </div>

          {ledger && ledger.recent.length === 0 && (
            <div className="ledger-empty">
              <div className="ledger-empty-badge"><Scale size={26} strokeWidth={2} /></div>
              <p>
                Nothing is scored yet. Make a persisted prediction on the <Link to="/map">map</Link>;
                once a nearby rig outcome is verified, its accountability metrics appear here.
              </p>
            </div>
          )}

          {ledger && ledger.recent.length > 0 && (
            <div className="ledger-table">
              <div className="ledger-tr ledger-th" style={{ gridTemplateColumns: "1.2fr 1fr 1fr .8fr" }}>
                <span>Prediction / model</span>
                <span>Predicted</span>
                <span>Verified outcome</span>
                <span className="ledger-c">Errors</span>
              </div>
              {ledger.recent.map((row) => {
                const predictedWater = row.predictedProbabilityPct >= 50;
                const actualSuccess = row.actualOutcome?.success === true;
                return (
                  <div className="ledger-tr" key={row.predictionId} style={{ gridTemplateColumns: "1.2fr 1fr 1fr .8fr" }}>
                    <span className="ledger-loc">
                      {row.location?.lat?.toFixed?.(3) ?? "—"}, {row.location?.lng?.toFixed?.(3) ?? "—"}
                      <small style={{ display: "block", opacity: .72 }}>{row.modelIdentity || "unknown"}</small>
                    </span>
                    <span>
                      <span className="ledger-pct">{row.predictedProbabilityPct}%</span>
                      <span className={`ledger-verdict ${predictedWater ? "water" : "dry"}`}>
                        {predictedWater ? "water likely" : "dry likely"}
                      </span>
                      <small style={{ display: "block" }}>
                        strike ≈ {metric(row.predictedDepthFt?.estimate, " ft")} · yield ≈ {metric(row.predictedYieldLpm?.estimate, " LPM")}
                      </small>
                    </span>
                    <span className={`ledger-actual ${actualSuccess ? "ok" : "dry"}`}>
                      {actualSuccess ? <><Droplet size={15} /> water</> : <><DropletOff size={15} /> dry</>}
                      <small style={{ display: "block" }}>
                        strike {metric(row.actualOutcome?.waterStrikeFt, " ft")} · yield {metric(row.actualOutcome?.yieldLpm, " LPM")}
                      </small>
                    </span>
                    <span className="ledger-c">
                      <span className={`ledger-result ${row.metrics?.successCorrect ? "ok" : "miss"}`}>
                        {row.metrics?.successCorrect ? <Check size={16} strokeWidth={3} /> : <X size={16} strokeWidth={3} />}
                      </span>
                      <small style={{ display: "block" }}>
                        depth {metric(row.metrics?.depthAbsoluteErrorFt, " ft")}<br />yield {metric(row.metrics?.yieldAbsoluteErrorLpm, " LPM")}
                      </small>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="ledger-foot">
          Success classification uses the issued ≥50% call. Brier score uses the original issued probability.
          Water-strike error compares the midpoint of the issued depth interval with verified strike depth and excludes dry holes.
          Yield error compares the issued interval midpoint with verified measured yield. Regional/model tables include only currently trusted scored outcomes;
          reopening verification removes the outcome from current metrics while preserving its audit history.
        </p>
      </div>
    </div>
  );
}

function LedgerStat({ n, label, accent, muted }) {
  return (
    <div className={`ledger-stat ${accent ? "accent" : ""} ${muted ? "muted" : ""}`}>
      <div className="ledger-stat-n">{n}</div>
      <div className="ledger-stat-l">{label}</div>
    </div>
  );
}

function MetricCard({ icon, value, label, note }) {
  return (
    <div className="card stat-card">
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
      <div className="dash-card-sub">{note}</div>
    </div>
  );
}

function PerformanceTable({ title, items }) {
  return (
    <section className="card" style={{ marginTop: 16, padding: 18 }}>
      <div className="dash-card-head"><span className="dash-card-title">{title}</span></div>
      {!items.length ? <div className="dash-empty-row">No verified scores yet.</div> : (
        <div className="ledger-table" style={{ marginTop: 10 }}>
          <div className="ledger-tr ledger-th" style={{ gridTemplateColumns: "1.5fr .7fr .7fr .8fr" }}>
            <span>Group</span><span>Scored</span><span>Accuracy</span><span>Brier / MAE</span>
          </div>
          {items.slice(0, 10).map((item) => (
            <div className="ledger-tr" key={item.key} style={{ gridTemplateColumns: "1.5fr .7fr .7fr .8fr" }}>
              <span className="ledger-loc">{item.key}</span>
              <span>{item.scored}</span>
              <span>{metric(item.accuracyPct, "%")}</span>
              <span>
                B {metric(item.brier)}<br />
                D {metric(item.depth?.maeFt, " ft")} · Y {metric(item.yield?.maeLpm, " LPM")}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
