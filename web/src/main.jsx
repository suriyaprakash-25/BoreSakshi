import React from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App.jsx";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      const cacheUrls = performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => url.startsWith(location.origin) && !url.includes("/api/"));
      registration.active?.postMessage({ cacheUrls });
    })
    .catch(() => {}); // the app works online without it
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
