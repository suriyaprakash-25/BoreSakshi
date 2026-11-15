// Vercel entry. The import is lazy so a configuration failure answers with a
// logged, readable 503 instead of crashing the function on every request.
let appPromise = null;

function loadApp() {
  if (!appPromise) {
    appPromise = import("../server/index.js").then((module) => module.default).catch((error) => {
      appPromise = null;
      throw error;
    });
  }
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await loadApp();
    return app(req, res);
  } catch (error) {
    console.error("[BoreSakshi] API failed to start:", error);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "The service is not configured yet", code: "API_NOT_CONFIGURED" }));
  }
}
