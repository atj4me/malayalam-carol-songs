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
const BASE_MS = 2400; /* time per line at 1x */
let steps = [];        /* {el, beats} for each singable line */
let playIdx = -1;
let playTimer = null;
let playing = false;
let speedIdx = 2;
let wakeLock = null;

const playBtn = document.getElementById('playBtn');
const playerBar = document.getElementById('playerBar');
const speedLabel = document.getElementById('speedLabel');

function buildLines(lyrics) {
  steps = [];
  playIdx = -1;
  lyricsEl.innerHTML = '';
  lyrics.split('\n').forEach(function (raw) {
    const t = raw.trim();
    if (!t) {
      const gap = document.createElement('div');
      gap.className = 'l-gap';
      lyricsEl.appendChild(gap);
      return;
    }
    if (/^—+$/.test(t)) {
      const sep = document.createElement('div');
      sep.className = 'l-sep';
      sep.textContent = t;
      lyricsEl.appendChild(sep);
      return;
    }
    const d = document.createElement('div');
    d.className = 'l-line';
    d.textContent = t;
    const idx = steps.length;
    steps.push({ el: d, beats: /\(2\)\s*$/.test(t) ? 2 : 1 });
    d.addEventListener('click', function () { jumpTo(idx); });
    lyricsEl.appendChild(d);
  });
}

function setCurrent(i, scroll) {
  steps.forEach(function (st, j) {
    st.el.classList.toggle('current', j === i);
    st.el.classList.toggle('done', j < i);
  });
  playIdx = i;
  if (i >= 0 && steps[i] && scroll !== false) {
    steps[i].el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function scheduleNext() {
  clearTimeout(playTimer);
  if (!playing || playIdx < 0) return;
  const ms = steps[playIdx].beats * BASE_MS / SPEEDS[speedIdx];
  playTimer = setTimeout(function () {
    if (playIdx + 1 >= steps.length) { stopPlayer(); return; }
    setCurrent(playIdx + 1);
    scheduleNext();
  }, ms);
}

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); }
    else if (wakeLock) { wakeLock.release(); wakeLock = null; }
  } catch (e) { /* wake lock is best-effort */ }
}

function startPlayer(fromIdx) {
  if (!steps.length) return;
  playing = true;
  playerBar.hidden = false;
  playBtn.textContent = '⏸ Pause';
  playBtn.classList.add('active');
  setCurrent(typeof fromIdx === 'number' ? fromIdx : Math.max(playIdx, 0));
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
  steps.forEach(function (st) { st.el.classList.remove('current', 'done'); });
  playIdx = -1;
  keepAwake(false);
}

function jumpTo(i) {
  if (!playing && playIdx < 0) { startPlayer(i); return; }
  const wasPlaying = playing;
  if (wasPlaying || playIdx >= 0) {
    setCurrent(i);
    if (wasPlaying) scheduleNext();
    else { playing = true; playBtn.textContent = '⏸ Pause'; playBtn.classList.add('active'); playerBar.hidden = false; scheduleNext(); keepAwake(true); }
  }
}

playBtn.addEventListener('click', function () {
  if (playing) pausePlayer();
  else startPlayer();
});
document.getElementById('restartBtn').addEventListener('click', function () { startPlayer(0); });
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
