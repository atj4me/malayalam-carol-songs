const listView = document.getElementById('listView');
const songView = document.getElementById('songView');
const songList = document.getElementById('songList');
const searchInput = document.getElementById('search');
const noResults = document.getElementById('noResults');
const lyricsEl = document.getElementById('lyrics');

let fontSize = parseFloat(localStorage.getItem('carolFontSize') || '1.38');
if (localStorage.getItem('carolTheme') === 'light') document.body.classList.add('light');
const themeBtn = document.getElementById('themeToggle');
function syncThemeBtn() { themeBtn.textContent = document.body.classList.contains('light') ? '🌙 Dark' : '☀ Light'; }
syncThemeBtn();
themeBtn.addEventListener('click', function () {
  document.body.classList.toggle('light');
  localStorage.setItem('carolTheme', document.body.classList.contains('light') ? 'light' : 'dark');
  syncThemeBtn();
});
const countEl = document.getElementById('songCount');
if (countEl) countEl.textContent = SONGS.length;

function renderList(filter) {
  const q = (filter || '').trim().toLowerCase();
  songList.innerHTML = '';
  let shown = 0;
  SONGS.forEach(function (s) {
    const hay = (s.n + ' ' + s.title + ' ' + s.ml + ' ' + s.lyrics).toLowerCase();
    if (q && !hay.includes(q)) return;
    shown++;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#/song/' + s.n;
    a.innerHTML = '<span class="num">' + s.n + '</span><span><span class="song-ml-list"></span><span class="song-en-list"></span></span>';
    a.querySelector('.song-ml-list').textContent = s.ml;
    a.querySelector('.song-en-list').textContent = s.title;
    li.appendChild(a);
    songList.appendChild(li);
  });
  noResults.hidden = shown !== 0;
}

function showSong(n) {
  const s = SONGS.find(function (x) { return x.n === n; });
  if (!s) { location.hash = '#/'; return; }
  listView.hidden = true;
  songView.hidden = false;
  document.getElementById('songMl').textContent = s.n + '. ' + s.ml;
  document.getElementById('songTitle').textContent = s.title;
  const note = document.getElementById('songNote');
  if (s.note) { note.textContent = s.note; note.hidden = false; } else { note.hidden = true; }
  stopPlayer();
  buildLines(s.lyrics);
  lyricsEl.style.fontSize = fontSize + 'rem';
  const scanWrap = document.getElementById('scanWrap');
  scanWrap.hidden = true;
  const scanBtn = document.getElementById('scanToggle');
  scanBtn.textContent = 'Original scan';
  scanBtn.classList.remove('active');
  document.getElementById('scanImg').src = (typeof SONG_IMAGES !== 'undefined' && SONG_IMAGES[s.n])
    ? SONG_IMAGES[s.n]
    : 'images/song-' + String(s.n).padStart(2, '0') + '.jpg';
  const sourceWrap = document.getElementById('sourceWrap');
  if (s.source) {
    const link = document.getElementById('sourceLink');
    link.href = s.source; link.textContent = s.source;
    sourceWrap.hidden = false;
  } else { sourceWrap.hidden = true; }
  const prev = document.getElementById('prevBtn');
  const next = document.getElementById('nextBtn');
  if (n > 1) { prev.href = '#/song/' + (n - 1); prev.classList.remove('disabled'); }
  else { prev.href = '#'; prev.classList.add('disabled'); }
  if (n < SONGS.length) { next.href = '#/song/' + (n + 1); next.classList.remove('disabled'); }
  else { next.href = '#'; next.classList.add('disabled'); }
  window.scrollTo(0, 0);
}

function route() {
  const m = location.hash.match(/^#\/song\/(\d+)$/);
  if (m) { showSong(parseInt(m[1], 10)); }
  else {
    stopPlayer();
    songView.hidden = true;
    listView.hidden = false;
    renderList(searchInput.value);
  }
}

searchInput.addEventListener('input', function () { renderList(searchInput.value); });
document.getElementById('fontUp').addEventListener('click', function () {
  fontSize = Math.min(1.9, +(fontSize + 0.12).toFixed(2));
  localStorage.setItem('carolFontSize', fontSize);
  lyricsEl.style.fontSize = fontSize + 'rem';
});
document.getElementById('fontDown').addEventListener('click', function () {
  fontSize = Math.max(0.9, +(fontSize - 0.12).toFixed(2));
  localStorage.setItem('carolFontSize', fontSize);
  lyricsEl.style.fontSize = fontSize + 'rem';
});
document.getElementById('scanToggle').addEventListener('click', function () {
  const wrap = document.getElementById('scanWrap');
  wrap.hidden = !wrap.hidden;
  this.textContent = wrap.hidden ? 'Original scan' : 'Hide scan';
  this.classList.toggle('active', !wrap.hidden);
  if (!wrap.hidden) wrap.scrollIntoView({ block: 'start' });
});
/* ---------- Sing-along: line highlight + auto-scroll ---------- */
const SPEEDS = [0.6, 0.8, 1, 1.25, 1.5, 2];
/* Singing time for one pass of a line, scaled by its length so long lines
   get more time than short ones: ~2.4s for a typical line at 1x. */
function lineMs(text) {
  return Math.min(4200, Math.max(1400, 900 + text.length * 30));
}
let steps = [];        /* {el, text, beats, stanza, refStanza} per singable line */
let seq = [];          /* play queue of step indices; reference lines expand to their stanza */
let doneSet = new Set();
let qpos = -1;
let playTimer = null;
let playing = false;
let speedIdx = 2;
let wakeLock = null;

const playBtn = document.getElementById('playBtn');
const playerBar = document.getElementById('playerBar');
const speedLabel = document.getElementById('speedLabel');
const startHint = document.getElementById('startHint');

function buildLines(lyrics) {
  steps = [];
  seq = [];
  doneSet = new Set();
  qpos = -1;
  lyricsEl.innerHTML = '';
  let stanza = 0;
  lyrics.split('\n').forEach(function (raw) {
    const t = raw.trim();
    if (!t) {
      const gap = document.createElement('div');
      gap.className = 'l-gap';
      lyricsEl.appendChild(gap);
      stanza++;
      return;
    }
    if (/^—+$/.test(t)) {
      const sep = document.createElement('div');
      sep.className = 'l-sep';
      sep.textContent = t;
      lyricsEl.appendChild(sep);
      stanza++;
      return;
    }
    const d = document.createElement('div');
    d.className = 'l-line';
    d.textContent = t;
    const idx = steps.length;
    const isRef = /^\(.*\)$/.test(t);
    if (isRef) d.classList.add('l-ref');
    steps.push({
      el: d, text: t, stanza: stanza, isRef: isRef, refStanza: null,
      beats: (/\(2\)\s*$/.test(t) || /\}\s*2\s*$/.test(t)) ? 2 : 1
    });
    d.addEventListener('click', function () { jumpTo(idx); });
    lyricsEl.appendChild(d);
  });
  /* A couplet brace spans two lines: if the first ends "} 2", the closing "}" line repeats too. */
  for (let i = 1; i < steps.length; i++) {
    if (/\}\s*$/.test(steps[i].text) && steps[i].beats === 1 && /\}\s*2\s*$/.test(steps[i - 1].text)) steps[i].beats = 2;
  }
  /* Resolve reference lines like "(ഇന്നു രാവിൽ കുഞ്ഞാട്ട......)": they point at the
     stanza whose first line starts with the text inside the brackets. */
  steps.forEach(function (st) {
    if (!st.isRef) return;
    const prefix = st.text.replace(/^\(|\)$/g, '').replace(/[.….]+$/, '').trim();
    if (prefix.length < 6) return;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].text.indexOf(prefix) === 0) {
        const target = steps[i].stanza;
        st.refStanza = steps.filter(function (x) { return x.stanza === target; })
          .map(function (x) { return steps.indexOf(x); });
        break;
      }
    }
  });
  steps.forEach(function (st) {
    /* A reference line is just a signpost — a short pause, then the chorus. */
    st.ms = st.isRef ? 900 : lineMs(st.text) * st.beats;
  });
  steps.forEach(function (st, i) {
    seq.push(i);
    if (st.refStanza) st.refStanza.forEach(function (j) { seq.push(j); });
  });
}

function setCurrent(stepIdx, scroll) {
  steps.forEach(function (st, j) {
    st.el.classList.toggle('current', j === stepIdx);
    st.el.classList.toggle('done', doneSet.has(j) && j !== stepIdx);
  });
  if (stepIdx >= 0 && steps[stepIdx] && scroll !== false) {
    steps[stepIdx].el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function scheduleNext() {
  clearTimeout(playTimer);
  if (!playing || qpos < 0 || qpos >= seq.length) return;
  const ms = steps[seq[qpos]].ms / SPEEDS[speedIdx];
  playTimer = setTimeout(function () {
    doneSet.add(seq[qpos]);
    qpos++;
    if (qpos >= seq.length) { stopPlayer(); return; }
    setCurrent(seq[qpos]);
    scheduleNext();
  }, ms);
}

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); }
    else if (wakeLock) { wakeLock.release(); wakeLock = null; }
  } catch (e) { /* wake lock is best-effort */ }
}

function startPlayer(fromStep) {
  if (!seq.length) return;
  playing = true;
  playerBar.hidden = false;
  if (startHint) startHint.hidden = true;
  playBtn.textContent = '⏸ Pause';
  playBtn.classList.add('active');
  if (typeof fromStep === 'number') { qpos = Math.max(0, seq.indexOf(fromStep)); doneSet = new Set(seq.slice(0, qpos)); }
  else if (qpos < 0) qpos = 0;
  setCurrent(seq[qpos]);
  scheduleNext();
  keepAwake(true);
}

function pausePlayer() {
  playing = false;
  clearTimeout(playTimer);
  playBtn.textContent = '▶ Resume';
  playBtn.classList.remove('active');
  keepAwake(false);
}

function stopPlayer() {
  playing = false;
  clearTimeout(playTimer);
  playTimer = null;
  if (playBtn) { playBtn.textContent = '▶ Sing-along'; playBtn.classList.remove('active'); }
  if (playerBar) playerBar.hidden = true;
  if (startHint) startHint.hidden = false;
  steps.forEach(function (st) { st.el.classList.remove('current', 'done'); });
  doneSet = new Set();
  qpos = -1;
  keepAwake(false);
}

function jumpTo(stepIdx) {
  if (qpos < 0) { startPlayer(stepIdx); return; }
  qpos = Math.max(0, seq.indexOf(stepIdx));
  doneSet = new Set(seq.slice(0, qpos));
  setCurrent(seq[qpos]);
  if (!playing) {
    playing = true;
    playerBar.hidden = false;
    if (startHint) startHint.hidden = true;
    playBtn.textContent = '⏸ Pause';
    playBtn.classList.add('active');
    keepAwake(true);
  }
  scheduleNext();
}

playBtn.addEventListener('click', function () {
  if (playing) pausePlayer();
  else startPlayer();
});
document.getElementById('restartBtn').addEventListener('click', function () { doneSet = new Set(); startPlayer(0); });
document.getElementById('speedUp').addEventListener('click', function () {
  speedIdx = Math.min(SPEEDS.length - 1, speedIdx + 1);
  speedLabel.textContent = SPEEDS[speedIdx] + '×';
  if (playing) scheduleNext();
});
document.getElementById('speedDown').addEventListener('click', function () {
  speedIdx = Math.max(0, speedIdx - 1);
  speedLabel.textContent = SPEEDS[speedIdx] + '×';
  if (playing) scheduleNext();
});

window.addEventListener('hashchange', route);
route();
