import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

import { validateAuthForm } from "../src/authValidation.js";
import { safeAuthState, roleHome } from "../src/authState.js";
import { mapPickFromGeolocation, normalizeMapPick } from "../src/mapInteraction.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
}

test("auth form validation mirrors the production strong-password and confirmation contract", () => {
  assert.match(
    validateAuthForm({ mode: "signup", name: "Rig One", phone: "9876543210", password: "weak", confirmPassword: "weak" }),
    /10–128 characters/
  );
  assert.equal(
    validateAuthForm({ mode: "signup", name: "Rig One", phone: "9876543210", password: "StrongPass!2026", confirmPassword: "StrongPass!2026" }),
    null
  );
  assert.equal(
    validateAuthForm({ mode: "signup", name: "Rig One", phone: "9876543210", password: "StrongPass!2026", confirmPassword: "DifferentPass!2026" }),
    "Passwords do not match."
  );
  assert.equal(validateAuthForm({ mode: "signin", phone: "", password: "x" }), "Phone is required.");
});

test("map interaction accepts real coordinates and rejects malformed/out-of-range picks", () => {
  assert.deepEqual(normalizeMapPick("11.383", "77.895"), { lat: 11.383, lng: 77.895 });
  assert.deepEqual(
    mapPickFromGeolocation({ coords: { latitude: 11.36, longitude: 77.8 } }),
    { lat: 11.36, lng: 77.8 }
  );
  assert.throws(() => normalizeMapPick(91, 77.8), /Latitude/);
  assert.throws(() => normalizeMapPick(11.36, Number.NaN), /Longitude/);
});

test("browser auth state excludes bearer tokens and recovery secrets", () => {
  const safe = safeAuthState({
    token: "must-not-persist",
    recoveryCode: "BSK-SECRET-SECRET-SECRET-SECRET",
    operator: {
      id: "op-1", name: "Rig One", phone: "9876543210", role: "operator",
      status: "active", verified: true, passwordHash: "must-not-persist",
    },
  });
  assert.deepEqual(safe, {
    operator: { id: "op-1", name: "Rig One", phone: "9876543210", role: "operator", status: "active", verified: true },
  });
  const serialized = JSON.stringify(safe);
  assert.doesNotMatch(serialized, /must-not-persist|recoveryCode|passwordHash|token/);
  assert.equal(roleHome({ role: "admin" }), "/admin");
  assert.equal(roleHome({ role: "operator" }), "/dashboard");
});

test("PredictionPanel renders idle and explicit heuristic-fallback component states", async (t) => {
  const vite = await createViteServer({ root: WEB_ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const { default: PredictionPanel } = await vite.ssrLoadModule("/src/components/PredictionPanel.jsx");

  const idle = renderToStaticMarkup(React.createElement(PredictionPanel, {
    status: "idle", data: null, coords: { lat: 0, lng: 0 }, onPinCurrentLocation: () => {},
  }));
  assert.match(idle, /Know before you drill/);
  assert.match(idle, /Pin current location/);

  const fallback = renderToStaticMarkup(React.createElement(PredictionPanel, {
    status: "result",
    coords: { lat: 11.383, lng: 77.895 },
    onPinCurrentLocation: () => {},
    data: {
      successProbability: 58,
      confidence: "Low",
      depthBandFt: [250, 430],
      expectedYieldLpm: [10, 35],
      rockType: "Granite",
      nearbyVerifiedLogs: 0,
      basis: "Phase 17 fallback fixture",
      factors: [],
      nearby: [],
      confidenceReason: null,
      uncertainty: {},
      predictionSource: "heuristic_fallback",
      isMock: true,
      modelVersion: null,
      featureVersion: null,
    },
  }));
  assert.match(fallback, /explicitly labelled heuristic fallback/);
  assert.match(fallback, /not an ML prediction/);
  assert.match(fallback, /Advisory, not a guarantee/);
});

test("API auth flow uses HttpOnly-cookie credentials while local storage keeps only safe profile", async (t) => {
  const oldStorage = globalThis.localStorage;
  const oldFetch = globalThis.fetch;
  const storage = memoryStorage();
  const calls = [];
  globalThis.localStorage = storage;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { operator: { id: "op-2", name: "Rig Two", phone: "9000000002", role: "operator", verified: false } };
      },
    };
  };
  t.after(() => {
    globalThis.localStorage = oldStorage;
    globalThis.fetch = oldFetch;
  });

  const vite = await createViteServer({ root: WEB_ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const api = await vite.ssrLoadModule("/src/api.js");

  const response = await api.signin({ phone: "9000000002", password: "StrongPass!2026" });
  assert.equal(response.operator.id, "op-2");
  assert.equal(calls[0].options.credentials, "include");

  api.setAuth(safeAuthState({ token: "secret", recoveryCode: "secret", operator: response.operator }));
  const stored = storage.getItem("boresakshi_auth");
  assert.ok(stored);
  assert.doesNotMatch(stored, /secret|token|recoveryCode/);
  assert.equal(api.getAuth().operator.id, "op-2");
  api.clearAuth();
  assert.equal(api.getAuth(), null);
});
