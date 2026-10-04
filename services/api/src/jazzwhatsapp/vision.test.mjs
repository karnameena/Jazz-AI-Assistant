import test from 'node:test';
import assert from 'node:assert/strict';
import {answerImage} from './vision.mjs';
test('vision sends real image bytes with the current question and preserves uncertainty', async () => {
  const calls = [];
  const result = await answerImage('Read this sign', 'data:image/jpeg;base64,YQ==', [], async (url, options) => {
    const body = JSON.parse(options.body); calls.push({url, body});
    return {ok: true, status: 200, json: async () => url.endsWith('/show') ? {capabilities: ['completion', 'vision']} : {model: 'moondream', message: {content: 'The sign is too blurred to read. P.P.S. I will be available.'}}};
  });
  assert.equal(result.assistant, 'The sign is too blurred to read.');
  assert.deepEqual(calls[1].body.messages.at(-1), {role: 'user', content: 'Read this sign', images: ['YQ==']});
  assert.equal(calls[1].body.stream, false);
});
test('missing vision model gives installation instructions without claiming image contents', async () => {
  const result = await answerImage('Describe it', 'data:image/jpeg;base64,YQ==', [], async () => ({ok: false, status: 404}));
  assert.match(result.assistant, /ollama pull moondream/);
});
test('a text model cannot silently answer an image question', async () => {
  const result = await answerImage('Describe it', 'data:image/jpeg;base64,YQ==', [], async () => ({ok: true, status: 200, json: async () => ({capabilities: ['completion']})}));
  assert.match(result.assistant, /does not report image support/);
});
