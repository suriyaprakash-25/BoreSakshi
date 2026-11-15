import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import MapView from "../components/MapView.jsx";
import PredictionPanel from "../components/PredictionPanel.jsx";
import AppHeader from "../components/AppHeader.jsx";
import LegalFooter from "../components/LegalFooter.jsx";
import { getPrediction, getBorewells, getLedger } from "../api.js";
import { mapPickFromGeolocation, normalizeMapPick } from "../mapInteraction.js";
import { useI18n } from "../i18n.jsx";
import toast from "react-hot-toast";

const DEFAULT_CENTER = [11.36, 77.8]; // Namakkal / Tiruchengode belt
const NOTICE_KEY = "boresakshi_notice_accepted";

function noticeAccepted() {
  try { return localStorage.getItem(NOTICE_KEY) === "yes"; } catch { return false; }
}

function NoticeCard({ onAccept }) {
  const { t } = useI18n();
  return (
    <div className="panel panel-empty">
      <div className="empty-badge"><ShieldCheck size={30} strokeWidth={2} /></div>
      <h2>{t("consent.title")}</h2>
      <p>{t("consent.body")}</p>
      <p>{t("consent.storage")}</p>
      <button type="button" className="btn btn-primary" onClick={onAccept}>{t("consent.accept")}</button>
      <p className="legal-inline"><Link to="/privacy">{t("consent.links")}</Link></p>
    </div>
  );
}

export default function FarmerScreen() {
  const { t } = useI18n();
  const [accepted, setAccepted] = useState(noticeAccepted);
  const [selected, setSelected] = useState(null);
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [status, setStatus] = useState("idle"); // idle | loading | result | error | offline
  const [prediction, setPrediction] = useState(null);
  const [borewells, setBorewells] = useState([]);
  const [ledger, setLedger] = useState(null);
  const latestPick = useRef(0);

  useEffect(() => {
    getBorewells().then(setBorewells).catch(() => {});
    getLedger().then(setLedger).catch(() => {});
  }, []);

  function acceptNotice() {
    try { localStorage.setItem(NOTICE_KEY, "yes"); } catch { /* still accepted this session */ }
    setAccepted(true);
  }

  async function handlePick(lat, lng) {
    if (!accepted) return;
    let point;
    try { point = normalizeMapPick(lat, lng); }
    catch {
      setStatus("error");
      return;
    }
    const pick = ++latestPick.current;
    setSelected(point);
    if (!navigator.onLine) {
      setStatus("offline");
      return;
    }
    setStatus("loading");
    try {
      const data = await getPrediction(point.lat, point.lng);
      if (pick !== latestPick.current) return; // a newer tap has taken over
      setPrediction(data);
      setStatus("result");
      getLedger().then(setLedger).catch(() => {});
    } catch {
      if (pick === latestPick.current) setStatus("error");
    }
  }

  function handlePinCurrentLocation() {
    if (!navigator.geolocation) {
      toast.error(t("farmer.locationUnsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        try {
          const point = mapPickFromGeolocation(pos);
          setMapCenter([point.lat, point.lng]);
          handlePick(point.lat, point.lng);
        } catch {
          toast.error(t("farmer.locationBad"));
        }
      },
      () => toast.error(t("farmer.locationBad"))
    );
  }

  return (
    <div className="app">
      <AppHeader subtitle={t("brand.tagline")}>
        <div className="metric">
          <span className="metric-num">{borewells.length}</span>
          <span className="metric-label">{t("farmer.wells")}</span>
        </div>
        <div className="metric metric-accent">
          <span className="metric-num">
            {ledger?.accuracyPct != null ? `${ledger.accuracyPct}%` : "—"}
          </span>
          <span className="metric-label">
            {t("farmer.accuracy")}{ledger?.scored ? ` (${ledger.scored})` : ""}
          </span>
        </div>
      </AppHeader>

      <main className="layout">
        <section className="map-col">
          <MapView
            center={mapCenter}
            selected={selected}
            onPick={handlePick}
            borewells={borewells}
          />
          <div className="map-legend">
            <span><i className="dot dot-green" /> {t("legend.water")}</span>
            <span><i className="dot dot-red" /> {t("legend.dry")}</span>
            <span><i className="dot dot-pin" /> {t("legend.point")}</span>
          </div>
          <p className="map-note">{t("legend.blur")}</p>
        </section>

        <aside className="panel-col">
          {accepted
            ? <PredictionPanel status={status} data={prediction} coords={selected || { lat: 0, lng: 0 }} onPinCurrentLocation={handlePinCurrentLocation} />
            : <NoticeCard onAccept={acceptNotice} />}
          <LegalFooter />
        </aside>
      </main>
    </div>
  );
}
