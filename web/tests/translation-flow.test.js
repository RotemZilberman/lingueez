import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';

test('translation previews both directions and saves only after a separate request', async () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const directory = mkdtempSync(join(tmpdir(), 'lingueez-flow-'));
  process.chdir(directory);
  process.env.APP_USERNAME = 'test';
  process.env.APP_PASSWORD = 'test-password';
  process.env.APP_SESSION_SECRET = 'a'.repeat(40);
  globalThis.fetch = async url => {
    const input = new URL(url);
    const direction = `${input.searchParams.get('sl')}:${input.searchParams.get('tl')}`;
    assert.match(input.hostname, /^translate\.googleapis\.com$/);
    return { ok: true, json: async () => [[[(direction === 'en:he' ? 'שלום' : 'hello')]]] };
  };

  try {
    const { default: handler } = await import('../api/index.js');
    async function call(op, payload, cookie = '') {
      const req = Readable.from(payload ? [JSON.stringify(payload)] : []);
      req.url = `/api?op=${op}`;
      req.method = payload ? 'POST' : 'GET';
      req.headers = { host: 'localhost', origin: 'http://localhost', cookie };
      const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = JSON.parse(body); } };
      await handler(req, response);
      return response;
    }

    const login = await call('login', { username: 'test', password: 'test-password' });
    assert.equal(login.status, 200);
    assert.match(login.headers['Set-Cookie'], /Max-Age=31536000/);
    const cookie = login.headers['Set-Cookie'].split(';')[0];
    assert.ok(Number(cookie.split('.')[1]) - Date.now() > 364 * 86400000);
    assert.equal((await call('session', null, cookie)).headers['Set-Cookie'], undefined);

    const oldValue = `v1.${Date.now() + 10 * 86400000}.legacy`;
    const oldSignature = createHmac('sha256', 'a'.repeat(40)).update(oldValue).digest('base64url');
    const oldCookie = `lingueez_session=${oldValue}.${oldSignature}`;
    const renewed = await call('session', null, oldCookie);
    assert.equal(renewed.status, 200);
    assert.match(renewed.headers['Set-Cookie'], /Max-Age=31536000/);

    const forward = await call('translate', { text: 'hello', source: 'en', target: 'he' }, cookie);
    assert.equal(forward.status, 200);
    assert.equal(forward.body.translation, 'שלום');
    assert.equal((await call('data', null, cookie)).body.words.length, 0);

    const reverse = await call('translate', { text: 'שלום', source: 'he', target: 'en' }, cookie);
    assert.equal(reverse.status, 200);
    assert.equal(reverse.body.translation, 'hello');
    assert.equal((await call('data', null, cookie)).body.words.length, 0);

    const saved = await call('save', forward.body, cookie);
    assert.equal(saved.status, 200);
    assert.equal((await call('data', null, cookie)).body.words.length, 1);
    assert.equal(JSON.parse(readFileSync(join(directory, 'data/vocabulary.json'))).words[0].text, 'hello');

    globalThis.fetch = async url => {
      if (new URL(url).hostname === 'api.mymemory.translated.net') {
        return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'house' } }) };
      }
      return { ok: false, status: 429 };
    };
    const limited = await call('translate', { text: 'בית', source: 'he', target: 'en' }, cookie);
    assert.equal(limited.status, 200);
    assert.equal(limited.body.translation, 'house');
    assert.equal((await call('data', null, cookie)).body.words.length, 1);

    globalThis.fetch = async () => ({ ok: false, status: 429 });
    const unavailable = await call('translate', { text: 'בית', source: 'he', target: 'en' }, cookie);
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.body.error, /temporarily unavailable/);
  } finally {
    process.chdir(originalCwd);
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});
