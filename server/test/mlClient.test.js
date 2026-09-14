import test from "node:test";
import assert from "node:assert/strict";
import { MlServiceClient, MlServiceError } from "../mlClient.js";

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

test("health probe does not retry", async () => {
  let calls = 0;
  const client = new MlServiceClient({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ detail: { code: "TEMP", message: "temporary" } }, 503);
    },
    retries: 2,
    timeoutMs: 100,
  });
  await assert.rejects(() => client.health({ timeoutMs: 100 }), (error) => {
    assert.equal(error.code, "TEMP");
    return true;
  });
  assert.equal(calls, 1, "health explicitly disables retries");
});

test("predict retries retryable 5xx then succeeds", async () => {
  let calls = 0;
  const client = new MlServiceClient({
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ detail: { code: "TEMP", message: "temporary" } }, 503) : jsonResponse({ successProbability: 71 });
    },
    retries: 1,
    timeoutMs: 100,
  });
  const result = await client.predict({ lat: 11, lng: 77 });
  assert.equal(result.successProbability, 71);
  assert.equal(calls, 2);
});

test("coverage 422 is surfaced without retry", async () => {
  let calls = 0;
  const client = new MlServiceClient({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ detail: { code: "INSUFFICIENT_FEATURE_COVERAGE", message: "coverage too low" } }, 422);
    },
    retries: 2,
  });
  await assert.rejects(() => client.predict({ lat: 11, lng: 77 }), (error) => {
    assert.ok(error instanceof MlServiceError);
    assert.equal(error.code, "INSUFFICIENT_FEATURE_COVERAGE");
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(calls, 1);
});

test("circuit opens after consecutive transport failures", async () => {
  let calls = 0;
  let now = 1000;
  const client = new MlServiceClient({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("connection refused");
    },
    retries: 0,
    failureThreshold: 2,
    cooldownMs: 1000,
    now: () => now,
  });
  await assert.rejects(() => client.predict({}), /request failed/);
  await assert.rejects(() => client.predict({}), /request failed/);
  assert.equal(client.circuitState(), "open");
  await assert.rejects(() => client.predict({}), (error) => error.code === "ML_CIRCUIT_OPEN");
  assert.equal(calls, 2);
  now += 1001;
  assert.equal(client.circuitState(), "half_open");
});
