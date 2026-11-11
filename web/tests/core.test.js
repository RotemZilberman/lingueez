import test from 'node:test';
import assert from 'node:assert/strict';
import { dueWords, emptyData, gradeWord, saveTranslation } from '../lib/core.js';

test('each lookup is saved once and repeated lookups count as encounters', () => {
  const data = emptyData();
  const now = new Date('2026-11-12T12:00:00Z');
  const first = saveTranslation(data, { text: '  hello  ', translation: 'שלום', source: 'en', target: 'he' }, now);
  const second = saveTranslation(data, { text: 'Hello', translation: 'שלום', source: 'en', target: 'he' }, now);
  assert.equal(data.words.length, 1);
  assert.equal(first.id, second.id);
  assert.equal(second.encounters, 2);
  assert.equal(dueWords(data, now).length, 1);
});

test('review schedule matches Lingueez desktop SM-2 rules', () => {
  const data = emptyData();
  const word = saveTranslation(data, { text: 'abundant', translation: 'שופע' }, new Date('2026-11-12T12:00:00Z'));
  gradeWord(word, 'good', new Date('2026-11-12T12:00:00Z'));
  assert.equal(word.intervalDays, 1);
  gradeWord(word, 'good', new Date('2026-11-13T12:00:00Z'));
  assert.equal(word.intervalDays, 2);
  gradeWord(word, 'easy', new Date('2026-11-14T12:00:00Z'));
  assert.equal(word.intervalDays, 7);
  assert.equal(word.status, 'learning');
  gradeWord(word, 'hard', new Date('2026-11-22T12:00:00Z'));
  assert.equal(word.intervalDays, 1);
  assert.equal(word.status, 'reviewing');
});

test('regrading on the same day does not multiply review interval', () => {
  const data = emptyData();
  const word = saveTranslation(data, { text: 'memory', translation: 'זיכרון' });
  gradeWord(word, 'easy', new Date('2026-11-12T09:00:00Z'));
  gradeWord(word, 'easy', new Date('2026-11-12T11:00:00Z'));
  assert.equal(word.intervalDays, 2);
  assert.equal(word.reviewCount, 1);
});
