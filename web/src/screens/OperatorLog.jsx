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
import { isNetworkError } from "../offlineQueue.js";
import { useI18n } from "../i18n.jsx";
import OfflineQueuePanel from "../components/OfflineQueuePanel.jsx";

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
  depthFt: "", waterStrikeFt: "", yieldLpm: "", predictionId: "",
  depthToHardRockFt: "", stopReason: "", yieldMethod: "", siteChosenBy: "",
};

const STOP_REASONS = ["water_found", "budget", "rock_too_hard", "equipment", "gave_up_no_water", "other"];
const YIELD_METHODS = ["timed_container", "flow_meter", "airlift_estimate", "visual_estimate", "not_measured"];
const SITE_METHODS = ["diviner", "geophysical_survey", "near_working_well", "farmer_choice", "boresakshi", "other"];

const emptyLayer = (fromFt = "0") => ({ fromFt, toFt: "", material: "", notes: "" });

export default function OperatorLog() {
  const { operator, signOut } = useAuth();
  const { addLog, queueLog } = useOperatorData();
  const { t, lang: uiLang } = useI18n();
  const location = useLocation();
  const site = location.state?.site || null;

  const [form, setForm] = useState(
    site ? { ...EMPTY, lat: String(site.lat), lng: String(site.lng), placeName: site.village || "" } : EMPTY
  );
  const [success, setSuccess] = useState(null);
  const [lang, setLang] = useState(uiLang);
  const [gps, setGps] = useState({ status: "idle", accuracy: null, capturedAt: null });
  const [layers, setLayers] = useState([emptyLayer()]);
  const [extraStrikes, setExtraStrikes] = useState([]);
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
        if (!isPhoto && !isVideo) throw new Error(t("log.err.fileType"));
        const currentPhotos = evidence.filter((item) => item.kind === "photo").length;
        const currentVideos = evidence.filter((item) => item.kind === "video").length;
        if (isPhoto && currentPhotos >= 8) throw new Error(t("log.err.maxPhotos"));
        if (isVideo && currentVideos >= 2) throw new Error(t("log.err.maxVideos"));
        try {
          const uploaded = navigator.onLine ? await uploadRigEvidence(file) : keepOnPhone(file);
          setEvidence((current) => [...current, uploaded]);
        } catch (err) {
          if (!isNetworkError(err)) throw err;
          setEvidence((current) => [...current, keepOnPhone(file)]);
        }
      }
    } catch (err) {
      if (err.status === 401) { signOut(); return; }
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function keepOnPhone(file) {
    return {
      id: crypto.randomUUID(),
      kind: file.type.startsWith("image/") ? "photo" : "video",
      originalName: file.name,
      byteSize: file.size,
      file,
    };
  }

  async function removeEvidence(item) {
    setError("");
    if (item.file) {
      setEvidence((current) => current.filter((entry) => entry.id !== item.id));
      return;
    }
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
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return t("log.err.location");
    if (gps.status !== "ok" || gps.accuracy == null || !gps.capturedAt) return t("log.err.gps");
    if (!form.drillingDate) return t("log.err.date");
    if (success === null) return t("log.err.outcome");
    if (!(depth > 0)) return t("log.err.depth");
    if (success && !(Number(form.waterStrikeFt) > 0)) return t("log.err.strike");
    if (success && Number(form.waterStrikeFt) > depth) return t("log.err.strikeDeep");
    if (success && !(Number(form.yieldLpm) > 0)) return t("log.err.yield");
    if (layers.length === 0) return t("log.err.layerIncomplete", { n: 1 });
    let previousTo = 0;
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      const from = Number(layer.fromFt);
      const to = Number(layer.toFt);
      if (!layer.material.trim() || !Number.isFinite(from) || !Number.isFinite(to)) return t("log.err.layerIncomplete", { n: i + 1 });
      if (to <= from) return t("log.err.layerOrder", { n: i + 1 });
      if (to > depth) return t("log.err.layerDeep", { n: i + 1 });
      if (i > 0 && from < previousTo) return t("log.err.layerOverlap", { n: i + 1 });
      previousTo = to;
    }
    if (!evidence.some((item) => item.kind === "photo")) return t("log.err.photo");
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
      language: lang,
      ...(form.predictionId.trim() ? { predictionId: form.predictionId.trim() } : {}),
      waterStrikes: [
        ...(success ? [{ depthFt: Number(form.waterStrikeFt), flowLpm: Number(form.yieldLpm) }] : []),
        ...extraStrikes.filter((strike) => Number(strike.depthFt) > 0).map((strike) => ({
          depthFt: Number(strike.depthFt),
          flowLpm: strike.flowLpm === "" ? null : Number(strike.flowLpm),
        })),
      ],
      ...(form.stopReason ? { stopReason: form.stopReason } : {}),
      ...(form.yieldMethod ? { yieldMethod: form.yieldMethod } : {}),
      ...(form.siteChosenBy ? { siteChosenBy: form.siteChosenBy } : {}),
      ...(form.depthToHardRockFt !== "" ? { depthToHardRockFt: Number(form.depthToHardRockFt) } : {}),
    };
    const tokens = evidence.filter((item) => item.token).map((item) => item.token);
    const files = evidence.filter((item) => item.file).map((item) => item.file);
    const saveOnPhone = async () => {
      await queueLog({ payload, tokens, files });
      setEvidence([]);
      setDone({ ...payload, queued: true });
    };

    setSubmitting(true);
    try {
      if (files.length || !navigator.onLine) {
        await saveOnPhone();
        return;
      }
      const record = await logBorewell({ ...payload, evidenceTokens: tokens });
      addLog(record);
      setDone(record);
      setEvidence([]); // tokens were consumed/bound by the server
    } catch (err) {
      if (isNetworkError(err)) { await saveOnPhone(); return; }
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
    setExtraStrikes([]);
    setEvidence([]);
    setError("");
    setDone(null);
    captureLocation();
  }

  if (done) {
    return (
      <div className="op">
        <AppHeader subtitle={t("log.subtitle")} />
        <div className="op-body op-anim">
          <div className="op-done">
            <div className={`op-done-badge ${done.success ? "ok" : "dry"}`}>
              {done.success ? <Droplets size={34} strokeWidth={2} /> : <DropletOff size={32} strokeWidth={2} />}
            </div>
            <h2>{t(done.queued ? "log.queuedTitle" : "log.doneTitle")}</h2>
            <p className="op-done-sub">
              {t(done.success ? "legend.water" : "legend.dry")} · {done.depthFt} ft · {done.drillingDate}
            </p>

            <div className="op-ledger-note">
              <div className="op-ledger-icon"><ShieldCheck size={20} strokeWidth={2.2} /></div>
              <div>
                {done.queued
                  ? t("log.queuedBody")
                  : <><strong>{t("log.pendingTitle")}</strong> {t("log.pendingBody")}</>}
              </div>
            </div>

            <div className="op-done-actions">
              <button className="btn btn-primary" onClick={resetForNext}>
                <RotateCcw size={17} strokeWidth={2.2} /> {t("log.another")}
              </button>
              <Link to="/history" className="btn btn-ghost">{t("log.history")}</Link>
              <Link to="/ledger" className="btn btn-ghost"><Scale size={17} strokeWidth={2.2} /> {t("log.ledger")}</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="op">
      <AppHeader subtitle={t("log.subtitle")} />
      <form className="op-body op-anim" onSubmit={handleSubmit}>
        <p className="op-intro">
          {operator ? <>{t("log.signedAs", { name: operator.name })} </> : null}
          {t("log.intro")}
        </p>

        <OfflineQueuePanel />

        {site && <div className="op-ledger-note"><MapPin size={18} /> Assigned site: <strong>{site.village}</strong>. Capture device GPS at the actual drill point before submitting.</div>}

        {VOICE_SUPPORTED && (
          <div className="op-field">
            <label className="op-label"><Mic size={15} strokeWidth={2.2} /> {t("log.voice")}</label>
            <div className="op-chips">
              {Object.entries(LANGS).map(([k, v]) => (
                <button type="button" key={k} className={`op-chip ${lang === k ? "active" : ""}`}
                  onClick={() => setLang(k)}>{v.label}</button>
              ))}
            </div>
          </div>
        )}

        <div className="op-field">
          <label className="op-label"><MapPin size={15} strokeWidth={2.2} /> {t("log.gps")}</label>
          <div className="op-gps">
            <button type="button" className="op-locate" onClick={captureLocation}>
              <LocateFixed size={16} strokeWidth={2.2} /> {t(gps.status === "locating" ? "log.locating" : "log.capture")}
            </button>
            <span className={`op-gps-status op-gps-${gps.status}`}>
              {gps.status === "ok" && t("log.gpsOk", { m: gps.accuracy })}
              {gps.status === "error" && t("log.gpsError")}
              {gps.status === "locating" && t("log.gpsReading")}
              {gps.status === "idle" && t("log.required")}
            </span>
          </div>
          <div className="op-row">
            <NumInput placeholder={t("log.lat")} value={form.lat} onChange={(v) => set("lat", v)} step="any" readOnly />
            <NumInput placeholder={t("log.lng")} value={form.lng} onChange={(v) => set("lng", v)} step="any" readOnly />
          </div>
        </div>

        <div className="op-row">
          <div className="op-field">
            <label className="op-label"><CalendarDays size={15} /> {t("log.date")}</label>
            <input className="op-input" type="date" max={TODAY} value={form.drillingDate} onChange={(e) => set("drillingDate", e.target.value)} />
          </div>
          <Field label={t("log.village")} labelIcon={MapPin} field="placeName" form={form} set={set}
            listeningField={listeningField} dictate={dictate} placeholder={t("log.villageEg")} />
        </div>

        <div className="op-field">
          <label className="op-label"><Droplets size={15} strokeWidth={2.2} /> {t("log.outcome")}</label>
          <div className="op-toggle">
            <button type="button" className={`op-toggle-btn ok ${success === true ? "active" : ""}`} onClick={() => setSuccess(true)}>
              <Droplets size={19} strokeWidth={2.2} /> {t("legend.water")}
            </button>
            <button type="button" className={`op-toggle-btn dry ${success === false ? "active" : ""}`} onClick={() => setSuccess(false)}>
              <DropletOff size={19} strokeWidth={2.2} /> {t("legend.dry")}
            </button>
          </div>
        </div>

        <Field label={t("log.depth")} labelIcon={Ruler} field="depthFt" form={form} set={set}
          numeric listeningField={listeningField} dictate={dictate} placeholder="e.g. 420" />

        {success !== false && (
          <div className="op-row">
            <Field label={t("log.strike")} labelIcon={Droplets} field="waterStrikeFt" form={form} set={set}
              numeric listeningField={listeningField} dictate={dictate} placeholder="e.g. 280" />
            <Field label={t("log.yield")} labelIcon={Waves} field="yieldLpm" form={form} set={set}
              numeric listeningField={listeningField} dictate={dictate} placeholder="e.g. 45" />
          </div>
        )}

        <div className="op-field phase8-layers">
          <div className="phase8-section-head">
            <label className="op-label"><Layers size={15} strokeWidth={2.2} /> {t("log.layers")}</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addLayer}><Plus size={14} /> {t("log.addLayer")}</button>
          </div>
          {layers.map((layer, index) => (
            <div className="phase8-layer" key={index}>
              <div className="op-row">
                <NumInput placeholder={t("log.from")} value={layer.fromFt} onChange={(v) => setLayer(index, "fromFt", v)} />
                <NumInput placeholder={t("log.to")} value={layer.toFt} onChange={(v) => setLayer(index, "toFt", v)} />
              </div>
              <div className="op-input-wrap">
                <input className="op-input" value={layer.material} onChange={(e) => setLayer(index, "material", e.target.value)} placeholder={t("log.material")} />
                {layers.length > 1 && <button type="button" className="op-mic" title="Remove layer" onClick={() => removeLayer(index)}><Trash2 size={16} /></button>}
              </div>
              <div className="op-chips">
                {STRATA_OPTIONS.map((name) => (
                  <button type="button" key={name} className={`op-chip ${layer.material === name ? "active" : ""}`}
                    onClick={() => setLayer(index, "material", name)}>{name}</button>
                ))}
              </div>
              <input className="op-input" value={layer.notes} onChange={(e) => setLayer(index, "notes", e.target.value)} placeholder={t("log.notes")} />
            </div>
          ))}
        </div>

        <div className="op-field">
          <div className="phase8-section-head">
            <label className="op-label">{t("log.extraStrikes")}</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExtraStrikes((list) => [...list, { depthFt: "", flowLpm: "" }])}>
              <Plus size={14} /> {t("log.addStrike")}
            </button>
          </div>
          {extraStrikes.map((strike, index) => (
            <div className="op-row" key={index}>
              <NumInput placeholder={t("log.strikeDepth")} value={strike.depthFt} onChange={(v) => setExtraStrikes((list) => list.map((item, i) => i === index ? { ...item, depthFt: v } : item))} />
              <NumInput placeholder={t("log.strikeFlow")} value={strike.flowLpm} onChange={(v) => setExtraStrikes((list) => list.map((item, i) => i === index ? { ...item, flowLpm: v } : item))} />
              <button type="button" className="op-mic" title={t("queue.discard")} onClick={() => setExtraStrikes((list) => list.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>

        <Field label={t("log.hardRock")} labelIcon={Layers} field="depthToHardRockFt" form={form} set={set}
          numeric listeningField={listeningField} dictate={dictate} />

        <Choice label={t("log.stopReason")} value={form.stopReason} onChange={(v) => set("stopReason", v)} options={STOP_REASONS} prefix="stop" />
        {success && <Choice label={t("log.yieldMethod")} value={form.yieldMethod} onChange={(v) => set("yieldMethod", v)} options={YIELD_METHODS} prefix="method" />}
        <Choice label={t("log.siteChosen")} value={form.siteChosenBy} onChange={(v) => set("siteChosenBy", v)} options={SITE_METHODS} prefix="site" />

        <div className="op-field">
          <label className="op-label">{t("log.predictionCode")}</label>
          <input className="op-input" value={form.predictionId} onChange={(e) => set("predictionId", e.target.value)} maxLength={32} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <p className="op-voice-note">{t("log.predictionCodeHelp")}</p>
        </div>

        <div className="op-field phase8-evidence">
          <label className="op-label"><Camera size={15} /> {t("log.evidence")}</label>
          <p className="op-voice-note">{t("log.evidenceHelp")}</p>
          <div className="phase8-upload-row">
            <label className="btn btn-ghost btn-sm phase8-file-btn">
              <Camera size={15} /> {t("log.addPhotos")}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
            </label>
            <label className="btn btn-ghost btn-sm phase8-file-btn">
              <Video size={15} /> {t("log.addVideos")}
              <input type="file" accept="video/mp4,video/webm" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
            </label>
            {uploading && <span className="op-gps-status">{t("log.uploading")}</span>}
          </div>
          {evidence.length > 0 && (
            <div className="phase8-evidence-list">
              {evidence.map((item) => (
                <div className="phase8-evidence-item" key={item.id}>
                  <span>{item.kind === "photo" ? <Camera size={14} /> : <Video size={14} />} {item.originalName}</span>
                  <span>{item.file ? t("log.localFile") : `${Math.max(1, Math.round(item.byteSize / 1024))} KB`}</span>
                  <button type="button" className="op-mic" title="Remove evidence" onClick={() => removeEvidence(item)}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div className="op-error">{error}</div>}

        <div className="op-actions">
          <button className="btn btn-primary btn-block op-submit" disabled={submitting || uploading}>
            {submitting ? t("log.submitting") : <>{t(navigator.onLine ? "log.submit" : "log.saveOffline")} <ArrowRight size={18} strokeWidth={2.2} /></>}
          </button>
        </div>
        {!VOICE_SUPPORTED && <p className="op-voice-note">{t("log.noVoice")}</p>}
      </form>
    </div>
  );
}

function Choice({ label, value, onChange, options, prefix }) {
  const { t } = useI18n();
  return (
    <div className="op-field">
      <label className="op-label">{label}</label>
      <select className="op-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{t("log.select")}</option>
        {options.map((option) => <option key={option} value={option}>{t(`${prefix}.${option}`)}</option>)}
      </select>
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
