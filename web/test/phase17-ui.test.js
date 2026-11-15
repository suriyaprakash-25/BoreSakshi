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

test("PredictionPanel shows no invented numbers when there is no estimate, and never mentions localhost", async (t) => {
  const vite = await createViteServer({ root: WEB_ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const { default: PredictionPanel } = await vite.ssrLoadModule("/src/components/PredictionPanel.jsx");
  const render = (status, data = null) => renderToStaticMarkup(React.createElement(PredictionPanel, {
    status, data, coords: { lat: 11.383, lng: 77.895 }, onPinCurrentLocation: () => {},
  }));

  const idle = render("idle");
  assert.match(idle, /Know before you drill/);
  assert.match(idle, /Use my current location/);

  const none = render("result", {
    estimateAvailable: false,
    noEstimateReason: "MODEL_UNAVAILABLE",
    successProbability: null,
    depthBandFt: null,
    expectedYieldLpm: null,
    confidence: null,
    nearby: [{ id: "w-1", distanceKm: 1.5, depthFt: 240, success: true, strata: "weathered rock" }],
  });
  assert.match(none, /No estimate for this spot/);
  assert.match(none, /rather show nothing than guess/);
  assert.match(none, /about 1.5 km/);
  assert.match(none, /not a guarantee/);
  assert.doesNotMatch(none, /confidence|Expected depth|Expected yield/i);

  assert.doesNotMatch(render("error"), /localhost/);
  assert.match(render("offline"), /You are offline/);

  const estimate = render("result", {
    estimateAvailable: true,
    successProbability: 58,
    confidence: "Low",
    depthBandFt: [250, 430],
    expectedYieldLpm: [10, 35],
    rockType: "Granite",
    nearbyVerifiedLogs: 0,
    basis: "Trained ML estimate",
    predictionId: "abc123",
    factors: [],
    nearby: [],
    confidenceReason: null,
    uncertainty: {},
    predictionSource: "ml",
    modelVersion: "run-v1",
  });
  assert.match(estimate, /Expected depth/);
  assert.match(estimate, /abc123/);
  assert.match(estimate, /not a guarantee/);
});

test("every Tamil and English string exists in both languages with the same placeholders", async () => {
  const { STRINGS } = await import("../src/strings.js");
  assert.deepEqual(Object.keys(STRINGS.ta).sort(), Object.keys(STRINGS.en).sort());
  const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort();
  for (const key of Object.keys(STRINGS.en)) {
    assert.deepEqual(placeholders(STRINGS.ta[key]), placeholders(STRINGS.en[key]), key);
  }
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
