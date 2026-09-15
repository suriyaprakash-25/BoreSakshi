// OperatorLog.jsx — Phase 8 production rig-operator drill logging.
// Authenticated identity + device GPS + structured geology + media evidence.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Droplets, DropletOff, LocateFixed, Mic, Scale, MapPin, Ruler,
  Layers, Waves, ArrowRight, RotateCcw, CalendarDays, Camera,
  Video, Plus, Trash2, ShieldCheck,
} from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import { useAuth } from "../auth.jsx";
import { useOperatorData } from "../operatorData.jsx";
import { deleteRigEvidence, logBorewell, uploadRigEvidence } from "../api.js";

const SpeechRecognition =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);
const VOICE_SUPPORTED = !!SpeechRecognition;

const STRATA_OPTIONS = [
  "top soil",
  "weathered rock",
  "weathered / fractured",
  "fractured granite",
  "hard crystalline rock",
  "compact granite",
];

const LANGS = { ta: { label: "தமிழ்", locale: "ta-IN" }, en: { label: "English", locale: "en-IN" } };
const TODAY = new Date().toISOString().slice(0, 10);

const EMPTY = {
  lat: "", lng: "", placeName: "", drillingDate: TODAY,
  depthFt: "", waterStrikeFt: "", yieldLpm: "",
};

const emptyLayer = (fromFt = "0") => ({ fromFt, toFt: "", material: "", notes: "" });

export default function OperatorLog() {
  const { operator, signOut } = useAuth();
  const { addLog } = useOperatorData();
  const location = useLocation();
  const site = location.state?.site || null;

  const [form, setForm] = useState(
    site ? { ...EMPTY, lat: String(site.lat), lng: String(site.lng), placeName: site.village || "" } : EMPTY
  );
  const [success, setSuccess] = useState(null);
  const [lang, setLang] = useState("ta");
  const [gps, setGps] = useState({ status: "idle", accuracy: null, capturedAt: null });
  const [layers, setLayers] = useState([emptyLayer()]);
  const [evidence, setEvidence] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [listeningField, setListeningField] = useState(null);
  const recognizerRef = useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => { captureLocation(); /* eslint-disable-next-line */ }, []);

  function captureLocation() {
    if (!navigator.geolocation) {
      setGps({ status: "error", accuracy: null, capturedAt: null });
      return;
    }
    setGps({ status: "locating", accuracy: null, capturedAt: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const capturedAt = new Date(pos.timestamp || Date.now()).toISOString();
        set("lat", pos.coords.latitude.toFixed(6));
        set("lng", pos.coords.longitude.toFixed(6));
        setGps({ status: "ok", accuracy: Math.round(pos.coords.accuracy * 10) / 10, capturedAt });
      },
      () => setGps({ status: "error", accuracy: null, capturedAt: null }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function dictate(field, { numeric = false } = {}) {
    if (!VOICE_SUPPORTED) return;
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
        set(field, digits || transcript);
      } else {
        set(field, transcript);
      }
    };
    rec.onerror = () => setListeningField(null);
    rec.onend = () => setListeningField(null);
    rec.start();
  }

  function setLayer(index, key, value) {
    setLayers((current) => current.map((layer, i) => i === index ? { ...layer, [key]: value } : layer));
  }

  function addLayer() {
    const previous = layers[layers.length - 1];
    setLayers((current) => [...current, emptyLayer(previous?.toFt || "")]);
  }

  function removeLayer(index) {
    setLayers((current) => current.length === 1 ? current : current.filter((_, i) => i !== index));
  }

  async function uploadFiles(files) {
    const selected = [...(files || [])];
    if (!selected.length) return;
    setError("");
    setUploading(true);
    try {
      for (const file of selected) {
        const isPhoto = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");
        if (!isPhoto && !isVideo) throw new Error(`${file.name}: only photos/videos are supported`);
        const currentPhotos = evidence.filter((item) => item.kind === "photo").length;
        const currentVideos = evidence.filter((item) => item.kind === "video").length;
        if (isPhoto && currentPhotos >= 8) throw new Error("Maximum 8 photos per drill log");
        if (isVideo && currentVideos >= 2) throw new Error("Maximum 2 videos per drill log");
        const uploaded = await uploadRigEvidence(file);
        setEvidence((current) => [...current, uploaded]);
      }
    } catch (err) {
      if (err.status === 401) { signOut(); return; }
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function removeEvidence(item) {
    setError("");
    try {
      await deleteRigEvidence(item);
      setEvidence((current) => current.filter((entry) => entry.id !== item.id));
    } catch (err) {
      setError(err.message);
    }
  }

  function validateForm() {
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    const depth = Number(form.depthFt);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "Location is required.";
    if (gps.status !== "ok" || gps.accuracy == null || !gps.capturedAt) return "Capture device GPS before submitting so GPS accuracy is recorded.";
    if (!form.drillingDate) return "Enter the drilling date.";
    if (success === null) return "Tap ‘Water found’ or ‘Dry hole’.";
    if (!(depth > 0)) return "Enter the total drilled depth.";
    if (success && !(Number(form.waterStrikeFt) > 0)) return "Enter the water-strike depth.";
    if (success && Number(form.waterStrikeFt) > depth) return "Water-strike depth cannot exceed total depth.";
    if (success && !(Number(form.yieldLpm) > 0)) return "Enter the measured yield.";
    if (layers.length === 0) return "Add at least one geological layer.";
    let previousTo = 0;
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      const from = Number(layer.fromFt);
      const to = Number(layer.toFt);
      if (!layer.material.trim() || !Number.isFinite(from) || !Number.isFinite(to)) return `Complete geological layer ${i + 1}.`;
      if (to <= from) return `Layer ${i + 1}: end depth must be greater than start depth.`;
      if (to > depth) return `Layer ${i + 1} extends below total drilled depth.`;
      if (i > 0 && from < previousTo) return `Layer ${i + 1} overlaps the previous layer.`;
      previousTo = to;
    }
    if (!evidence.some((item) => item.kind === "photo")) return "Upload at least one drilling-site photo.";
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const problem = validateForm();
    if (problem) return setError(problem);

    const payload = {
      lat: Number(form.lat),
      lng: Number(form.lng),
      gpsAccuracyM: Number(gps.accuracy),
      gpsCapturedAt: gps.capturedAt,
      drillingDate: form.drillingDate,
      placeName: form.placeName.trim(),
      depthFt: Number(form.depthFt),
      strata: layers.map((layer) => layer.material.trim()).filter(Boolean).join(" → "),
      geologicalLayers: layers.map((layer) => ({
        fromFt: Number(layer.fromFt),
        toFt: Number(layer.toFt),
        material: layer.material.trim(),
        notes: layer.notes.trim(),
      })),
      waterStrikeFt: success ? Number(form.waterStrikeFt) : 0,
      yieldLpm: success ? Number(form.yieldLpm) : 0,
      success,
      evidenceTokens: evidence.map((item) => item.token),
      language: lang,
    };

    setSubmitting(true);
    try {
      const record = await logBorewell(payload);
      addLog(record);
      setDone(record);
      setEvidence([]); // tokens were consumed/bound by the server
    } catch (err) {
      if (err.status === 401) { signOut(); return; }
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function resetForNext() {
    setForm((f) => ({ ...EMPTY, lat: f.lat, lng: f.lng, placeName: "" }));
    setSuccess(null);
    setLayers([emptyLayer()]);
    setEvidence([]);
    setError("");
    setDone(null);
    captureLocation();
  }

  if (done) {
    return (
      <div className="op">
        <AppHeader subtitle="Rig operator · log outcome" />
        <div className="op-body op-anim">
          <div className="op-done">
            <div className={`op-done-badge ${done.success ? "ok" : "dry"}`}>
              {done.success ? <Droplets size={34} strokeWidth={2} /> : <DropletOff size={32} strokeWidth={2} />}
            </div>
            <h2>Drill log submitted</h2>
            <p className="op-done-sub">
              {done.success ? "Water found" : "Dry hole"} · {done.depthFt} ft · {done.drillingDate}
            </p>

            <div className="op-ledger-note">
              <div className="op-ledger-icon"><ShieldCheck size={20} strokeWidth={2.2} /></div>
              <div>
                <strong>Pending verification.</strong> This submission is stored with GPS accuracy,
                structured geology and evidence. It will affect the public accountability ledger and
                ML/training data only after verification.
              </div>
            </div>

            <div className="op-done-actions">
              <button className="btn btn-primary" onClick={resetForNext}>
                <RotateCcw size={17} strokeWidth={2.2} /> Log another job
              </button>
              <Link to="/history" className="btn btn-ghost">View submission history</Link>
              <Link to="/ledger" className="btn btn-ghost"><Scale size={17} strokeWidth={2.2} /> Public ledger</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="op">
      <AppHeader subtitle="Rig operator · structured drilling record" />
      <form className="op-body op-anim" onSubmit={handleSubmit}>
        <p className="op-intro">
          {operator ? <>Signed in as <strong>{operator.name}</strong>. </> : null}
          Your authenticated account is the operator identity for this record. Submitted data stays
          pending until verification.
        </p>

        {site && <div className="op-ledger-note"><MapPin size={18} /> Assigned site: <strong>{site.village}</strong>. Capture device GPS at the actual drill point before submitting.</div>}

        {VOICE_SUPPORTED && (
          <div className="op-field">
            <label className="op-label"><Mic size={15} strokeWidth={2.2} /> Voice language</label>
            <div className="op-chips">
              {Object.entries(LANGS).map(([k, v]) => (
                <button type="button" key={k} className={`op-chip ${lang === k ? "active" : ""}`}
                  onClick={() => setLang(k)}>{v.label}</button>
              ))}
            </div>
          </div>
        )}

        <div className="op-field">
          <label className="op-label"><MapPin size={15} strokeWidth={2.2} /> GPS drill location *</label>
          <div className="op-gps">
            <button type="button" className="op-locate" onClick={captureLocation}>
              <LocateFixed size={16} strokeWidth={2.2} /> {gps.status === "locating" ? "Locating…" : "Capture GPS"}
            </button>
            <span className={`op-gps-status op-gps-${gps.status}`}>
              {gps.status === "ok" && `Captured · ±${gps.accuracy} m`}
              {gps.status === "error" && "GPS unavailable — retry with location enabled"}
              {gps.status === "locating" && "Reading high-accuracy GPS…"}
              {gps.status === "idle" && "Required"}
            </span>
          </div>
          <div className="op-row">
            <NumInput placeholder="Latitude" value={form.lat} onChange={(v) => set("lat", v)} step="any" readOnly />
            <NumInput placeholder="Longitude" value={form.lng} onChange={(v) => set("lng", v)} step="any" readOnly />
          </div>
        </div>

        <div className="op-row">
          <div className="op-field">
            <label className="op-label"><CalendarDays size={15} /> Drilling date *</label>
            <input className="op-input" type="date" max={TODAY} value={form.drillingDate} onChange={(e) => set("drillingDate", e.target.value)} />
          </div>
          <Field label="Village / area" labelIcon={MapPin} field="placeName" form={form} set={set}
            listeningField={listeningField} dictate={dictate} placeholder="e.g. Pallipalayam" />
        </div>

        <div className="op-field">
          <label className="op-label"><Droplets size={15} strokeWidth={2.2} /> Outcome *</label>
          <div className="op-toggle">
            <button type="button" className={`op-toggle-btn ok ${success === true ? "active" : ""}`} onClick={() => setSuccess(true)}>
              <Droplets size={19} strokeWidth={2.2} /> Water found
            </button>
            <button type="button" className={`op-toggle-btn dry ${success === false ? "active" : ""}`} onClick={() => setSuccess(false)}>
              <DropletOff size={19} strokeWidth={2.2} /> Dry hole
            </button>
          </div>
        </div>

        <Field label="Total depth (ft) *" labelIcon={Ruler} field="depthFt" form={form} set={set}
          numeric listeningField={listeningField} dictate={dictate} placeholder="e.g. 420" />

        {success !== false && (
          <div className="op-row">
            <Field label="Water strike (ft) *" labelIcon={Droplets} field="waterStrikeFt" form={form} set={set}
              numeric listeningField={listeningField} dictate={dictate} placeholder="e.g. 280" />
            <Field label="Measured yield (LPM) *" labelIcon={Waves} field="yieldLpm" form={form} set={set}
              numeric listeningField={listeningField} dictate={dictate} placeholder="e.g. 45" />
          </div>
        )}

        <div className="op-field phase8-layers">
          <div className="phase8-section-head">
            <label className="op-label"><Layers size={15} strokeWidth={2.2} /> Geological layers *</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addLayer}><Plus size={14} /> Add layer</button>
          </div>
          {layers.map((layer, index) => (
            <div className="phase8-layer" key={index}>
              <div className="op-row">
                <NumInput placeholder="From ft" value={layer.fromFt} onChange={(v) => setLayer(index, "fromFt", v)} />
                <NumInput placeholder="To ft" value={layer.toFt} onChange={(v) => setLayer(index, "toFt", v)} />
              </div>
              <div className="op-input-wrap">
                <input className="op-input" value={layer.material} onChange={(e) => setLayer(index, "material", e.target.value)} placeholder="Layer material / rock type" />
                {layers.length > 1 && <button type="button" className="op-mic" title="Remove layer" onClick={() => removeLayer(index)}><Trash2 size={16} /></button>}
              </div>
              <div className="op-chips">
                {STRATA_OPTIONS.map((name) => (
                  <button type="button" key={name} className={`op-chip ${layer.material === name ? "active" : ""}`}
                    onClick={() => setLayer(index, "material", name)}>{name}</button>
                ))}
              </div>
              <input className="op-input" value={layer.notes} onChange={(e) => setLayer(index, "notes", e.target.value)} placeholder="Layer notes (optional)" />
            </div>
          ))}
        </div>

        <div className="op-field phase8-evidence">
          <label className="op-label"><Camera size={15} /> Evidence *</label>
          <p className="op-voice-note">At least one site/drilling photo is required. Up to 8 photos and 2 optional videos. Files are checksum-verified by the server.</p>
          <div className="phase8-upload-row">
            <label className="btn btn-ghost btn-sm phase8-file-btn">
              <Camera size={15} /> Add photos
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
            </label>
            <label className="btn btn-ghost btn-sm phase8-file-btn">
              <Video size={15} /> Add videos
              <input type="file" accept="video/mp4,video/webm" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
            </label>
            {uploading && <span className="op-gps-status">Uploading…</span>}
          </div>
          {evidence.length > 0 && (
            <div className="phase8-evidence-list">
              {evidence.map((item) => (
                <div className="phase8-evidence-item" key={item.id}>
                  <span>{item.kind === "photo" ? <Camera size={14} /> : <Video size={14} />} {item.originalName}</span>
                  <span>{Math.max(1, Math.round(item.byteSize / 1024))} KB</span>
                  <button type="button" className="op-mic" title="Remove evidence" onClick={() => removeEvidence(item)}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div className="op-error">{error}</div>}

        <div className="op-actions">
          <button className="btn btn-primary btn-block op-submit" disabled={submitting || uploading}>
            {submitting ? "Submitting…" : <>Submit for verification <ArrowRight size={18} strokeWidth={2.2} /></>}
          </button>
        </div>
        {!VOICE_SUPPORTED && <p className="op-voice-note">Voice input isn’t supported in this browser — typing remains fully supported.</p>}
      </form>
    </div>
  );
}

function Field({ label, labelIcon: Icon, field, form, set, numeric, listeningField, dictate, placeholder }) {
  return (
    <div className="op-field">
      <label className="op-label">{Icon && <Icon size={15} strokeWidth={2.2} />} {label}</label>
      <div className="op-input-wrap">
        {numeric ? (
          <NumInput value={form[field]} onChange={(v) => set(field, v)} placeholder={placeholder} />
        ) : (
          <input className="op-input" value={form[field]} onChange={(e) => set(field, e.target.value)} placeholder={placeholder} />
        )}
        <MicButton field={field} listeningField={listeningField} onClick={() => dictate(field, { numeric })} />
      </div>
    </div>
  );
}

function NumInput({ value, onChange, placeholder, step, readOnly = false }) {
  return (
    <input className="op-input" type="number" inputMode="decimal" step={step || "1"}
      value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} readOnly={readOnly} />
  );
}

function MicButton({ field, listeningField, onClick }) {
  if (!VOICE_SUPPORTED) return null;
  const active = listeningField === field;
  return (
    <button type="button" className={`op-mic ${active ? "listening" : ""}`}
      onClick={onClick} aria-label="Dictate this field" title="Dictate">
      <Mic size={17} strokeWidth={2.2} />
    </button>
  );
}
