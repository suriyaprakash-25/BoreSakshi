import http from "http";

const servers = new Set();
const originalListen = http.Server.prototype.listen;
let shuttingDown = false;

http.Server.prototype.listen = function phase18TrackedListen(...args) {
  servers.add(this);
  this.once("close", () => servers.delete(this));
  return originalListen.apply(this, args);
};

function shutdownTimeoutMs() {
  const value = Number(process.env.GRACEFUL_SHUTDOWN_MS || 15000);
  return Number.isFinite(value) && value >= 5000 && value <= 120000 ? value : 15000;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve) => {
    server.close(() => resolve());
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
  });
}

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  const timeoutMs = shutdownTimeoutMs();
  console.log(`[BoreSakshi] ${signal}: draining ${servers.size} HTTP server(s), timeout=${timeoutMs}ms`);
  const forced = setTimeout(() => {
    console.error(`[BoreSakshi] ${signal}: graceful shutdown deadline exceeded`);
    process.exit(1);
  }, timeoutMs);
  forced.unref();
  try {
    await Promise.all([...servers].map(closeServer));
    clearTimeout(forced);
    console.log(`[BoreSakshi] ${signal}: HTTP drain complete`);
    process.exit(exitCode);
  } catch (error) {
    clearTimeout(forced);
    console.error(`[BoreSakshi] ${signal}: shutdown failed`, error);
    process.exit(1);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM", 0));
process.once("SIGINT", () => void shutdown("SIGINT", 0));
process.once("uncaughtException", (error) => {
  console.error("[BoreSakshi] production uncaught exception", error);
  void shutdown("uncaughtException", 1);
});
process.once("unhandledRejection", (reason) => {
  console.error("[BoreSakshi] production unhandled rejection", reason);
  void shutdown("unhandledRejection", 1);
});

try {
  await import("./index.js");
} catch (error) {
  console.error("[BoreSakshi] production startup failed", error);
  process.exit(1);
}
