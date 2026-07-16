// LedgerScreen.jsx — the PUBLIC accountability ledger (/ledger).
// This is the moat made visible: every prediction BoreSakshi issued, scored
// against what was actually drilled. Most tools predict; none publish whether
// they were right. This page is that record.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Scale, Droplet, DropletOff, Check, X } from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import { getLedger } from "../api.js";

const REFRESH_MS = 10000; // keep it feeling "live" during a demo

function accuracyColor(pct) {
  if (pct == null) return "var(--slate)";
  if (pct >= 70) return "var(--mint)";
  if (pct >= 50) return "var(--amber)";
  return "var(--red)";
}

export default function LedgerScreen() {
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getLedger()
        .then((d) => { if (alive) { setLedger(d); setError(false); } })
        .catch(() => { if (alive) setError(true); });
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const pending = ledger ? ledger.totalPredictions - ledger.scored : 0;
  const acc = ledger?.accuracyPct;

  return (
    <div className="op">
      <AppHeader subtitle="Predicted vs. actually drilled" />

      <div className="ledger-body op-anim">
        <p className="ledger-lead">
          Most tools predict where to drill. <strong>None publish whether they were
          right.</strong> BoreSakshi scores every prediction against the real outcome
          logged by rig operators — and shows it here.
        </p>

        {error && (
          <div className="op-error">Couldn’t reach the server. Is the API running on <code>localhost:4000</code>?</div>
        )}

        {/* headline accuracy */}
        <div className="ledger-hero">
          <div className="ledger-acc" style={{ color: accuracyColor(acc) }}>
            {acc != null ? `${acc}%` : "—"}
          </div>
          <div className="ledger-acc-label">
            {acc != null
              ? `of ${ledger.scored} verified prediction${ledger.scored === 1 ? "" : "s"} matched the real drilled outcome`
              : "No predictions scored yet — the record starts once a drill is logged near a prediction"}
          </div>
        </div>

        {/* counters */}
        <div className="ledger-stats">
          <LedgerStat n={ledger?.totalPredictions ?? "—"} label="Predictions issued" />
          <LedgerStat n={ledger?.scored ?? "—"} label="Scored (verified)" accent />
          <LedgerStat n={ledger?.correct ?? "—"} label="Called correctly" />
          <LedgerStat n={ledger ? pending : "—"} label="Awaiting a drill" muted />
        </div>

        {/* recent scored rows */}
        <div className="ledger-recent">
          <div className="ledger-recent-head">
            <h3>Recent scored predictions</h3>
            <span className="ledger-live"><i className="ledger-live-dot" /> live</span>
          </div>

          {ledger && ledger.recent.length === 0 && (
            <div className="ledger-empty">
              <div className="ledger-empty-badge"><Scale size={26} strokeWidth={2} /></div>
              <p>
                Nothing scored yet. Drop a pin on the <Link to="/">map</Link> to make a
                prediction, then <Link to="/log">log a drill</Link> nearby — it appears
                here the moment the two are matched.
              </p>
            </div>
          )}

          {ledger && ledger.recent.length > 0 && (
            <div className="ledger-table">
              <div className="ledger-tr ledger-th">
                <span>Location</span>
                <span>Predicted</span>
                <span>Actual</span>
                <span className="ledger-c">Result</span>
              </div>
              {ledger.recent.map((r) => {
                const predictedWater = r.predictedSuccessPct >= 50;
                return (
                  <div className="ledger-tr" key={r.id}>
                    <span className="ledger-loc">{r.lat.toFixed(3)}, {r.lng.toFixed(3)}</span>
                    <span>
                      <span className="ledger-pct">{r.predictedSuccessPct}%</span>
                      <span className={`ledger-verdict ${predictedWater ? "water" : "dry"}`}>
                        {predictedWater ? "water likely" : "dry likely"}
                      </span>
                    </span>
                    <span className={`ledger-actual ${r.actualSuccess ? "ok" : "dry"}`}>
                      {r.actualSuccess
                        ? <><Droplet size={15} strokeWidth={2.2} /> water</>
                        : <><DropletOff size={15} strokeWidth={2.2} /> dry</>}
                    </span>
                    <span className="ledger-c">
                      <span className={`ledger-result ${r.correct ? "ok" : "miss"}`}>
                        {r.correct ? <Check size={16} strokeWidth={3} /> : <X size={16} strokeWidth={3} />}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="ledger-foot">
          A prediction is “correct” when its call (≥50% = water likely) matches whether
          water was actually struck, for a drill logged within 5&nbsp;km. No cherry-picking —
          every scored prediction is counted.
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
