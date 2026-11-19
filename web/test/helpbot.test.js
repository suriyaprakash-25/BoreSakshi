import test from "node:test";
import assert from "node:assert/strict";
import { HELP_TOPICS, SUGGESTED, matchTopic, explainResult, replyFor } from "../src/helpBot.js";
import { STRINGS } from "../src/strings.js";

const translator = (lang) => (key, vars = {}) =>
  (STRINGS[lang][key] ?? key).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
const en = translator("en");

test("common farmer and operator questions reach the right answer, in English and Tamil", () => {
  const cases = [
    ["How do I check my land?", "how"],
    ["how accurate is this", "accuracy"],
    ["Can I trust these numbers?", "accuracy"],
    ["Will my borewell get water?", "borewell"],
    ["why is there no borewell estimate", "noestimate"],
    ["what does before monsoon depth mean", "depth"],
    ["explain my result", "result"],
    ["where does the data come from", "data"],
    ["what is the likely range", "range"],
    ["I am a rig operator, how do I sign up", "operator"],
    ["is my location shared with anyone", "privacy"],
    ["is it free", "cost"],
    ["no internet signal", "offline"],
    ["hi", "greet"],
    ["thanks!", "thanks"],
    ["இது எவ்வளவு துல்லியமானது?", "accuracy"],
    ["என் ஆழ்துளைக் கிணற்றில் நீர் கிடைக்குமா?", "borewell"],
    ["தரவு எங்கிருந்து வருகிறது?", "data"],
    ["என் முடிவை விளக்குங்கள்", "result"],
    ["வணக்கம்", "greet"],
  ];
  for (const [question, topic] of cases) assert.equal(matchTopic(question), topic, question);
});

test("short words don't trigger inside longer ones, and unrelated questions get the fallback", () => {
  assert.notEqual(matchTopic("this is high"), "greet");
  assert.equal(matchTopic("what is the capital of France"), null);
  assert.equal(matchTopic("கிரிக்கெட் ஸ்கோர்"), null); // "ரிக்" (rig) inside cricket must not match
  assert.equal(matchTopic("போர்சாக்ஷி என்ன செய்யும்?"), "what");
  assert.equal(matchTopic(""), null);
  assert.match(replyFor(null, en, null), /only answer questions about BoreSakshi/);
});

test("explain my result restates only the numbers on screen, and says so when there is none", () => {
  assert.match(explainResult(null, en), /Tap a spot on the map first/);
  assert.doesNotMatch(explainResult(null, en), /\d/);

  const text = explainResult({
    estimateAvailable: false,
    noEstimateReason: "OUTSIDE_PILOT_AREA",
    groundwater: {
      available: true, preMonsoon: { depthM: 6.44, lowM: 3.64, highM: 10.96 }, postMonsoon: { depthM: 5.98, lowM: 3.12, highM: 10.6 },
      chanceWithin10m: 0.79, rockUnit: "Migmatite-Gneiss Complex",
    },
  }, en);
  assert.match(text, /about 6\.4 m deep before the monsoon \(likely 3\.6–11 m\)/);
  assert.match(text, /about 6 m after it \(likely 3\.1–11 m\)/);
  assert.match(text, /79% chance/);
  assert.match(text, /Migmatite-Gneiss Complex/);
  assert.match(text, /not a promise that a borewell will strike water/);
  assert.match(text, /pilot area/);

  const refused = explainResult({ estimateAvailable: false, noEstimateReason: "MODEL_UNAVAILABLE", groundwater: { available: false, reason: "LOW_COVERAGE" } }, en);
  assert.match(refused, /no groundwater outlook/);
  assert.match(refused, /too few monitored wells/);
  assert.doesNotMatch(refused, /\d+(\.\d+)? m deep/);
});

test("every helper text exists in both languages", () => {
  const keys = ["help.open", "help.title", "help.subtitle", "help.placeholder", "help.send", "help.close", "help.suggest", "help.fallback",
    "help.a.result_none", "help.result.gw", "help.result.rock", "help.result.noGw", "help.result.bore", "help.result.noBore",
    ...HELP_TOPICS.filter((topic) => topic.id !== "result").map((topic) => `help.a.${topic.id}`),
    ...SUGGESTED.map((topic) => `help.q.${topic}`)];
  for (const key of keys) {
    assert.ok(STRINGS.en[key], `missing English ${key}`);
    assert.ok(STRINGS.ta[key], `missing Tamil ${key}`);
  }
});
