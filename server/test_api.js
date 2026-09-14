import http from "http";

const API_BASE = "http://localhost:4000/api";
const report = [];
let authCookie = "";
let predictionId = "";
let csrfToken = "";

async function fetchAPI(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = { ...options.headers };
  if (authCookie) headers.Cookie = authCookie;
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

  try {
    const res = await fetch(url, { ...options, headers });
    
    // Save cookie if present
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      authCookie = setCookie.split(';')[0]; // simple extraction
    }

    const isJson = res.headers.get("content-type")?.includes("application/json");
    const data = isJson ? await res.json() : await res.text();
    if (data?.csrfToken) csrfToken = data.csrfToken;
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    console.error(`Fetch error for ${url}:`, err);
    return { status: 0, ok: false, data: err.message };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runTest(name, testFn) {
  process.stdout.write(`Testing: ${name}... `);
  try {
    await testFn();
    console.log("✅ PASS");
    report.push(`✅ **PASS**: ${name}`);
  } catch (err) {
    console.log(`❌ FAIL - ${err.message}`);
    report.push(`❌ **FAIL**: ${name} - \`${err.message}\``);
  }
}

async function main() {
  console.log("Starting API Test Suite...\n");

  // 1. Health
  await runTest("GET /api/health", async () => {
    const res = await fetchAPI("/health");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.db === "up", "Database is down");
  });

  // 2. Predict (Public)
  await runTest("POST /api/predict", async () => {
    const res = await fetchAPI("/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 11.38, lng: 77.89 })
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.successProbability !== undefined, "Missing successProbability");
    assert(typeof res.data.predictionId === "string", "Missing saved prediction ID");
    predictionId = res.data.predictionId;
  });

  // 3. Borewells (Public)
  await runTest("GET /api/borewells", async () => {
    const res = await fetchAPI("/borewells");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.data), "Data is not an array");
  });

  // 4. Ledger (Public)
  await runTest("GET /api/ledger", async () => {
    const res = await fetchAPI("/ledger");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.totalPredictions !== undefined, "Missing totalPredictions");
  });

  // 5. Auth Flow
  const testPhone = "9999999999";
  const testPassword = "StrongPassword123!";
  
  await runTest("POST /api/auth/signup", async () => {
    const res = await fetchAPI("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Operator", phone: testPhone, password: testPassword, confirmPassword: testPassword })
    });
    // Accept 201 or 409 (if running multiple times)
    assert(res.status === 201 || res.status === 409, `Expected 201 or 409, got ${res.status}`);
    if (res.status === 201) {
      assert(authCookie !== "", "Cookie was not set on signup");
    }
  });

  await runTest("POST /api/auth/signin", async () => {
    const res = await fetchAPI("/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: testPhone, password: testPassword })
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(authCookie !== "", "Cookie was not set on signin");
  });

  // 6. Cookie-backed session restoration
  await runTest("GET /api/auth/session", async () => {
    const res = await fetchAPI("/auth/session");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.operator?.id, "Missing session operator");
    assert(typeof res.data.csrfToken === "string", "Missing CSRF token");
  });

  await runTest("CSRF rejects protected writes without a token", async () => {
    const savedToken = csrfToken;
    csrfToken = "";
    const res = await fetchAPI("/borewells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 11.38, lng: 77.89, success: true, depthFt: 300 }),
    });
    csrfToken = savedToken;
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  // 7. Operator Protected Routes
  await runTest("GET /api/borewells/mine", async () => {
    const res = await fetchAPI("/borewells/mine");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.data), "Data is not an array");
  });

  await runTest("GET /api/assignments", async () => {
    const res = await fetchAPI("/assignments");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.data), "Data is not an array");
  });

  await runTest("POST /api/borewells (Log a borewell)", async () => {
    const res = await fetchAPI("/borewells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: 11.38, lng: 77.89, success: true, depthFt: 300, strata: "Hard", waterStrikeFt: 250, yieldLpm: 100,
        predictionId
      })
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.data.id !== undefined, "Missing borewell ID in response");
    assert(/^BW-[A-Z0-9_-]+$/.test(res.data.publicId), "Missing public borewell ID");
    assert(res.data.status === "ACTIVE", "Expected ACTIVE borewell status");
    assert(res.data.verificationStatus === "SUBMITTED", "Expected submitted verification status");
    assert(res.data.scoredPredictions === 1, "Explicitly linked prediction was not scored");
  });

  // 8. Admin Protected Routes (Should fail with 403 since we are a normal operator)
  await runTest("GET /api/admin/operators (Role check)", async () => {
    const res = await fetchAPI("/admin/operators");
    assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
  });

  // 9. Signout
  await runTest("POST /api/auth/signout", async () => {
    const res = await fetchAPI("/auth/signout", { method: "POST" });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    // Check if token is cleared or expired by trying to access a protected route
    authCookie = res.headers?.get("set-cookie")?.split(';')[0] || ""; // should be a clear cookie
  });

  // 10. Verify Unauthorized access after signout
  await runTest("GET /api/borewells/mine (Unauthorized)", async () => {
    // We send empty authCookie
    authCookie = "";
    const res = await fetchAPI("/borewells/mine");
    assert(res.status === 401, `Expected 401 Unauthorized, got ${res.status}`);
  });
  
  // Write report
  const fs = await import("fs");
  fs.writeFileSync("api_test_report.md", "# API Endpoints Test Report\n\n" + report.join("\n") + "\n");
  console.log("\nReport generated at api_test_report.md");
}

main();
