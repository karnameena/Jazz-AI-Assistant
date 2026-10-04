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
