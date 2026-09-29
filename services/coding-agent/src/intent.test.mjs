import assert from "node:assert/strict";
import test from "node:test";
import { detectCodingIntent } from "./intent.mjs";

test("routes React creation to coding agent", () => {
  assert.equal(detectCodingIntent("Hey Jazz, create a React Todo application").matched, true);
});

test("routes repository repair to coding agent", () => {
  assert.equal(detectCodingIntent("Jazz, find and fix the errors in this project").matched, true);
});

test("does not steal Instagram command", () => {
  assert.equal(detectCodingIntent("Hey Jazz, open Instagram").matched, false);
});

test("does not steal reminder command", () => {
  assert.equal(detectCodingIntent("Hey Jazz, remind me at 6 PM to drink water").matched, false);
});

test("does not steal WhatsApp command", () => {
  assert.equal(detectCodingIntent("Hey Jazz, open WhatsApp and search Mom").matched, false);
});
