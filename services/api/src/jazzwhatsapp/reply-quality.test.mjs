import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeJazzReply} from './reply-quality.mjs';
test('removes generated reminder copies and postscript filler, preserving normal prose and code', () => {
  assert.equal(sanitizeJazzReply('Useful answer.\n\nP.P.S. I will be available for any other tasks you have in the future.'), 'Useful answer.');
  assert.equal(sanitizeJazzReply('⏰ Mama, time for: fake task\nextra copied line\n\n✅ Finished fake task, Mama? Tap Done, or Snooze if you need more time.\n\nActual answer.'), 'Actual answer.');
  assert.equal(sanitizeJazzReply('P.S. I will be available.'), '');
  const code='Example:\n```text\nP.S. preserve this literal\n```';
  assert.equal(sanitizeJazzReply(code), code);
});

test('strips inline postscripts without altering code literals', () => {
  assert.equal(sanitizeJazzReply('The answer is 42. P.P.S. I will be available for any other tasks you have in the future.'), 'The answer is 42.');
  assert.equal(sanitizeJazzReply('Thanks Mama.\nI will be available for any other tasks you have in the future.'), 'Thanks Mama.');
  assert.equal(sanitizeJazzReply('```js\nconst s = "P.P.S. do not alter";\n```'), '```js\nconst s = "P.P.S. do not alter";\n```');
});

test("removes sound hallucination and repeated prose while preserving repeated code", () => {
  assert.equal(sanitizeJazzReply("[SOUND]\nHello Mama\n\n[SOUND]\nHello Mama"), "Hello Mama");
  assert.equal(sanitizeJazzReply("```js\nrun();\nrun();\n```"), "```js\nrun();\nrun();\n```");
});
