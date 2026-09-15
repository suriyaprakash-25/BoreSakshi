import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { MongoClient } from "mongodb";

const enabled = process.env.PHASE17_E2E === "YES";
const mongoUri = process.env.PHASE17_MONGODB_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/";
const frontendOrigin = "http://localhost:5173";
const serverDir = fileURLToPath(new URL("..", import.meta.url));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function responseCookie(response) {
  const raw = response.headers.getSetCookie?.()[0] || response.headers.get("set-cookie") || "";
  return raw.split(";", 1)[0] || null;
}

async function request(baseUrl, route, { method = "GET", cookie = null, json, body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (cookie) requestHeaders.Cookie = cookie;
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) requestHeaders.Origin = frontendOrigin;
  let requestBody = body;
  if (json !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    requestBody = JSON.stringify(json);
  }
  const response = await fetch(`${baseUrl}${route}`, { method, headers: requestHeaders, body: requestBody });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { response, payload, cookie: responseCookie(response) || cookie };
}

async function waitUntilLive(baseUrl, child, logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`server exited before becoming live\n${logs.value}`);
    try {
      const response = await fetch(`${baseUrl}/api/health/live`);
      if (response.ok) return;
    } catch { /* startup race */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become live\n${logs.value}`);
}

async function stopChild(child) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

test("Phase 17 E2E: register -> login -> prediction -> rig upload -> verify -> ledger score -> reopen", { skip: !enabled }, async (t) => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbName = `BoreSakshiPhase17E2E_${process.pid}_${Date.now()}`;
  const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "boresakshi-phase17-e2e-"));
  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
  await mongo.connect();
  const database = mongo.db(dbName);

  const adminPassword = "AdminPass!2026";
  await database.collection("operators").insertOne({
    id: "admin-phase17",
    name: "Phase 17 Admin",
    phone: "9000000001",
    passwordHash: await bcrypt.hash(adminPassword, 10),
    sessionVersion: 0,
    role: "admin",
    status: "active",
    verified: true,
    createdAt: new Date().toISOString(),
  });

  const logs = { value: "" };
  const child = spawn(process.execPath, ["index.js"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      MONGODB_URI: mongoUri,
      MONGODB_DB: dbName,
      JWT_SECRET: "phase17-e2e-jwt-secret-at-least-32-characters-long",
      RIG_EVIDENCE_SECRET: "phase17-e2e-evidence-secret-distinct-and-long-enough",
      FRONTEND_URL: frontendOrigin,
      NODE_ENV: "test",
      ML_SERVICE_URL: "http://127.0.0.1:65531",
      ML_SERVICE_TIMEOUT_MS: "50",
      ML_SERVICE_RETRIES: "0",
      ML_CIRCUIT_FAILURE_THRESHOLD: "1",
      RIG_MEDIA_DIR: evidenceDir,
      MONITORING_TOKEN: "phase17-monitoring-token-long-enough",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { logs.value += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs.value += chunk.toString(); });

  t.after(async () => {
    await stopChild(child);
    await database.dropDatabase().catch(() => {});
    await mongo.close().catch(() => {});
    await rm(evidenceDir, { recursive: true, force: true });
  });

  await waitUntilLive(baseUrl, child, logs);

  const operatorPassword = "OperatorPass!2026";
  const signup = await request(baseUrl, "/api/auth/signup", {
    method: "POST",
    json: { name: "Phase 17 Rig", phone: "9000000002", password: operatorPassword, confirmPassword: operatorPassword },
  });
  assert.equal(signup.response.status, 201, JSON.stringify(signup.payload));
  assert.match(signup.payload.recoveryCode, /^BSK-/);
  assert.ok(signup.cookie);
  const operatorId = signup.payload.operator.id;

  const signout = await request(baseUrl, "/api/auth/signout", { method: "POST", cookie: signup.cookie });
  assert.equal(signout.response.status, 200);

  const signin = await request(baseUrl, "/api/auth/signin", {
    method: "POST",
    json: { phone: "9000000002", password: operatorPassword },
  });
  assert.equal(signin.response.status, 200, JSON.stringify(signin.payload));
  assert.ok(signin.cookie);
  const operatorCookie = signin.cookie;

  const adminSignin = await request(baseUrl, "/api/auth/signin", {
    method: "POST",
    json: { phone: "9000000001", password: adminPassword },
  });
  assert.equal(adminSignin.response.status, 200, JSON.stringify(adminSignin.payload));
  const adminCookie = adminSignin.cookie;
  assert.ok(adminCookie);

  const verifyOperator = await request(baseUrl, `/api/admin/operators/${operatorId}`, {
    method: "PATCH",
    cookie: adminCookie,
    json: { verified: true, reason: "Phase 17 E2E verifies this field operator account." },
  });
  assert.equal(verifyOperator.response.status, 200, JSON.stringify(verifyOperator.payload));
  assert.equal(verifyOperator.payload.verified, true);

  const prediction = await request(baseUrl, "/api/predict", {
    method: "POST",
    json: { lat: 11.383, lng: 77.895 },
  });
  assert.equal(prediction.response.status, 200, JSON.stringify(prediction.payload));
  assert.ok(prediction.payload.predictionId);
  assert.equal(prediction.payload.accountabilityStatus, "PENDING_OUTCOME");
  assert.equal(prediction.payload.predictionSource, "heuristic_fallback");
  assert.equal(prediction.payload.isMock, true);

  // The field schema stores drilling completion as a date-only midnight timestamp.
  // Backdate the controlled prediction fixture one day so the accountability matcher
  // can prove it existed before drilling without weakening the production time gate.
  const drillingDate = new Date().toISOString().slice(0, 10);
  const drilledMidnight = Date.parse(`${drillingDate}T00:00:00.000Z`);
  const priorPredictionAt = new Date(drilledMidnight - 24 * 60 * 60 * 1000).toISOString();
  await database.collection("predictions").updateOne(
    { id: prediction.payload.predictionId },
    { $set: { createdAt: priorPredictionAt, predictionTimestamp: priorPredictionAt, "accountability.predictionDate": priorPredictionAt } }
  );

  const evidence = await request(baseUrl, "/api/operator/evidence", {
    method: "POST",
    cookie: operatorCookie,
    headers: { "Content-Type": "image/jpeg", "X-File-Name": encodeURIComponent("phase17-site.jpg") },
    body: Buffer.from("phase17 deterministic jpeg fixture bytes"),
  });
  assert.equal(evidence.response.status, 201, JSON.stringify(evidence.payload));
  assert.equal(evidence.payload.kind, "photo");
  assert.ok(evidence.payload.token);

  const gpsCapturedAt = new Date().toISOString();
  const rigLog = await request(baseUrl, "/api/borewells", {
    method: "POST",
    cookie: operatorCookie,
    json: {
      lat: 11.383,
      lng: 77.895,
      gpsAccuracyM: 6.5,
      gpsCapturedAt,
      drillingDate,
      placeName: "Phase 17 test site",
      depthFt: 420,
      strata: "weathered rock to fractured granite",
      geologicalLayers: [
        { fromFt: 0, toFt: 120, material: "weathered rock", notes: "" },
        { fromFt: 120, toFt: 420, material: "fractured granite", notes: "fracture at 280 ft" },
      ],
      waterStrikeFt: 280,
      yieldLpm: 45,
      success: true,
      evidenceTokens: [evidence.payload.token],
      language: "ta",
    },
  });
  assert.equal(rigLog.response.status, 201, JSON.stringify(rigLog.payload));
  assert.equal(rigLog.payload.verificationStatus, "SUBMITTED");
  assert.equal(rigLog.payload.datasetEligibility.eligible, false);
  const borewellId = rigLog.payload.id;

  const startReview = await request(baseUrl, `/api/admin/review/logs/${borewellId}/start`, {
    method: "POST",
    cookie: adminCookie,
    json: { note: "Phase 17 deterministic end-to-end review." },
  });
  assert.equal(startReview.response.status, 200, JSON.stringify(startReview.payload));
  assert.equal(startReview.payload.verificationStatus, "UNDER_REVIEW");

  const decision = await request(baseUrl, `/api/admin/review/logs/${borewellId}/decision`, {
    method: "POST",
    cookie: adminCookie,
    json: {
      decision: "verify",
      decisionReason: "Evidence and structured drilling fields passed the Phase 17 controlled review.",
      overrideRisk: true,
      overrideTrustGate: true,
      overrideReason: "Controlled Phase 17 fixture explicitly exercises documented human override gates.",
    },
  });
  assert.equal(decision.response.status, 200, JSON.stringify(decision.payload));
  assert.equal(decision.payload.record.verificationStatus, "VERIFIED");
  assert.equal(decision.payload.record.datasetEligibility.eligible, true);
  assert.equal(decision.payload.ledger.scored, 1);

  const publicWells = await request(baseUrl, "/api/borewells");
  assert.equal(publicWells.response.status, 200);
  assert.equal(publicWells.payload.length, 1);
  assert.equal(publicWells.payload[0].id, borewellId);
  assert.equal("operatorId" in publicWells.payload[0], false);
  assert.equal("evidence" in publicWells.payload[0], false);
  assert.equal("gps" in publicWells.payload[0], false);

  const scoredLedger = await request(baseUrl, "/api/ledger");
  assert.equal(scoredLedger.response.status, 200);
  assert.equal(scoredLedger.payload.totalPredictions, 1);
  assert.equal(scoredLedger.payload.scored, 1);
  assert.ok(scoredLedger.payload.brier != null);
  assert.equal(scoredLedger.payload.recent[0].id, prediction.payload.predictionId);

  const reopen = await request(baseUrl, `/api/admin/review/logs/${borewellId}/reopen`, {
    method: "POST",
    cookie: adminCookie,
    json: { reason: "Phase 17 confirms reopened outcomes leave current accountability metrics." },
  });
  assert.equal(reopen.response.status, 200, JSON.stringify(reopen.payload));
  assert.equal(reopen.payload.record.verificationStatus, "UNDER_REVIEW");
  assert.equal(reopen.payload.reopenedPredictions, 1);

  const reopenedLedger = await request(baseUrl, "/api/ledger");
  assert.equal(reopenedLedger.response.status, 200);
  assert.equal(reopenedLedger.payload.scored, 0);
  assert.equal(reopenedLedger.payload.pending, 1);

  const audit = await request(baseUrl, `/api/admin/ledger/entries/${prediction.payload.predictionId}/audit`, {
    cookie: adminCookie,
  });
  assert.equal(audit.response.status, 200, JSON.stringify(audit.payload));
  const actions = audit.payload.audit.map((event) => event.action);
  assert.ok(actions.includes("prediction_issued"));
  assert.ok(actions.includes("verified_outcome_scored"));
  assert.ok(actions.includes("outcome_reopened"));
});
