const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class MlServiceError extends Error {
  constructor(message, { code = "ML_SERVICE_ERROR", status = null, retryable = false, details = null } = {}) {
    super(message);
    this.name = "MlServiceError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export class MlServiceClient {
  constructor({
    baseUrl = process.env.ML_SERVICE_URL || "http://127.0.0.1:8000",
    timeoutMs = Number(process.env.ML_SERVICE_TIMEOUT_MS || 2500),
    retries = Number(process.env.ML_SERVICE_RETRIES || 1),
    failureThreshold = Number(process.env.ML_CIRCUIT_FAILURE_THRESHOLD || 3),
    cooldownMs = Number(process.env.ML_CIRCUIT_COOLDOWN_MS || 30000),
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.retries = Math.max(0, retries);
    this.failureThreshold = Math.max(1, failureThreshold);
    this.cooldownMs = Math.max(100, cooldownMs);
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.failures = 0;
    this.openedAt = null;
  }

  circuitState() {
    if (this.openedAt == null) return "closed";
    if (this.now() - this.openedAt >= this.cooldownMs) return "half_open";
    return "open";
  }

  _recordSuccess() {
    this.failures = 0;
    this.openedAt = null;
  }

  _recordFailure() {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.openedAt = this.now();
  }

  async _request(path, { method = "GET", body = null, timeoutMs = this.timeoutMs, retries = this.retries } = {}) {
    const state = this.circuitState();
    if (state === "open") {
      throw new MlServiceError("ML service circuit breaker is open", { code: "ML_CIRCUIT_OPEN", retryable: false });
    }
    const attempts = Math.max(1, retries + 1);
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: body == null ? undefined : { "Content-Type": "application/json" },
          body: body == null ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = payload?.detail || payload;
          const code = detail?.code || `ML_HTTP_${response.status}`;
          const retryable = response.status >= 500 || response.status === 429;
          const error = new MlServiceError(detail?.message || `ML service returned ${response.status}`, {
            code, status: response.status, retryable, details: detail,
          });
          if (!retryable) throw error;
          lastError = error;
          if (attempt < attempts) {
            await sleep(Math.min(100 * attempt, 300));
            continue;
          }
          throw error;
        }
        this._recordSuccess();
        return payload;
      } catch (error) {
        const normalized = error instanceof MlServiceError
          ? error
          : new MlServiceError(error?.name === "AbortError" ? "ML service request timed out" : "ML service request failed", {
              code: error?.name === "AbortError" ? "ML_TIMEOUT" : "ML_NETWORK_ERROR",
              retryable: true,
              details: { cause: error?.message || String(error) },
            });
        if (!normalized.retryable) throw normalized;
        lastError = normalized;
        if (attempt >= attempts) break;
        await sleep(Math.min(100 * attempt, 300));
      } finally {
        clearTimeout(timer);
      }
    }
    this._recordFailure();
    throw lastError || new MlServiceError("ML service request failed");
  }

  predict(payload) {
    return this._request("/ml/predict", { method: "POST", body: payload });
  }

  health({ timeoutMs = 750 } = {}) {
    return this._request("/ml/health", { timeoutMs, retries: 0 });
  }

  modelInfo() {
    return this._request("/ml/model-info", { retries: 0 });
  }

  statusSnapshot() {
    return {
      baseUrl: this.baseUrl,
      circuit: this.circuitState(),
      consecutiveFailures: this.failures,
      openedAt: this.openedAt,
    };
  }
}

export const mlClient = new MlServiceClient();
