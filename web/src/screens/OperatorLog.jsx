// OperatorLog.jsx — the rig-operator drill-logging screen (auth-gated by /log).
// Mobile-web, type-first with OPTIONAL voice dictation, auto-GPS location.
// Every completed job logged here becomes a VERIFIED OUTCOME that feeds the
// accountability ledger — the confirmation screen makes that contribution visible.
// Operator identity comes from the signed-in account, not a free-text field.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Droplets, DropletOff, LocateFixed, Mic, Scale, MapPin, Ruler,
  Layers, Waves, ArrowRight, RotateCcw,
} from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import { useAuth } from "../auth.jsx";
import { useOperatorData } from "../operatorData.jsx";
import { logBorewell } from "../api.js";

// Web Speech API is optional; the form is fully usable by typing if it's absent.
const SpeechRecognition =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);
const VOICE_SUPPORTED = !!SpeechRecognition;

// strata vocabulary matches the seed data / prediction zones
const STRATA_OPTIONS = [
  "weathered rock",
  "weathered / fractured",
  "fractured granite",
  "hard crystalline rock",
  "compact granite",
];

const LANGS = { ta: { label: "தமிழ்", locale: "ta-IN" }, en: { label: "English", locale: "en-IN" } };

const EMPTY = {
  lat: "", lng: "", placeName: "", depthFt: "", strata: "", waterStrikeFt: "", yieldLpm: "",
};

export default function OperatorLog() {
  const { operator, signOut } = useAuth();
  const { addLog } = useOperatorData();
  const location = useLocation();
  const site = location.state?.site || null; // arrived via a "Log now" assigned-site button

  const [form, setForm] = useState(
    site ? { ...EMPTY, lat: String(site.lat), lng: String(site.lng), placeName: site.village || "" } : EMPTY
  );
  const [success, setSuccess] = useState(null);   // true = water found, false = dry
  const [lang, setLang] = useState("ta");
  // "site" = coordinates came from an assigned site, so don't overwrite with device GPS
  const [gps, setGps] = useState(site ? { status: "site", accuracy: null } : { status: "idle", accuracy: null });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);         // the saved record (confirmation)
  const [listeningField, setListeningField] = useState(null);
  const recognizerRef = useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // ---- auto-GPS on mount (skip when a site's coordinates were passed in) ----
  useEffect(() => { if (!site) captureLocation(); /* eslint-disable-next-line */ }, []);

  function captureLocation() {
    if (!navigator.geolocation) { setGps({ status: "error", accuracy: null }); return; }
    setGps({ status: "locating", accuracy: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set("lat", pos.coords.latitude.toFixed(6));
        set("lng", pos.coords.longitude.toFixed(6));
        setGps({ status: "ok", accuracy: Math.round(pos.coords.accuracy) });
      },
      () => setGps({ status: "error", accuracy: null }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  // ---- optional voice dictation into a single field -----------------------
  function dictate(field, { numeric = false } = {}) {
    if (!VOICE_SUPPORTED) return;
    // stop any in-flight recognition first
    if (recognizerRef.current) { try { recognizerRef.current.stop(); } catch {} }

    const rec = new SpeechRecognition();
    rec.lang = LANGS[lang].locale;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    recognizerRef.current = rec;
    setListeningField(field);

    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript.trim();
      if (numeric) {
        const digits = transcript.replace(/[^\d.]/g, "");
        set(field, digits || transcript); // fall back to raw if no digits heard
      } else {
        set(field, transcript);
      }
    };
    rec.onerror = () => setListeningField(null);
    rec.onend = () => setListeningField(null);
    rec.start();
  }

  // ---- submit -------------------------------------------------------------
  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const lat = parseFloat(form.lat);
    const lng = parseFloat(form.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return setError("Location (lat/lng) is required — use ‘Locate me’ or type it.");
    if (success === null) return setError("Tap ‘Water found’ or ‘Dry hole’ to record the outcome.");
    if (!form.depthFt) return setError("Enter the total drilled depth.");

    const payload = {
      lat, lng,
      placeName: form.placeName.trim(),
      depthFt: Number(form.depthFt),
      strata: form.strata.trim(),
      // a dry hole has no strike/yield; record them as 0 rather than leaving stale numbers
      waterStrikeFt: success ? (form.waterStrikeFt ? Number(form.waterStrikeFt) : null) : 0,
      yieldLpm: success ? (form.yieldLpm ? Number(form.yieldLpm) : null) : 0,
      success,
      language: lang,
      // operatorId / operatorName are set server-side from the auth token
    };

    setSubmitting(true);
    try {
      const record = await logBorewell(payload);
      addLog(record); // shared state → shows up on Dashboard + History immediately
      setDone(record);
    } catch (err) {
      // token missing/expired → drop the session so the route sends them to sign in
      if (err.status === 401) { signOut(); return; }
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function resetForNext() {
    // keep the last location (usually the same rig working the same site cluster)
    setForm((f) => ({ ...EMPTY, lat: f.lat, lng: f.lng }));
    setSuccess(null);
    setError("");
    setDone(null);
  }

  // ---- confirmation screen (ledger tie-in) --------------------------------
  if (done) {
    return (
      <div className="op">
        <AppHeader subtitle="Rig operator · log outcome" />
        <div className="op-body op-anim">
          <div className="op-done">
            <div className={`op-done-badge ${done.success ? "ok" : "dry"}`}>
              {done.success
                ? <Droplets size={34} strokeWidth={2} />
                : <DropletOff size={32} strokeWidth={2} />}
            </div>
            <h2>Outcome logged</h2>
            <p className="op-done-sub">
              {done.success ? "Water found" : "Dry hole"} · {done.depthFt} ft ·{" "}
              {done.lat.toFixed(4)}, {done.lng.toFixed(4)}
            </p>

            <div className="op-ledger-note">
              <div className="op-ledger-icon"><Scale size={20} strokeWidth={2.2} /></div>
              <div>
                {done.scoredPredictions > 0 ? (
                  <>
                    <strong>This just scored {done.scoredPredictions} open prediction
                    {done.scoredPredictions > 1 ? "s" : ""}</strong> on the public
                    accountability ledger — predicted vs. actually drilled.
                  </>
                ) : (
                  <>
                    <strong>Added to the verified-outcome record.</strong> Any BoreSakshi
                    prediction within 5&nbsp;km will now be scored against this real result.
                  </>
                )}
              </div>
            </div>

            <div className="op-done-actions">
              <button className="btn btn-primary" onClick={resetForNext}>
                <RotateCcw size={17} strokeWidth={2.2} /> Log another job
              </button>
              <Link to="/ledger" className="btn btn-ghost">
                <Scale size={17} strokeWidth={2.2} /> See the ledger
              </Link>
              <Link to="/" className="btn btn-ghost">
                <MapPin size={17} strokeWidth={2.2} /> View farmer map
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- the form -----------------------------------------------------------
  return (
    <div className="op">
      <AppHeader subtitle="Rig operator · log outcome" />
      <form className="op-body op-anim" onSubmit={handleSubmit}>
        <p className="op-intro">
          {operator ? <>Signed in as <strong>{operator.name}</strong>. </> : null}
          Log a completed borewell — real outcomes are what make the next prediction
          trustworthy, and build your job history.
        </p>

        {/* voice language (only relevant when dictation is available) */}
        {VOICE_SUPPORTED && (
          <div className="op-field">
            <label className="op-label"><Mic size={15} strokeWidth={2.2} /> Voice language</label>
            <div className="op-chips">
              {Object.entries(LANGS).map(([k, v]) => (
                <button type="button" key={k}
                  className={`op-chip ${lang === k ? "active" : ""}`}
                  onClick={() => setLang(k)}>{v.label}</button>
              ))}
            </div>
          </div>
        )}

        {/* location */}
        <div className="op-field">
          <label className="op-label"><MapPin size={15} strokeWidth={2.2} /> Location</label>
          <div className="op-gps">
            <button type="button" className="op-locate" onClick={captureLocation}>
              <LocateFixed size={16} strokeWidth={2.2} />
              {gps.status === "locating" ? "Locating…" : "Locate me"}
            </button>
            <span className={`op-gps-status op-gps-${gps.status}`}>
              {gps.status === "ok" && `GPS ±${gps.accuracy} m`}
              {gps.status === "error" && "GPS unavailable — type it"}
              {gps.status === "locating" && "Reading GPS…"}
              {gps.status === "site" && `Assigned site · ${site.village}`}
              {gps.status === "idle" && "—"}
            </span>
          </div>
          <div className="op-row">
            <NumInput placeholder="Latitude" value={form.lat} onChange={(v) => set("lat", v)} step="any" />
            <NumInput placeholder="Longitude" value={form.lng} onChange={(v) => set("lng", v)} step="any" />
          </div>
        </div>

        {/* village / area (optional) — prefilled when logging an assigned site */}
        <Field label="Village / area (optional)" labelIcon={MapPin} field="placeName" form={form} set={set}
          listeningField={listeningField} dictate={dictate} placeholder="e.g. Pallipalayam" />

        {/* outcome */}
        <div className="op-field">
          <label className="op-label"><Droplets size={15} strokeWidth={2.2} /> Outcome</label>
          <div className="op-toggle">
            <button
              type="button"
              className={`op-toggle-btn ok ${success === true ? "active" : ""}`}
              onClick={() => setSuccess(true)}
            ><Droplets size={19} strokeWidth={2.2} /> Water found</button>
            <button
              type="button"
              className={`op-toggle-btn dry ${success === false ? "active" : ""}`}
              onClick={() => setSuccess(false)}
            ><DropletOff size={19} strokeWidth={2.2} /> Dry hole</button>
          </div>
        </div>

        {/* depth */}
        <Field label="Total depth (ft)" labelIcon={Ruler} field="depthFt" form={form} set={set}
          numeric listeningField={listeningField} dictate={dictate} placeholder="e.g. 240" />

        {/* strata */}
        <div className="op-field">
          <label className="op-label"><Layers size={15} strokeWidth={2.2} /> Strata / rock type</label>
          <div className="op-input-wrap">
            <input
              className="op-input"
              value={form.strata}
              onChange={(e) => set("strata", e.target.value)}
              placeholder="e.g. weathered rock"
            />
            <MicButton field="strata" listeningField={listeningField} onClick={() => dictate("strata")} />
          </div>
          <div className="op-chips">
            {STRATA_OPTIONS.map((s) => (
              <button type="button" key={s}
                className={`op-chip ${form.strata === s ? "active" : ""}`}
                onClick={() => set("strata", s)}>{s}</button>
            ))}
          </div>
        </div>

        {/* strike + yield only make sense for a wet hole */}
        {success !== false && (
          <div className="op-row">
            <Field label="Water strike (ft)" labelIcon={Droplets} field="waterStrikeFt" form={form} set={set}
              numeric listeningField={listeningField} dictate={dictate} placeholder="e.g. 210" />
            <Field label="Yield (LPM)" labelIcon={Waves} field="yieldLpm" form={form} set={set}
              numeric listeningField={listeningField} dictate={dictate} placeholder="e.g. 600" />
          </div>
        )}

        {error && <div className="op-error">{error}</div>}

        <div className="op-actions">
          <button className="btn btn-primary btn-block op-submit" disabled={submitting}>
            {submitting ? "Saving…" : <>Submit drill log <ArrowRight size={18} strokeWidth={2.2} /></>}
          </button>
        </div>
        {!VOICE_SUPPORTED && (
          <p className="op-voice-note">Voice input isn’t supported in this browser — type the fields (works everywhere).</p>
        )}
      </form>
    </div>
  );
}

// ---- small pieces ---------------------------------------------------------
function Field({ label, labelIcon: Icon, field, form, set, numeric, listeningField, dictate, placeholder }) {
  return (
    <div className="op-field">
      <label className="op-label">{Icon && <Icon size={15} strokeWidth={2.2} />} {label}</label>
      <div className="op-input-wrap">
        {numeric ? (
          <NumInput value={form[field]} onChange={(v) => set(field, v)} placeholder={placeholder} />
        ) : (
          <input className="op-input" value={form[field]}
            onChange={(e) => set(field, e.target.value)} placeholder={placeholder} />
        )}
        <MicButton field={field} listeningField={listeningField}
          onClick={() => dictate(field, { numeric })} />
      </div>
    </div>
  );
}

function NumInput({ value, onChange, placeholder, step }) {
  return (
    <input
      className="op-input"
      type="number"
      inputMode="decimal"
      step={step || "1"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function MicButton({ field, listeningField, onClick }) {
  if (!VOICE_SUPPORTED) return null;
  const active = listeningField === field;
  return (
    <button type="button"
      className={`op-mic ${active ? "listening" : ""}`}
      onClick={onClick}
      aria-label="Dictate this field"
      title="Dictate">
      <Mic size={17} strokeWidth={2.2} />
    </button>
  );
}
