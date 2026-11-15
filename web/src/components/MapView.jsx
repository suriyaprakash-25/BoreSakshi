// MapView.jsx — interactive map. Tap to choose a drill point; existing verified
// borewells render as coloured dots (green = water found, red = dry).
import { MapContainer, TileLayer, CircleMarker, Marker, useMapEvents, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";
import L from "leaflet";
import { useI18n } from "../i18n.jsx";

// custom teal "drill here" pin (avoids Leaflet's broken default-icon issue in bundlers)
const dropPin = L.divIcon({
  className: "drop-pin",
  html: `<div class="pin-body"><div class="pin-dot"></div></div>`,
  iconSize: [30, 42],
  iconAnchor: [15, 40],
});

function ClickHandler({ onPick }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function MapUpdater({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

export default function MapView({ center, selected, onPick, borewells }) {
  const { t } = useI18n();
  return (
    <MapContainer center={center} zoom={12} className="map" zoomControl={true} scrollWheelZoom={true}>
      <MapUpdater center={center} />
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onPick={onPick} />

      {borewells.map((b) => (
        <CircleMarker
          key={b.id}
          center={[b.lat, b.lng]}
          radius={7}
          pathOptions={{
            color: "#ffffff",
            weight: 2,
            fillColor: b.success ? "#16b98a" : "#ff5d6c",
            fillOpacity: 0.9,
          }}
        >
          <Tooltip>
            {t(b.success ? "legend.water" : "legend.dry")} · {b.depthFt ? `${b.depthFt} ft` : "—"}
            {b.yieldLpm ? ` · ${b.yieldLpm} LPM` : ""}
          </Tooltip>
        </CircleMarker>
      ))}

      {selected && <Marker position={[selected.lat, selected.lng]} icon={dropPin} />}
    </MapContainer>
  );
}
