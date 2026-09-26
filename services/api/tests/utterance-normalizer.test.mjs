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
  ["hey jazz what is my mobile status", "hey jazz what is my mobile status", "MOBILE_STATUS"],
  ["Hey Jazz, pay ₹1 to Mom. She asked me to buy Clinic Plus.", "hey jazz pay ₹1 to Mom. She asked me to buy Clinic Plus.", "PAY_MOM"],
  ["Hey Jazz, cut the call", "hey jazz end the call", "END_CALL"],
  ["disconnect the call", "end the call", "END_CALL"],
  ["disconect the call", "end the call", "END_CALL"],
  ["close the call", "end the call", "END_CALL"],
  ["cut the cal", "end the call", "END_CALL"],
  ["hang up", "end the call", "END_CALL"],
  ["Hey Jazz, put speaker on", "hey jazz speaker on", "SPEAKER_ON"],
  ["turn speaker on", "speaker on", "SPEAKER_ON"],
  ["speaker off", "speaker off", "SPEAKER_OFF"],
  ["put speker on", "speaker on", "SPEAKER_ON"]
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
assert.equal(normalizeUtterance("type opn youtub", { source: "typed" }).normalized, "type opn youtub");
assert.equal(normalizeUtterance("message Guna saying opn youtub", { source: "typed" }).normalized, "message Guna saying opn youtub");
assert.equal(normalizeUtterance("open https://example.com/opn", { source: "typed" }).normalized, "open https://example.com/opn");
assert.equal(normalizeUtterance("search instgram", { source: "typed" }).normalized, "search instgram");

// Fuzzy matching may suggest, but never manufacture/execute, a sensitive action.
const uncertainUnlock = normalizeUtterance("unlok mobile", { source: "voice" });
assert.notEqual(uncertainUnlock.intent, "UNLOCK_MOBILE");
assert.equal(uncertainUnlock.requiresClarification, true);
assert.match(uncertainUnlock.suggestion || "", /unlock mobile/i);

console.log(`Jazz understanding tests passed: ${cases.length + 10}`);
