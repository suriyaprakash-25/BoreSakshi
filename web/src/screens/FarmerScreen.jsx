import { useEffect, useState } from "react";
import MapView from "../components/MapView.jsx";
import PredictionPanel from "../components/PredictionPanel.jsx";
import AppHeader from "../components/AppHeader.jsx";
import { getPrediction, getBorewells, getLedger } from "../api.js";

const DEFAULT_CENTER = [11.36, 77.8]; // Namakkal / Tiruchengode belt

export default function FarmerScreen() {
  const [selected, setSelected] = useState(null);
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [status, setStatus] = useState("idle"); // idle | loading | result | error
  const [prediction, setPrediction] = useState(null);
  const [borewells, setBorewells] = useState([]);
  const [ledger, setLedger] = useState(null);

  // load verified wells + accuracy ledger on mount
  useEffect(() => {
    getBorewells().then(setBorewells).catch(() => {});
    getLedger().then(setLedger).catch(() => {});
  }, []);

  async function handlePick(lat, lng) {
    setSelected({ lat, lng });
    setStatus("loading");
    try {
      const data = await getPrediction(lat, lng);
      setPrediction(data);
      setStatus("result");
      // refresh ledger count (a new prediction was recorded)
      getLedger().then(setLedger).catch(() => {});
    } catch {
      setStatus("error");
    }
  }

  function handlePinCurrentLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setMapCenter([lat, lng]);
          handlePick(lat, lng);
        },
        (err) => {
          alert("Could not get current location: " + err.message);
        }
      );
    } else {
      alert("Geolocation is not supported by this browser.");
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
