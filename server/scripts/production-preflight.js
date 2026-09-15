import "dotenv/config";
import { MongoClient } from "mongodb";
import { assertProductionDeploymentEnv, checkDeploymentStorage } from "../productionConfig.js";

async function checkMongo(uri, dbName) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    await client.db(dbName).command({ ping: 1 });
    return { ok: true, service: "mongodb" };
  } finally {
    await client.close();
  }
}

async function checkMl(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${String(baseUrl).replace(/\/$/, "")}/ml/health`, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ready === false || body?.ok === false) {
      throw new Error(`ML readiness failed (${response.status}): ${JSON.stringify(body)}`);
    }
    return { ok: true, service: "ml", detail: body };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const config = assertProductionDeploymentEnv();
  const storage = await checkDeploymentStorage();
  const checks = { config, storage };

  const shouldCheckServices = process.argv.includes("--check-services") || process.argv.includes("--startup");
  if (shouldCheckServices) {
    checks.mongodb = await checkMongo(process.env.MONGODB_URI, process.env.MONGODB_DB || "BoreSakshi");
    if (process.env.REQUIRE_ML_READY === "YES") {
      checks.ml = await checkMl(process.env.ML_SERVICE_URL || "http://127.0.0.1:8000");
    }
  }

  console.log(JSON.stringify({ ok: true, phase: 18, checks }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    phase: 18,
    code: error.code || "PRODUCTION_PREFLIGHT_FAILED",
    error: error.message,
    details: error.details || null,
  }));
  process.exit(2);
});
