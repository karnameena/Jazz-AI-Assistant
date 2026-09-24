import assert from "node:assert/strict";
import { normalizeUtterance } from "../src/utterance-normalizer.mjs";

const cases = [
  ["hey jaz whatt doingf", "hey jazz what are you doing", null],
  ["hey jas opn insta", "hey jazz open Instagram", "OPEN_APP"],
  ["opn youtub and ply vaathi coming", "open YouTube and play vaathi coming", "OPEN_APP"],
  ["scrol ap", "scroll up", "SCROLL_UP"],
  ["open whatsap", "open WhatsApp", "OPEN_APP"],
  ["serch guna", "search guna", "SEARCH_UI"],
  ["opn swigy", "open Swiggy", "OPEN_APP"],
  ["hey jazz what is my mobile status", "hey jazz what is my mobile status", "MOBILE_STATUS"]
];

for (const [raw, expected, intent] of cases) {
  const result = normalizeUtterance(raw, { source: "voice" });
  assert.equal(result.normalized, expected, raw);
  assert.equal(result.intent, intent, `${raw} intent`);
  assert.equal(result.requiresClarification, false, `${raw} should not need clarification`);
}

const sequence = normalizeUtterance("hey jas opan instgram and scrol ap", { source: "voice" });
assert.equal(sequence.normalized, "hey jazz open Instagram and scroll up");
assert.deepEqual(sequence.intents.map(item => item.intent), ["OPEN_APP", "SCROLL_UP"]);

const whatsappSearch = normalizeUtterance("serch Guna in whatsap", { source: "typed" });
assert.equal(whatsappSearch.normalized, "search Guna in WhatsApp");

const youtubePlay = normalizeUtterance("ply vaathi coming in youtub", { source: "typed" });
assert.equal(youtubePlay.normalized, "play vaathi coming in YouTube");

// Arbitrary values are deliberately not blindly corrected.
assert.equal(normalizeUtterance("type 'opn youtub'", { source: "typed" }).normalized, "type 'opn youtub'");
assert.equal(normalizeUtterance("open https://example.com/opn", { source: "typed" }).normalized, "open https://example.com/opn");
assert.equal(normalizeUtterance("search instgram", { source: "typed" }).normalized, "search instgram");

// Fuzzy matching is not allowed to manufacture a sensitive command.
const uncertainUnlock = normalizeUtterance("unlok mobile", { source: "voice" });
assert.notEqual(uncertainUnlock.intent, "UNLOCK_MOBILE");

console.log(`Jazz understanding tests passed: ${cases.length + 7}`);
