import { randomUUID } from 'node:crypto';

export const MAX_TEXT = 2000;

export function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function emptyData() {
  return { version: 1, words: [], texts: [], events: [] };
}

export function saveTranslation(data, { text, translation, source = 'en', target = 'he', context = '' }, now = new Date()) {
  const clean = normalizeText(text);
  const translated = normalizeText(translation);
  if (!clean || clean.length > MAX_TEXT || !translated) throw new Error('Invalid translation');
  const key = `${source}:${target}:${clean.toLocaleLowerCase()}`;
  let word = data.words.find(item => item.key === key);
  if (word) {
    word.translation = translated;
    word.lastSeenAt = now.toISOString();
    word.encounters = (word.encounters || 1) + 1;
    if (context && !word.context) word.context = normalizeText(context).slice(0, 1000);
  } else {
    word = {
      id: randomUUID(), key, text: clean, translation: translated, source, target,
      context: normalizeText(context).slice(0, 1000), tags: [], note: '', status: 'new',
      createdAt: now.toISOString(), lastSeenAt: now.toISOString(), encounters: 1,
      easeFactor: 2.5, intervalDays: 0, reviewCount: 0, correctCount: 0,
      nextReview: now.toISOString(), lastReviewed: null
    };
    data.words.unshift(word);
  }
  return word;
}

export function gradeWord(word, grade, now = new Date()) {
  if (!['hard', 'good', 'easy'].includes(grade)) throw new Error('Invalid grade');
  const sameDay = word.lastReviewed && word.lastReviewed.slice(0, 10) === now.toISOString().slice(0, 10);
  let interval = word.intervalDays || 1;
  let ease = word.easeFactor || 2.5;
  let reviews = word.reviewCount || 0;
  let correct = word.correctCount || 0;

  if (!reviews) {
    interval = 1;
    ease = 2.5;
    reviews = 1;
    correct = grade === 'hard' ? 0 : 1;
  } else if (sameDay) {
    if (grade === 'hard') interval = 1;
    if (grade === 'easy') interval = Math.max(interval, 2);
  } else {
    reviews += 1;
    if (grade === 'hard') {
      interval = 1;
      ease = Math.max(1.3, ease - 0.2);
    } else {
      correct += 1;
      interval = Math.floor(interval * ease * (grade === 'easy' ? 1.5 : 1));
      ease = Math.min(2.5, ease + (grade === 'easy' ? 0.15 : 0.1));
    }
  }
  interval = Math.max(1, Math.min(3650, interval));
  Object.assign(word, {
    easeFactor: Math.round(ease * 10000) / 10000,
    intervalDays: interval,
    reviewCount: reviews,
    correctCount: correct,
    nextReview: new Date(now.getTime() + interval * 86400000).toISOString(),
    lastReviewed: now.toISOString(),
    status: interval >= 21 ? 'mastered' : interval >= 7 ? 'learning' : 'reviewing'
  });
  return word;
}

export function dueWords(data, now = new Date()) {
  return data.words.filter(word => word.status !== 'known' && (!word.nextReview || word.nextReview <= now.toISOString()));
}

export function stats(data, now = new Date()) {
  const due = dueWords(data, now).length;
  const known = data.words.filter(word => ['known', 'mastered'].includes(word.status)).length;
  const today = now.toISOString().slice(0, 10);
  return {
    total: data.words.length, due, known,
    newToday: data.words.filter(word => word.createdAt?.startsWith(today)).length,
    reviewsToday: data.events.filter(event => event.type === 'review' && event.at.startsWith(today)).length
  };
}
