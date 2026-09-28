import test from "node:test";
import assert from "node:assert/strict";
import { parseReminderCommand } from "./voip-reminders.mjs";

const now = new Date("2026-09-28T09:30:00.000Z"); // 3:00 PM IST

test("parses same-day PM reminder", () => {
  const result = parseReminderCommand("Hey Jazz, remind me at 7 PM to take medicine", now);
  assert.equal(result.title, "take medicine");
  assert.equal(result.scheduledAt, "2026-09-28T13:30:00.000Z");
});

test("parses tomorrow reminder", () => {
  const result = parseReminderCommand("remind me tomorrow at 8:30 AM to attend the meeting", now);
  assert.equal(result.title, "attend the meeting");
  assert.equal(result.scheduledAt, "2026-09-29T03:00:00.000Z");
});

test("parses reminder text before time", () => {
  const result = parseReminderCommand("remind me to call Mom at 6 PM", now);
  assert.equal(result.title, "call Mom");
  assert.equal(result.scheduledAt, "2026-09-28T12:30:00.000Z");
});

test("rolls an already-passed unqualified clock time to tomorrow", () => {
  const result = parseReminderCommand("remind me at 2 PM to check deployment", now);
  assert.equal(result.title, "check deployment");
  assert.equal(result.scheduledAt, "2026-09-29T08:30:00.000Z");
});

test("parses call-me reminder phrasing", () => {
  const result = parseReminderCommand("call me at 9 PM and remind me to check the deployment", now);
  assert.equal(result.title, "check the deployment");
  assert.equal(result.scheduledAt, "2026-09-28T15:30:00.000Z");
});

test("does not guess when time is missing", () => {
  assert.equal(parseReminderCommand("remind me to take medicine", now), null);
});
