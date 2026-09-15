import { useEffect, useState } from "react";
import MapView from "../components/MapView.jsx";
import PredictionPanel from "../components/PredictionPanel.jsx";
import AppHeader from "../components/AppHeader.jsx";
import { getPrediction, getBorewells, getLedger } from "../api.js";
import { mapPickFromGeolocation, normalizeMapPick } from "../mapInteraction.js";
import toast from "react-hot-toast";

const DEFAULT_CENTER = [11.36, 77.8]; // Namakkal / Tiruchengode belt

export default function FarmerScreen() {
  const [selected, setSelected] = useState(null);
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [status, setStatus] = useState("idle"); // idle | loading | result | error
  const [prediction, setPrediction] = useState(null);
  const [borewells, setBorewells] = useState([]);
  const [ledger, setLedger] = useState(null);

  useEffect(() => {
    getBorewells().then(setBorewells).catch(() => {});
    getLedger().then(setLedger).catch(() => {});
  }, []);

  async function handlePick(lat, lng) {
    let point;
    try { point = normalizeMapPick(lat, lng); }
    catch {
      setStatus("error");
      return;
    }
    setSelected(point);
    setStatus("loading");
    try {
      const data = await getPrediction(point.lat, point.lng);
      setPrediction(data);
      setStatus("result");
      getLedger().then(setLedger).catch(() => {});
    } catch {
      setStatus("error");
    }
  }

  function handlePinCurrentLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          try {
            const point = mapPickFromGeolocation(pos);
            setMapCenter([point.lat, point.lng]);
            handlePick(point.lat, point.lng);
          } catch (err) {
            toast.error("Invalid current location: " + err.message);
          }
        },
        (err) => {
          toast.error("Could not get current location: " + err.message);
        }
      );
    } else {
      toast.error("Geolocation is not supported by this browser.");
    }
  }

  return (
    <div className="app">
      <AppHeader subtitle="Know before you drill">
        <div className="metric">
          <span className="metric-num">{borewells.length}</span>
          <span className="metric-label">verified wells</span>
        </div>
        <div className="metric metric-accent">
          <span className="metric-num">
            {ledger?.accuracyPct != null ? `${ledger.accuracyPct}%` : "—"}
          </span>
          <span className="metric-label">
            accuracy{ledger?.scored ? ` (${ledger.scored})` : ""}
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
            <span><i className="dot dot-green" /> Water found</span>
            <span><i className="dot dot-red" /> Dry hole</span>
            <span><i className="dot dot-pin" /> Your point</span>
          </div>
        </section>

        <aside className="panel-col">
          <PredictionPanel status={status} data={prediction} coords={selected || { lat: 0, lng: 0 }} onPinCurrentLocation={handlePinCurrentLocation} />
        </aside>
      </main>
    </div>
  );
}
