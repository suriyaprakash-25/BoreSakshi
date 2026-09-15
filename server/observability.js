const startedAt = Date.now();

const counters = new Map();
const durations = new Map();
let inFlight = 0;

function routeBucket(pathname = "") {
  const path = String(pathname).split("?")[0];
  if (path.startsWith("/api/auth")) return "/api/auth/*";
  if (path.startsWith("/api/admin")) return "/api/admin/*";
  if (path.startsWith("/api/operator")) return "/api/operator/*";
  if (path.startsWith("/api/borewells")) return "/api/borewells/*";
  if (path.startsWith("/api/ledger")) return "/api/ledger/*";
  if (path.startsWith("/api/predict")) return "/api/predict";
  if (path.startsWith("/api/health")) return "/api/health/*";
  if (path.startsWith("/api/internal")) return "/api/internal/*";
  return "/other";
}

function increment(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

export function requestMetrics(req, res, next) {
  const start = process.hrtime.bigint();
  inFlight += 1;
  res.on("finish", () => {
    inFlight = Math.max(0, inFlight - 1);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const bucket = routeBucket(req.path || req.url);
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    increment(counters, `${req.method}|${bucket}|${statusClass}`);
    const durationKey = `${req.method}|${bucket}`;
    const item = durations.get(durationKey) || { count: 0, totalMs: 0, maxMs: 0 };
    item.count += 1;
    item.totalMs += elapsedMs;
    item.maxMs = Math.max(item.maxMs, elapsedMs);
    durations.set(durationKey, item);
  });
  next();
}

export function metricsSnapshot() {
  const memory = process.memoryUsage();
  return {
    service: "boresakshi-api",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    inFlight,
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
    },
    requests: [...counters.entries()].map(([key, count]) => {
      const [method, route, statusClass] = key.split("|");
      return { method, route, statusClass, count };
    }),
    durations: [...durations.entries()].map(([key, value]) => {
      const [method, route] = key.split("|");
      return {
        method,
        route,
        count: value.count,
        averageMs: value.count ? Math.round((value.totalMs / value.count) * 100) / 100 : 0,
        maxMs: Math.round(value.maxMs * 100) / 100,
      };
    }),
  };
}

function promLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function prometheusMetrics() {
  const snapshot = metricsSnapshot();
  const lines = [
    "# HELP boresakshi_uptime_seconds Process uptime in seconds.",
    "# TYPE boresakshi_uptime_seconds gauge",
    `boresakshi_uptime_seconds ${snapshot.uptimeSeconds}`,
    "# HELP boresakshi_http_in_flight Current in-flight HTTP requests.",
    "# TYPE boresakshi_http_in_flight gauge",
    `boresakshi_http_in_flight ${snapshot.inFlight}`,
    "# HELP boresakshi_process_memory_bytes Process memory usage.",
    "# TYPE boresakshi_process_memory_bytes gauge",
    `boresakshi_process_memory_bytes{kind=\"rss\"} ${snapshot.memory.rssBytes}`,
    `boresakshi_process_memory_bytes{kind=\"heap_used\"} ${snapshot.memory.heapUsedBytes}`,
    `boresakshi_process_memory_bytes{kind=\"heap_total\"} ${snapshot.memory.heapTotalBytes}`,
    "# HELP boresakshi_http_requests_total HTTP requests by coarse route/status class.",
    "# TYPE boresakshi_http_requests_total counter",
  ];
  for (const item of snapshot.requests) {
    lines.push(`boresakshi_http_requests_total{method=\"${promLabel(item.method)}\",route=\"${promLabel(item.route)}\",status_class=\"${promLabel(item.statusClass)}\"} ${item.count}`);
  }
  lines.push("# HELP boresakshi_http_duration_ms HTTP request duration summaries by coarse route.");
  lines.push("# TYPE boresakshi_http_duration_ms gauge");
  for (const item of snapshot.durations) {
    const labels = `method=\"${promLabel(item.method)}\",route=\"${promLabel(item.route)}\"`;
    lines.push(`boresakshi_http_duration_ms{${labels},stat=\"avg\"} ${item.averageMs}`);
    lines.push(`boresakshi_http_duration_ms{${labels},stat=\"max\"} ${item.maxMs}`);
  }
  return `${lines.join("\n")}\n`;
}

export function resetMetricsForTests() {
  counters.clear();
  durations.clear();
  inFlight = 0;
}
