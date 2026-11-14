import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadData, mutateData } from '../lib/storage.js';
import { dueWords, gradeWord, MAX_TEXT, normalizeText, saveTranslation, stats } from '../lib/core.js';

const COOKIE = 'lingueez_session';
const SESSION_MS = 365 * 86400000;
const RENEW_WINDOW_MS = 90 * 86400000;

function reply(res, status, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...extra
  });
  res.end(JSON.stringify(body));
}

function configured() {
  return Boolean(process.env.APP_USERNAME && process.env.APP_PASSWORD && process.env.APP_SESSION_SECRET?.length >= 32);
}

function equalSecret(a, b) {
  const ah = createHash('sha256').update(String(a)).digest();
  const bh = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ah, bh);
}

function sign(value) {
  return createHmac('sha256', process.env.APP_SESSION_SECRET).update(value).digest('base64url');
}

function makeSession() {
  const value = `v1.${Date.now() + SESSION_MS}.${randomBytes(12).toString('base64url')}`;
  return `${value}.${sign(value)}`;
}

function sessionCookie(req) {
  const secure = (req.headers['x-forwarded-proto'] || 'http') === 'https' ? '; Secure' : '';
  return `${COOKIE}=${makeSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`;
}

function authenticated(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=').slice(0, 2)));
  const parts = (cookies[COOKIE] || '').split('.');
  const expiresAt = Number(parts[1]);
  if (parts.length !== 4 || parts[0] !== 'v1' || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return 0;
  const value = parts.slice(0, 3).join('.');
  return equalSecret(parts[3], sign(value)) ? expiresAt : 0;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return origin && origin === `${proto}://${host}`;
}

async function body(req) {
  let content = '';
  for await (const chunk of req) {
    content += chunk;
    if (content.length > 4_000_000) throw new Error('Request too large');
  }
  return JSON.parse(content || '{}');
}

async function googleTranslate(text, source, target) {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  for (const [key, value] of Object.entries({ client: 'gtx', sl: source, tl: target, dt: 't', q: text })) url.searchParams.set(key, value);
  // Match the PDF translator's mobile client request and bounded retry.
  // Keep each attempt short enough for Vercel's 30-second function limit.
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'GoogleTranslate/6.29.59279 (iPhone; iOS 15.4; en; iPhone14,2)',
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        const error = new Error(`Translation service returned ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      const translation = payload?.[0]?.map(segment => segment?.[0] || '').join('').trim();
      if (!translation) throw new Error('Translation service returned no text');
      return translation;
    } catch (error) {
      lastError = error;
      if (attempt || (error.status && error.status < 500 && error.status !== 429)) break;
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }
  throw lastError;
}

async function myMemoryTranslate(text, source, target) {
  // MyMemory limits a single lookup to 500 UTF-8 bytes.
  if (Buffer.byteLength(text, 'utf8') > 500) throw new Error('Backup translator text limit');
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', `${source}|${target}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Backup translator returned ${response.status}`);
  const payload = await response.json();
  const translation = payload?.responseData?.translatedText?.trim();
  if (Number(payload?.responseStatus) !== 200 || !translation || /^MYMEMORY WARNING/i.test(translation)) {
    throw new Error('Backup translator returned no translation');
  }
  return translation;
}

async function translate(text, source, target) {
  try {
    return await googleTranslate(text, source, target);
  } catch (googleError) {
    try {
      return await myMemoryTranslate(text, source, target);
    } catch (backupError) {
      console.error('Translation providers unavailable:', googleError.message, backupError.message);
      const error = new Error('Translation is temporarily unavailable. Please try again shortly.');
      error.status = 503;
      throw error;
    }
  }
}

export default async function handler(req, res) {
  const op = new URL(req.url, 'http://localhost').searchParams.get('op') || '';
  if (!configured()) return reply(res, 503, { error: 'Site access is not configured' });
  if (req.method !== 'GET' && !sameOrigin(req)) return reply(res, 403, { error: 'Origin denied' });

  try {
    if (op === 'login' && req.method === 'POST') {
      const input = await body(req);
      if (!equalSecret(input.username, process.env.APP_USERNAME) || !equalSecret(input.password, process.env.APP_PASSWORD)) {
        return reply(res, 401, { error: 'Incorrect username or password' });
      }
      return reply(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req) });
    }
    const expiresAt = authenticated(req);
    if (!expiresAt) return reply(res, 401, { error: 'Sign in required' });
    if (op !== 'logout' && expiresAt - Date.now() < RENEW_WINDOW_MS) res.setHeader('Set-Cookie', sessionCookie(req));
    if (op === 'session' && req.method === 'GET') return reply(res, 200, { username: process.env.APP_USERNAME });
    if (op === 'logout' && req.method === 'POST') return reply(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });

    if (op === 'data' && req.method === 'GET') {
      const { data } = await loadData();
      return reply(res, 200, { ...data, due: dueWords(data).length, stats: stats(data) });
    }
    if (op === 'export' && req.method === 'GET') {
      const { data } = await loadData();
      return reply(res, 200, data, { 'Content-Disposition': `attachment; filename="lingueez-backup-${new Date().toISOString().slice(0, 10)}.json"` });
    }
    if (op === 'translate' && req.method === 'POST') {
      const input = await body(req);
      const text = normalizeText(input.text);
      const source = /^[a-z-]{2,8}$/i.test(input.source) ? input.source : 'en';
      const target = /^[a-z-]{2,8}$/i.test(input.target) ? input.target : 'he';
      if (!text || text.length > MAX_TEXT) return reply(res, 400, { error: `Enter up to ${MAX_TEXT} characters` });
      if (source === target) return reply(res, 400, { error: 'Choose different languages' });
      const translation = await translate(text, source, target);
      return reply(res, 200, { text, translation, source, target });
    }
    if (op === 'save' && req.method === 'POST') {
      const input = await body(req);
      const text = normalizeText(input.text);
      const translation = normalizeText(input.translation);
      const source = String(input.source || 'en');
      const target = String(input.target || 'he');
      if (!text || text.length > MAX_TEXT || !translation || translation.length > MAX_TEXT) return reply(res, 400, { error: `Enter a word and translation of up to ${MAX_TEXT} characters` });
      if (!/^[a-z-]{2,8}$/i.test(source) || !/^[a-z-]{2,8}$/i.test(target) || source === target) return reply(res, 400, { error: 'Choose different languages' });
      const { result: word } = await mutateData(data => saveTranslation(data, { text, translation, source, target, context: input.context }));
      return reply(res, 200, { word });
    }
    if (op === 'grade' && req.method === 'POST') {
      const input = await body(req);
      const { result: word } = await mutateData(data => {
        const word = data.words.find(item => item.id === input.id);
        if (!word) throw new Error('Word not found');
        gradeWord(word, input.grade);
        data.events.unshift({ type: 'review', wordId: word.id, grade: input.grade, at: new Date().toISOString() });
        data.events = data.events.slice(0, 5000);
        return word;
      });
      return reply(res, 200, { word });
    }
    if (op === 'word' && req.method === 'POST') {
      const input = await body(req);
      const { result } = await mutateData(data => {
        const index = data.words.findIndex(item => item.id === input.id);
        if (index < 0) throw new Error('Word not found');
        if (input.action === 'delete') return data.words.splice(index, 1)[0];
        const word = data.words[index];
        if (input.action === 'status') {
          if (!['new', 'reviewing', 'learning', 'mastered', 'known'].includes(input.status)) throw new Error('Invalid status');
          word.status = input.status;
        } else if (input.action === 'edit') {
          if (typeof input.translation === 'string') word.translation = normalizeText(input.translation).slice(0, 2000);
          if (typeof input.note === 'string') word.note = input.note.trim().slice(0, 2000);
          if (typeof input.context === 'string') word.context = input.context.trim().slice(0, 1000);
          if (Array.isArray(input.tags)) word.tags = input.tags.filter(tag => typeof tag === 'string').slice(0, 10).map(tag => tag.slice(0, 30));
        } else throw new Error('Invalid action');
        return word;
      });
      return reply(res, 200, { word: result });
    }
    if (op === 'text' && req.method === 'POST') {
      const input = await body(req);
      if (input.action === 'delete') {
        await mutateData(data => { data.texts = data.texts.filter(item => item.id !== input.id); });
        return reply(res, 200, { ok: true });
      }
      const title = normalizeText(input.title).slice(0, 120);
      const content = String(input.content || '').trim();
      if (!title || !content || content.length > 100000) return reply(res, 400, { error: 'Add a title and up to 100,000 characters of text' });
      const { result } = await mutateData(data => {
        const text = { id: randomBytes(16).toString('hex'), title, content, createdAt: new Date().toISOString() };
        data.texts.unshift(text);
        return text;
      });
      return reply(res, 200, { text: result });
    }
    if (op === 'import' && req.method === 'POST') {
      const input = await body(req);
      if (!Array.isArray(input.words) || input.words.length > 5000) return reply(res, 400, { error: 'Invalid backup' });
      const { result } = await mutateData(data => {
        let added = 0;
        for (const item of input.words) {
          if (!item.text || !item.translation) continue;
          const before = data.words.length;
          const word = saveTranslation(data, item);
          if (data.words.length > before) {
            word.note = typeof item.note === 'string' ? item.note.slice(0, 2000) : '';
            word.tags = Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string').slice(0, 10).map(tag => tag.slice(0, 30)) : [];
            if (['new', 'reviewing', 'learning', 'mastered', 'known'].includes(item.status)) word.status = item.status;
            if (Number.isFinite(item.intervalDays)) word.intervalDays = Math.max(0, Math.min(3650, item.intervalDays));
            if (Number.isFinite(item.easeFactor)) word.easeFactor = Math.max(1.3, Math.min(2.5, item.easeFactor));
            if (Number.isFinite(item.reviewCount)) word.reviewCount = Math.max(0, item.reviewCount);
            if (Number.isFinite(item.correctCount)) word.correctCount = Math.max(0, item.correctCount);
            if (item.nextReview && !Number.isNaN(Date.parse(item.nextReview))) word.nextReview = new Date(item.nextReview).toISOString();
            if (item.createdAt && !Number.isNaN(Date.parse(item.createdAt))) word.createdAt = new Date(item.createdAt).toISOString();
            added++;
          }
        }
        let textsAdded = 0;
        if (Array.isArray(input.texts)) for (const item of input.texts.slice(0, 500)) {
          if (typeof item.title !== 'string' || typeof item.content !== 'string' || !item.title.trim() || !item.content.trim() || item.content.length > 100000) continue;
          if (data.texts.some(existing => existing.title === item.title && existing.content === item.content)) continue;
          data.texts.unshift({ id: randomBytes(16).toString('hex'), title: item.title.slice(0, 120), content: item.content, createdAt: new Date().toISOString() });
          textsAdded++;
        }
        return { added, textsAdded };
      });
      return reply(res, 200, result);
    }
    return reply(res, 404, { error: 'Unknown route' });
  } catch (error) {
    if (error.status === 503) return reply(res, 503, { error: error.message });
    const expected = /^(Invalid|Word not found|Request too large|Enter|Choose|Add a title)/.test(error.message);
    if (!expected) console.error('API error:', error.name, error.message);
    return reply(res, expected ? 400 : 502, { error: expected ? error.message : 'Could not complete the request. Please try again.' });
  }
}
