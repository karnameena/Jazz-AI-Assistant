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

test("PDF and Word content about React or Android never become coding tasks", () => {
  for (const message of [
    "Create a professional PDF report about React.js",
    "Hey Jazz, create a professional PDF report about React.js",
    "Please generate a Word document about Android development",
    "Build an Excel spreadsheet about JavaScript projects",
    "Create a PDF report about React.js",
    "Create a PDF guide for Android applications",
    "Generate a PDF report on API performance"
  ]) {
    assert.equal(detectCodingIntent(message).matched, false, message);
  }
});

test("actual code creation remains with isolated coding agent", () => {
  for (const message of [
    "Create a React Todo application",
    "Build an Android app",
    "Build a PDF generator application in React",
    "Fix errors in my React project"
  ]) {
    assert.equal(detectCodingIntent(message).matched, true, message);
  }
});
