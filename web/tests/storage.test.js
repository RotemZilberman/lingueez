import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData, mutateData } from '../lib/storage.js';
import { saveTranslation } from '../lib/core.js';

test('production storage overwrites the fixed private blob when GET has no ETag', async () => {
  const oldVercel = process.env.VERCEL;
  const oldToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.VERCEL = '1';
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  let stored = { version: 1, words: [], texts: [], events: [] };
  const writes = [];
  const blob = {
    async get(path, options) {
      assert.equal(path, 'lingueez-personal/vocabulary.json');
      assert.equal(options.access, 'private');
      return { stream: new Response(JSON.stringify(stored)).body, blob: { etag: '' } };
    },
    async put(path, body, options) {
      assert.equal(path, 'lingueez-personal/vocabulary.json');
      writes.push(options);
      if (!options.allowOverwrite) throw new Error('Blob already exists');
      stored = JSON.parse(body);
    }
  };
  try {
    await mutateData(data => saveTranslation(data, { text: 'apple', translation: 'תפוח' }), blob);
    await mutateData(data => saveTranslation(data, { text: 'book', translation: 'ספר' }), blob);
    assert.equal((await loadData(blob)).data.words.length, 2);
    assert.equal(writes.length, 2);
    assert.ok(writes.every(options => options.access === 'private' && options.allowOverwrite && options.addRandomSuffix === false));
  } finally {
    if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
    if (oldToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = oldToken;
  }
});
