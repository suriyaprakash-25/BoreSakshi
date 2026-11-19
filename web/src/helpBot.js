// helpBot.js — the help assistant's brain. Pure functions, no network and no AI call:
// a question is matched to a known topic and answered with fixed text from strings.js,
// so the helper can never invent a number. "Explain my result" restates the numbers the
// panel is already showing.

// Keywords per topic. A keyword matches the start of a word ("accura" matches
// "accurate"; Tamil works the same way because Tamil adds endings, not prefixes, and
// matching mid-word would let "ரிக்" (rig) fire inside "கிரிக்கெட்"). A leading "="
// means the whole word must match ("=hi" won't match "this"). Phrases match at a word
// start. Order matters only for ties: earlier topics win.
export const HELP_TOPICS = [
  { id: "noestimate", keywords: ["no estimate", "why no", "=no", "not available", "unavailable", "pilot", "missing", "estimate", "மதிப்பீடு ஏன்", "மதிப்பீடு இல்லை", "முன்னோட்ட", "கிடைக்கவில்லை"] },
  { id: "borewell", keywords: ["borewell", "bore well", "=bore", "strike", "guarantee", "promise", "success", "get water", "find water", "drill", "dry", "ஆழ்துளை", "=போர்", "உறுதி", "கிடைக்குமா", "வெற்றி"] },
  { id: "result", keywords: ["result", "explain", "summar", "this spot", "this place", "my land", "meaning", "mean", "முடிவு", "முடிவை", "விளக்கு", "அர்த்தம்", "இந்த இட"] },
  { id: "range", keywords: ["range", "likely", "between", "interval", "uncertain", "sure", "வரம்பு", "பெரும்பாலும்"] },
  { id: "chance", keywords: ["chance", "percent", "probab", "within 10", "10 m", "%", "வாய்ப்பு", "சதவீத"] },
  { id: "depth", keywords: ["depth", "deep", "monsoon", "=may", "november", "water level", "water table", "summer", "ஆழம்", "பருவமழை", "நீர் மட்டம்", "மட்டம்", "aazham", "thanni"] },
  { id: "accuracy", keywords: ["accura", "correct", "trust", "reliab", "error", "wrong", "how good", "precise", "துல்லிய", "நம்ப", "பிழை", "சரியா"] },
  { id: "data", keywords: ["data", "source", "train", "model", "learn", "machine", "=ml", "=ai", "cgwb", "satellite", "how does it know", "lightgbm", "தரவு", "எங்கிருந்து", "செயற்கைக்கோள்"] },
  { id: "ledger", keywords: ["ledger", "record", "proof", "scored", "track", "பதிவேடு"] },
  { id: "operator", keywords: ["operator", "rig", "driller", "log a", "=log", "sign up", "signup", "register", "account", "submit", "ஆபரேட்டர்", "இயக்குநர்", "ரிக்", "கணக்கு"] },
  { id: "offline", keywords: ["offline", "signal", "internet", "network", "=net", "connection", "இணைய", "சிக்னல்"] },
  { id: "privacy", keywords: ["privacy", "private", "my location", "share", "stored", "store", "safe", "personal", "தனியுரிமை", "பகிர", "சேமிக்க"] },
  { id: "language", keywords: ["language", "tamil", "english", "translat", "மொழி", "தமிழ்", "ஆங்கில"] },
  { id: "cost", keywords: ["cost", "free", "price", "=pay", "money", "charge", "fee", "இலவச", "கட்டண", "பணம்"] },
  { id: "refused", keywords: ["outside", "coverage", "too few", "try again", "not working", "refus", "no answer", "no outlook", "வெளியே", "மீண்டும் முய"] },
  { id: "how", keywords: ["how to", "how do i", "how can i", "check", "=use", "tap", "=pin", "location", "start", "எப்படி", "பயன்படுத்த", "சரிபார்", "தொடு"] },
  { id: "what", keywords: ["boresakshi", "sakshi", "about", "purpose", "what is this", "what does", "போர்சாக்ஷி", "என்ன செய்யும்"] },
  { id: "thanks", keywords: ["=thanks", "=thank", "=thx", "=ty", "nandri", "நன்றி"] },
  { id: "greet", keywords: ["=hi", "=hello", "=hey", "=vanakkam", "=hai", "வணக்கம்"] },
];

// Questions offered as one-tap chips, most useful first.
export const SUGGESTED = ["result", "how", "accuracy", "borewell", "noestimate", "data"];

export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9%஀-௿\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matches(keyword, text, words) {
  if (keyword === "%") return text.includes("%");
  if (keyword.startsWith("=")) return words.includes(keyword.slice(1));
  if (keyword.includes(" ")) return ` ${text}`.includes(` ${keyword}`);
  return words.some((word) => word.startsWith(keyword));
}

// Best topic for a question, or null when nothing matches.
export function matchTopic(question) {
  const text = normalize(question);
  if (!text) return null;
  const words = text.split(" ");
  let best = null;
  let bestScore = 0;
  for (const topic of HELP_TOPICS) {
    const score = topic.keywords.reduce((sum, keyword) => sum + (matches(keyword, text, words) ? 1 : 0), 0);
    if (score > bestScore) {
      best = topic.id;
      bestScore = score;
    }
  }
  return best;
}

export const metres = (value) => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);

// Restates the result on screen. Only numbers the server already validated are used.
export function explainResult(result, t) {
  if (!result) return t("help.a.result_none");
  const parts = [];
  const gw = result.groundwater;
  if (gw?.available) {
    parts.push(t("help.result.gw", {
      pre: metres(gw.preMonsoon.depthM), preLow: metres(gw.preMonsoon.lowM), preHigh: metres(gw.preMonsoon.highM),
      post: metres(gw.postMonsoon.depthM), postLow: metres(gw.postMonsoon.lowM), postHigh: metres(gw.postMonsoon.highM),
      chance: Math.round(gw.chanceWithin10m * 100),
    }));
    if (gw.rockUnit) parts.push(t("help.result.rock", { rock: gw.rockUnit }));
    parts.push(t("gw.notBorewell"));
  } else if (gw) {
    const key = `gw.none.${gw.reason}`;
    const reason = t(key) === key ? t("gw.none.UNAVAILABLE") : t(key);
    parts.push(t("help.result.noGw", { reason }));
  }
  const boreKey = `none.${result.noEstimateReason}`;
  if (result.estimateAvailable === true && Number.isFinite(result.successProbability) && Array.isArray(result.depthBandFt)) {
    parts.push(t("help.result.bore", { p: Math.round(result.successProbability), low: result.depthBandFt[0], high: result.depthBandFt[1] }));
  } else if (result.estimateAvailable === false && t(boreKey) !== boreKey) {
    parts.push(t("help.result.noBore", { reason: t(boreKey) }));
  }
  return parts.length ? parts.join(" ") : t("help.a.result_none");
}

// The reply for a question (or for a chip, which passes its topic directly).
export function replyFor(topic, t, result) {
  if (!topic) return t("help.fallback");
  if (topic === "result") return explainResult(result, t);
  return t(`help.a.${topic}`);
}
