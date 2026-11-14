const $ = selector => document.querySelector(selector);
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const state = { page: 'home', data: { words: [], texts: [], events: [], stats: {} }, query: '', filter: 'all', result: null, translateInput: '', source: 'en', target: 'he', translateTimer: null, translateController: null, translateVersion: 0, reviewQueue: [], reviewIndex: 0, revealed: false, quiz: null, readerId: null, readerResult: null };
const languages = { en: 'English', he: 'Hebrew', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ar: 'Arabic', ru: 'Russian', ja: 'Japanese', zh: 'Chinese' };
const translationCache = new Map();

async function api(op, method = 'GET', payload, options = {}) {
  const response = await fetch(`/api?op=${op}`, { method, credentials: 'same-origin', headers: payload ? { 'Content-Type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined, signal: options.signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function translateText(text, source, target, signal) {
  const key = `${source}:${target}:${text}`;
  if (translationCache.has(key)) return { text, translation: translationCache.get(key), source, target };
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  for (const [name, value] of Object.entries({ client: 'gtx', sl: source, tl: target, dt: 't', q: text })) url.searchParams.set(name, value);
  let translation;
  try {
    const response = await fetch(url, { credentials: 'omit', signal });
    if (!response.ok) throw new Error(`Translation service returned ${response.status}`);
    const payload = await response.json();
    translation = payload?.[0]?.map(segment => segment?.[0] || '').join('').trim();
    if (!translation) throw new Error('No translation was returned');
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    // Google's public endpoint can limit a browser IP. Try a second
    // provider from the browser before using the server's shared IP.
    if (new TextEncoder().encode(text).length <= 500) {
      try {
        const backupUrl = new URL('https://api.mymemory.translated.net/get');
        backupUrl.searchParams.set('q', text);
        backupUrl.searchParams.set('langpair', `${source}|${target}`);
        const backup = await fetch(backupUrl, { credentials: 'omit', signal });
        if (!backup.ok) throw new Error(`Backup translator returned ${backup.status}`);
        const payload = await backup.json();
        translation = payload?.responseData?.translatedText?.trim();
        if (Number(payload?.responseStatus) !== 200 || !translation || /^MYMEMORY WARNING/i.test(translation)) {
          throw new Error('Backup translator returned no translation');
        }
      } catch (backupError) {
        if (signal?.aborted || backupError.name === 'AbortError') throw backupError;
      }
    }
    if (!translation) {
      const fallback = await api('translate', 'POST', { text, source, target }, { signal });
      translation = fallback.translation;
    }
  }
  translationCache.set(key, translation);
  if (translationCache.size > 200) translationCache.delete(translationCache.keys().next().value);
  return { text, translation, source, target };
}
function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('visible'), 3500); }
function errorMessage(error) { toast(error.message || 'Something went wrong'); }
function date(value) { return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; }
function empty(icon, title, copy) { return `<div class="empty"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${copy}</p></div>`; }
function head(kicker, title, subtitle, action = '') { return `<div class="page-head"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`; }
function statCard(label, value, icon, cls = '') { return `<div class="card stat-card"><div><div class="label">${label}</div><strong>${value}</strong></div><div class="stat-icon ${cls}">${icon}</div></div>`; }
function wordRow(word, editable = false) { return `<div class="word-row"><div class="word-symbol">${e(word.text?.[0] || '?')}</div><div class="word-main"><strong>${e(word.text)}</strong><small>${word.context ? e(word.context) : `Seen ${word.encounters || 1} time${word.encounters === 1 ? '' : 's'}`}</small></div><div class="word-translation" dir="auto">${e(word.translation)}</div><span class="pill ${e(word.status)}">${e(word.status)}</span>${editable ? `<button class="button small" data-edit="${e(word.id)}">Edit</button>` : ''}</div>`; }

function renderHome() {
  const s = state.data.stats || {};
  const recent = [...state.data.words].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, 5);
  return `<div class="hero"><div class="hero-copy"><span class="eyebrow">YOUR LANGUAGE JOURNEY</span><h1>Make every word<br><em>part of you.</em></h1><p>Translate freely, then save the words you want to practise and remember.</p><button class="button primary" data-go="translate">Translate something <span>↗</span></button></div><div class="hero-ornament">a</div></div>
  <div class="section-title"><h2>Your progress at a glance</h2></div><div class="grid three">${statCard('WORDS COLLECTED', s.total || 0, '▦')}${statCard('READY TO REVIEW', s.due || 0, '◇', 'gold')}${statCard('WORDS YOU KNOW', s.known || 0, '✦', 'blue')}</div>
  <div class="section-title"><h2>Recently encountered</h2><a data-go="vocabulary">View all words →</a></div><div class="card list-card">${recent.length ? recent.map(w => wordRow(w)).join('') : empty('✧', 'Your collection starts here', 'Translate a word, then save it here when you want to learn it.')}</div>`;
}

function renderTranslate() {
  const result = state.result;
  return `${head('LOOK UP & LEARN', 'Translate <em>anything.</em>', 'Translations appear as you type. Save only the words you want to study.')}
  <div id="translate-workspace"><div class="direction-row"><span>${e(languages[state.source])} → ${e(languages[state.target])}</span><button type="button" class="button small" id="swap-langs" aria-label="Swap translation languages">⇄ Swap languages</button></div><div class="translate-layout"><div class="card translate-panel"><div class="panel-top"><span>FROM</span><select id="source-lang">${Object.entries(languages).map(([code, name]) => `<option value="${code}" ${code === state.source ? 'selected' : ''}>${name}</option>`).join('')}</select></div><textarea id="translate-input" placeholder="Type or paste a word, phrase, or sentence…" maxlength="2000" aria-label="Text to translate" dir="auto">${e(state.translateInput)}</textarea><div class="panel-bottom"><span id="char-count">${state.translateInput.length} / 2000</span><button type="button" class="button small" id="speak-source" ${state.translateInput.trim() ? '' : 'disabled'}>♫ Listen to input</button></div></div><div class="card translate-panel"><div class="panel-top"><span>TO</span><select id="target-lang">${Object.entries(languages).map(([code, name]) => `<option value="${code}" ${code === state.target ? 'selected' : ''}>${name}</option>`).join('')}</select></div><div class="translated" id="translation-output" dir="auto">${result ? e(result.translation) : '<span style="color:#b9c2c3">Your translation will appear here.</span>'}</div><div class="panel-bottom"><span id="translation-status">${result ? (result.saved ? 'Saved to your words ✓' : 'Not saved yet') : 'Ready when you are'}</span><button type="button" class="button small" id="speak-result" ${result ? '' : 'disabled'}>♫ Listen</button></div></div></div><div class="translate-actions"><button id="save-translation" type="button" class="button" ${result && !result.saved ? '' : 'disabled'}>${result?.saved ? 'Saved ✓' : 'Save to words'}</button></div></div>
  <p class="hint">Only words you save are added to your vocabulary and review cards. You can swap the direction at any time.</p>`;
}

function renderVocabulary() {
  const words = state.data.words.filter(word => {
    const q = state.query.toLowerCase();
    return (state.filter === 'all' || word.status === state.filter) && (!q || [word.text, word.translation, word.note, ...(word.tags || [])].join(' ').toLowerCase().includes(q));
  });
  return `${head('YOUR COLLECTION', 'Every word has a <em>story.</em>', `${state.data.words.length} saved words · search, edit, and revisit them.`, `<button class="button" id="export-button">↓ Export backup</button>`)}
  <div class="toolbar"><input class="input" id="search-words" placeholder="Search your words…" value="${e(state.query)}"><select id="filter-words"><option value="all">All statuses</option>${['new','reviewing','learning','mastered','known'].map(x => `<option ${state.filter === x ? 'selected' : ''}>${x}</option>`).join('')}</select><div class="spacer"></div><label class="button" for="import-file">↑ Import backup</label><input id="import-file" type="file" accept=".json,application/json" hidden></div>
  <div class="card list-card" id="words-list">${words.length ? words.map(w => wordRow(w, true)).join('') : empty('⌕', 'No words found', 'Try a different search or translate a new word.')}</div>`;
}

function renderReview() {
  const queue = state.reviewQueue;
  if (!queue.length) return `${head('SPACED REPETITION', 'A little practice <em>goes far.</em>', 'Words return when they need your attention.')}${empty('✦', 'You are all caught up', 'Translate more words or come back when your next review is due.')}`;
  const word = queue[state.reviewIndex];
  if (!word) return `${head('SPACED REPETITION', 'Session <em>complete.</em>', 'Every answer makes the memory stronger.')}${empty('✦', 'Beautifully done', 'You reviewed every word due today.')}<div style="text-align:center"><button class="button primary" data-go="home">Back to overview</button></div>`;
  const progress = Math.round(state.reviewIndex / queue.length * 100);
  return `${head('SPACED REPETITION', 'Remember what <em>matters.</em>', `${queue.length - state.reviewIndex} cards left in this session.`)}<div style="max-width:610px;margin:auto"><div class="progress-line"><span style="width:${progress}%"></span></div><div class="card review-card"><span class="eyebrow">${e((word.source || 'en').toUpperCase())} → ${e((word.target || 'he').toUpperCase())}</span><div class="review-word">${e(word.text)}</div><div class="review-context">${word.context ? e(word.context) : 'Think of the meaning before revealing it.'}</div>${state.revealed ? `<div class="review-answer" dir="auto">${e(word.translation)}</div><div class="grade-row"><button class="button" data-grade="hard">Again</button><button class="button soft" data-grade="good">Good</button><button class="button primary" data-grade="easy">Easy</button></div>` : `<button class="button primary" id="reveal-answer">Show answer <span>→</span></button>`}</div><p class="hint" style="text-align:center">A hard answer comes back sooner. Easy answers earn a longer break.</p></div>`;
}

function chooseQuiz() {
  const words = state.data.words.filter(word => word.translation && word.text.length <= 80);
  if (!words.length) return null;
  const word = words[Math.floor(Math.random() * words.length)];
  const others = words.filter(w => w.id !== word.id && w.translation !== word.translation).sort(() => Math.random() - .5).slice(0, 3);
  const choices = [word, ...others].sort(() => Math.random() - .5).map(w => w.translation);
  return { word, choices, answered: null, typed: false };
}

function renderQuiz() {
  if (!state.quiz) state.quiz = chooseQuiz();
  if (!state.quiz) return `${head('ACTIVE RECALL', 'Test what you <em>know.</em>', 'Use your own vocabulary for quick practice.')}${empty('◉', 'Nothing to quiz yet', 'Translate a few words first.')}`;
  const q = state.quiz;
  return `${head('ACTIVE RECALL', 'Test what you <em>know.</em>', 'A quick check helps move a word into long-term memory.')}
  <div class="card" style="max-width:620px;margin:auto;padding:34px"><span class="eyebrow">WHAT DOES THIS MEAN?</span><h2 class="review-word" style="font-size:39px;margin:15px 0 26px">${e(q.word.text)}</h2>${q.choices.length >= 3 ? q.choices.map(choice => `<button class="choice ${q.answered ? (choice === q.word.translation ? 'correct' : choice === q.answered ? 'wrong' : '') : ''}" data-choice="${e(choice)}" ${q.answered ? 'disabled' : ''} dir="auto">${e(choice)}</button>`).join('') : `<form id="typed-quiz"><input class="input" id="typed-answer" placeholder="Type the meaning…" ${q.answered ? 'disabled' : ''}><button class="button primary" style="margin-top:12px" ${q.answered ? 'disabled' : ''}>Check answer</button></form>`}${q.answered ? `<p style="font-size:13px;color:var(--green);margin:20px 0">Answer: <strong dir="auto">${e(q.word.translation)}</strong></p><button class="button primary" id="next-quiz">Next word →</button>` : ''}</div>`;
}

function readerWords(content, id) {
  const saved = new Set(state.data.words.map(w => w.text.toLowerCase()));
  return content.split(/(\p{L}+(?:['’-]\p{L}+)*)/u).map(part => /\p{L}/u.test(part) ? `<button class="reader-word ${saved.has(part.toLowerCase()) ? 'saved' : ''}" data-reader-word="${e(part)}" data-reader-id="${e(id)}">${e(part)}</button>` : e(part)).join('');
}

function renderReader() {
  const current = state.data.texts.find(t => t.id === state.readerId);
  if (current) {
    const result = state.readerResult?.readerId === current.id ? state.readerResult : null;
    return `${head('READ & DISCOVER', e(current.title), 'Click a word to preview its translation. Save it only if you want to study it.', `<button class="button" id="close-reader">← All texts</button>`)}${result ? `<div class="card reader-preview"><div><strong dir="auto">${e(result.text)}</strong><span>→</span><strong dir="auto">${e(result.translation)}</strong></div><button class="button primary" id="save-reader-word" ${result.saved ? 'disabled' : ''}>${result.saved ? 'Saved ✓' : 'Save to words'}</button></div>` : ''}<div class="card reader-text">${readerWords(current.content, current.id)}</div><p class="hint">Saved words are highlighted in green.</p>`;
  }
  return `${head('READ & DISCOVER', 'Learn in <em>context.</em>', 'Paste something you are reading and keep the words you need.')}
  <div class="grid two"><div class="card"><h2 style="margin:0 0 17px;font-size:16px">Add a text</h2><form id="add-text-form"><input class="input" id="text-title" placeholder="Give your text a title" maxlength="120" required><textarea id="text-content" rows="9" placeholder="Paste an article, story, notes, or a book excerpt…" style="margin-top:10px" required></textarea><button class="button primary" style="margin-top:12px">Add to library →</button></form></div><div><div class="section-title" style="margin-top:0"><h2>Your reading library</h2></div><div class="reader-list">${state.data.texts.length ? state.data.texts.map(text => `<button data-open-text="${e(text.id)}"><span><strong>${e(text.title)}</strong><small style="display:block;color:var(--muted);margin-top:5px">${date(text.createdAt)} · ${text.content.length.toLocaleString()} characters</small></span><span>→</span></button>`).join('') : empty('▤', 'An empty bookshelf', 'Add a text to start reading.')}</div></div></div>`;
}

function renderStats() {
  const words = state.data.words;
  const s = state.data.stats || {};
  const statuses = ['new', 'reviewing', 'learning', 'mastered', 'known'];
  const counts = statuses.map(status => words.filter(w => w.status === status).length);
  const max = Math.max(1, ...counts);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d.toISOString().slice(0, 10); });
  return `${head('YOUR JOURNEY', 'Progress you can <em>see.</em>', 'Small reviews add up to lasting knowledge.')}
  <div class="grid three">${statCard('TOTAL WORDS', s.total || 0, '▦')}${statCard('REVIEWS TODAY', s.reviewsToday || 0, '◇', 'gold')}${statCard('MASTERED / KNOWN', s.known || 0, '✦', 'blue')}</div>
  <div class="grid two" style="margin-top:19px"><div class="card"><h2 style="font-size:16px;margin:0 0 23px">Learning stages</h2><div class="bar-list">${statuses.map((x, i) => `<div class="bar-row"><span style="text-transform:capitalize">${x}</span><div class="bar-track"><span style="width:${counts[i] / max * 100}%"></span></div><strong>${counts[i]}</strong></div>`).join('')}</div></div><div class="card"><h2 style="font-size:16px;margin:0 0 23px">Last 7 days</h2><div class="bar-list">${days.map(day => { const count = state.data.events.filter(event => event.type === 'review' && event.at.startsWith(day)).length; return `<div class="bar-row"><span>${date(day)}</span><div class="bar-track"><span style="width:${Math.max(3, count / Math.max(1, s.reviewsToday || 0, 5) * 100)}%"></span></div><strong>${count}</strong></div>`; }).join('')}</div></div></div>`;
}

function render() {
  const pages = { home: renderHome, translate: renderTranslate, vocabulary: renderVocabulary, review: renderReview, quiz: renderQuiz, reader: renderReader, stats: renderStats };
  $('#content').innerHTML = pages[state.page]();
  document.querySelectorAll('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.page === state.page));
  $('#nav-count').textContent = state.data.words.length;
  $('#nav-due').textContent = state.data.stats?.due || 0;
  bindPage();
}

async function refresh() { state.data = await api('data'); render(); }
function cancelTranslation() {
  clearTimeout(state.translateTimer);
  state.translateController?.abort();
  state.translateController = null;
  state.translateVersion++;
}

function queueTranslation() {
  cancelTranslation();
  state.result = null;
  const text = state.translateInput.trim();
  const output = $('#translation-output');
  const status = $('#translation-status');
  const save = $('#save-translation');
  if (!output || !status || !save) return;
  save.disabled = true;
  save.textContent = 'Save to words';
  $('#speak-result').disabled = true;
  if (!text) { output.textContent = 'Your translation will appear here.'; status.textContent = 'Ready when you are'; return; }
  if (state.source === state.target) { output.textContent = 'Choose different languages.'; status.textContent = 'Select two languages'; return; }
  output.textContent = 'Translating…';
  status.textContent = 'Looking up translation';
  const version = state.translateVersion;
  const source = state.source;
  const target = state.target;
  state.translateTimer = setTimeout(async () => {
    const controller = new AbortController();
    state.translateController = controller;
    try {
      const result = await translateText(text, source, target, controller.signal);
      if (version !== state.translateVersion || state.page !== 'translate') return;
      state.result = { ...result, saved: false };
      output.textContent = result.translation;
      status.textContent = 'Not saved yet';
      save.disabled = false;
      $('#speak-result').disabled = false;
    } catch (error) {
      if (version !== state.translateVersion || error.name === 'AbortError') return;
      output.textContent = error.message || 'Could not translate. Try again in a moment.';
      status.textContent = 'Translation unavailable';
    } finally {
      if (state.translateController === controller) state.translateController = null;
    }
  }, 650);
}

function go(page) { if (state.page === 'translate' && page !== 'translate') cancelTranslation(); state.page = page; if (page === 'review') { state.reviewQueue = state.data.words.filter(w => w.status !== 'known' && (!w.nextReview || w.nextReview <= new Date().toISOString())); state.reviewIndex = 0; state.revealed = false; } if (page === 'quiz') state.quiz = chooseQuiz(); render(); if (page === 'translate' && state.translateInput.trim() && !state.result) queueTranslation(); document.querySelector('.main').scrollTo?.(0, 0); }

function bindPage() {
  document.querySelectorAll('[data-go]').forEach(node => node.onclick = () => go(node.dataset.go));
  if (state.page === 'translate') {
    $('#translate-input').oninput = event => { state.translateInput = event.target.value; $('#char-count').textContent = `${event.target.value.length} / 2000`; $('#speak-source').disabled = !event.target.value.trim(); queueTranslation(); };
    $('#source-lang').onchange = event => { state.source = event.target.value; $('.direction-row span').textContent = `${languages[state.source]} → ${languages[state.target]}`; queueTranslation(); };
    $('#target-lang').onchange = event => { state.target = event.target.value; $('.direction-row span').textContent = `${languages[state.source]} → ${languages[state.target]}`; queueTranslation(); };
    $('#swap-langs').onclick = () => { const previous = state.result; [state.source, state.target] = [state.target, state.source]; state.translateInput = previous ? previous.translation : $('#translate-input').value; state.result = null; render(); queueTranslation(); $('#translate-input').focus(); };
    $('#save-translation').onclick = async event => { if (!state.result || state.result.saved) return; const result = state.result; const button = event.currentTarget; button.disabled = true; try { await api('save', 'POST', result); if (state.result === result) result.saved = true; await refresh(); toast('Saved to your words'); } catch (error) { errorMessage(error); if (button.isConnected) button.disabled = false; } };
    $('#speak-source').onclick = () => speak($('#translate-input').value.trim(), state.source);
    $('#speak-result').onclick = () => speak(state.result?.translation, state.target);
  }
  if (state.page === 'vocabulary') {
    $('#search-words').oninput = event => { state.query = event.target.value; const focus = event.target.selectionStart; render(); $('#search-words').focus(); $('#search-words').setSelectionRange(focus, focus); };
    $('#filter-words').onchange = event => { state.filter = event.target.value; render(); };
    $('#export-button').onclick = () => window.location.href = '/api?op=export';
    $('#import-file').onchange = async event => { const file = event.target.files[0]; if (!file) return; try { const data = JSON.parse(await file.text()); const result = await api('import', 'POST', data); await refresh(); toast(`Imported ${result.added} new words`); } catch (error) { errorMessage(error); } };
    document.querySelectorAll('[data-edit]').forEach(node => node.onclick = () => editWord(node.dataset.edit));
  }
  if (state.page === 'review') {
    if ($('#reveal-answer')) $('#reveal-answer').onclick = () => { state.revealed = true; render(); };
    document.querySelectorAll('[data-grade]').forEach(node => node.onclick = async () => { const word = state.reviewQueue[state.reviewIndex]; node.disabled = true; try { await api('grade', 'POST', { id: word.id, grade: node.dataset.grade }); state.reviewIndex++; state.revealed = false; state.data = await api('data'); render(); } catch (error) { errorMessage(error); node.disabled = false; } });
  }
  if (state.page === 'quiz') {
    document.querySelectorAll('[data-choice]').forEach(node => node.onclick = () => answerQuiz(node.dataset.choice));
    if ($('#typed-quiz')) $('#typed-quiz').onsubmit = event => { event.preventDefault(); answerQuiz($('#typed-answer').value.trim() || ' '); };
    if ($('#next-quiz')) $('#next-quiz').onclick = () => { state.quiz = chooseQuiz(); render(); };
  }
  if (state.page === 'reader') {
    if ($('#add-text-form')) $('#add-text-form').onsubmit = async event => { event.preventDefault(); try { const result = await api('text', 'POST', { title: $('#text-title').value, content: $('#text-content').value }); state.readerId = result.text.id; await refresh(); toast('Text added to your library'); } catch (error) { errorMessage(error); } };
    document.querySelectorAll('[data-open-text]').forEach(node => node.onclick = () => { state.readerId = node.dataset.openText; state.readerResult = null; render(); });
    if ($('#close-reader')) $('#close-reader').onclick = () => { state.readerId = null; state.readerResult = null; render(); };
    document.querySelectorAll('[data-reader-word]').forEach(node => node.onclick = async () => { const word = node.dataset.readerWord; const text = state.data.texts.find(t => t.id === node.dataset.readerId); const context = text?.content.split(/[.!?\n]/).find(sentence => sentence.includes(word))?.trim().slice(0, 1000) || ''; const source = /[\u0590-\u05FF]/.test(word) ? 'he' : 'en'; const target = source === 'he' ? 'en' : 'he'; try { const result = await translateText(word, source, target); state.readerResult = { ...result, context, readerId: text.id, saved: false }; render(); toast(`${word} → ${result.translation}`); } catch (error) { errorMessage(error); } });
    if ($('#save-reader-word')) $('#save-reader-word').onclick = async event => { if (!state.readerResult || state.readerResult.saved) return; const result = state.readerResult; const button = event.currentTarget; button.disabled = true; try { await api('save', 'POST', result); if (state.readerResult === result) result.saved = true; await refresh(); toast('Saved to your words'); } catch (error) { errorMessage(error); if (button.isConnected) button.disabled = false; } };
  }
}

function speak(text, lang) { if (!text) return; if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return toast('Audio is unavailable in this browser'); window.speechSynthesis.cancel(); const utterance = new window.SpeechSynthesisUtterance(text); utterance.lang = lang === 'he' ? 'he-IL' : lang === 'en' ? 'en-US' : lang; window.speechSynthesis.speak(utterance); }

async function answerQuiz(answer) {
  if (!state.quiz || state.quiz.answered) return;
  state.quiz.answered = answer;
  const correct = answer.trim().toLocaleLowerCase() === state.quiz.word.translation.trim().toLocaleLowerCase();
  try {
    await api('grade', 'POST', { id: state.quiz.word.id, grade: correct ? 'good' : 'hard' });
    state.data = await api('data');
  } catch (error) { errorMessage(error); }
  render();
}

function editWord(id) {
  const word = state.data.words.find(w => w.id === id); if (!word) return;
  const cover = document.createElement('div'); cover.className = 'modal-cover';
  cover.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h2>${e(word.text)}</h2><div class="form-grid"><label>Translation<input class="input" id="edit-translation" value="${e(word.translation)}" dir="auto"></label><label>Tags, comma separated<input class="input" id="edit-tags" value="${e((word.tags || []).join(', '))}"></label><label style="grid-column:1/-1">Note<textarea id="edit-note" rows="3">${e(word.note || '')}</textarea></label><label style="grid-column:1/-1">Context<textarea id="edit-context" rows="3">${e(word.context || '')}</textarea></label></div><div class="modal-actions"><button class="button danger" id="delete-word">Delete word</button><div style="display:flex;gap:8px"><button class="button" id="mark-known">${word.status === 'known' ? 'Mark learning' : 'Mark known'}</button><button class="button primary" id="save-word">Save changes</button></div></div></div>`;
  document.body.append(cover); cover.onclick = event => { if (event.target === cover) cover.remove(); };
  $('#save-word').onclick = async () => { try { await api('word', 'POST', { id, action: 'edit', translation: $('#edit-translation').value, tags: $('#edit-tags').value.split(',').map(x => x.trim()).filter(Boolean), note: $('#edit-note').value, context: $('#edit-context').value }); cover.remove(); await refresh(); toast('Word updated'); } catch (error) { errorMessage(error); } };
  $('#mark-known').onclick = async () => { try { await api('word', 'POST', { id, action: 'status', status: word.status === 'known' ? 'reviewing' : 'known' }); cover.remove(); await refresh(); toast('Status updated'); } catch (error) { errorMessage(error); } };
  $('#delete-word').onclick = async () => { if (!confirm(`Delete “${word.text}” from your vocabulary?`)) return; try { await api('word', 'POST', { id, action: 'delete' }); cover.remove(); await refresh(); toast('Word deleted'); } catch (error) { errorMessage(error); } };
}

$('#today-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
document.querySelectorAll('.nav-item').forEach(node => node.onclick = () => { go(node.dataset.page); $('.sidebar').classList.remove('open'); });
$('#menu-toggle').onclick = () => $('.sidebar').classList.toggle('open');
$('#logout').onclick = async () => { try { await api('logout', 'POST'); location.reload(); } catch (error) { errorMessage(error); } };
$('#login-form').onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); try { await api('login', 'POST', data); $('#login-error').textContent = ''; await start(); } catch (error) { $('#login-error').textContent = error.message; } };
async function start() { try { const session = await api('session'); $('#profile-name').textContent = session.username; $('.profile-dot').textContent = session.username[0]?.toUpperCase() || 'U'; $('#login').hidden = true; $('#shell').hidden = false; await refresh(); } catch (error) { $('#shell').hidden = true; $('#login').hidden = false; if (error.message !== 'Sign in required') $('#login-error').textContent = error.message; } }
start();
