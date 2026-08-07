/* ================================================
   MEMÓRIA DA FAMA — game.js
   States: MENU → LOADING → PLAYING → TIME_UP / VICTORY → SAVING
================================================ */

const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwxbkUndhZPtFvtK1uIFTkPNN-m6WeiFVMU3IDzuahsC0oQp8Ba2GLQFOAPkWv8eiA3/exec';
const URL_PARAMS = new URLSearchParams(window.location.search);
const TELEGRAM_ID = (URL_PARAMS.get('tg') || 'guest').trim();
const ARTIST_NAME = (URL_PARAMS.get('artist') || '').trim();

const ENTRY_FEE = 30;
const GAME_DURATION = 40;
const TIME_COEF = 8;             // tempo_restante * 8
const FLAWLESS_BONUS = 0.5;      // +50%
const SPEED_BONUS_THRESHOLD = 20; // <20s → cap 3x entrada
const MAX_PRIZE = ENTRY_FEE * 3;

const ICONS = ['🎤','🎸','🎧','👑','💿','⭐','💎','🎬'];

// ── State
let STATE = 'MENU';
let cards = [];           // {id, key, photo, icon, matched, flipped}
let firstPick = null;
let secondPick = null;
let lockBoard = false;
let pairsFound = 0;
let errors = 0;
let timeLeft = GAME_DURATION;
let timerInterval = null;
let entryDebited = false;
let cachedArtists = null;

// ── DOM
const board = document.getElementById('board');
const hud = document.getElementById('hud');
const boardWrap = document.getElementById('board-wrap');
const elTime = document.getElementById('hud-time');
const elPairs = document.getElementById('hud-pairs');
const elErrors = document.getElementById('hud-errors');
const timeBar = document.getElementById('time-bar');

// ── UI helpers
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  if (id) document.getElementById(id).classList.add('active');
}
function showHUD(v) { hud.classList.toggle('hidden', !v); boardWrap.classList.toggle('hidden', !v); }

// ── Utils
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function pick(arr, n) { return shuffle(arr.slice()).slice(0, n); }

// ── Backend
async function callEmpire(payload) {
  try {
    const res = await fetch(WEBHOOK_URL, { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) return { ok: false, erro: 'HTTP ' + res.status };
    const txt = await res.text();
    try { return JSON.parse(txt); } catch (_) { return { ok: false, erro: 'Resposta inválida' }; }
  } catch (e) { return { ok: false, erro: e.message || 'Falha de rede' }; }
}

async function fetchArtists() {
  if (cachedArtists) return cachedArtists;
  const url = `${WEBHOOK_URL}?acao=listar_todos&_t=${Date.now()}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (Array.isArray(data)) {
      cachedArtists = data.filter(a => a && a.foto && a.nome);
      return cachedArtists;
    }
  } catch (e) { console.error('Falha ao listar artistas', e); }
  return [];
}

async function syncCoins(wager, won) {
  const r = await callEmpire({
    acao: 'sync_game_coins',
    telegram_id: TELEGRAM_ID,
    wager: wager,
    won: won,
    gameContext: 'Memória da Fama',
    artistName: ARTIST_NAME
  });
  return r && r.ok === true;
}

// ── Game build
async function startGame() {
  STATE = 'LOADING';
  showScreen('screen-loading');
  document.getElementById('loading-text').textContent = 'Debitando entrada de 30 E$C…';

  if (!ARTIST_NAME) {
    alert('Nenhum artista selecionado. Volte ao menu e escolha um artista.');
    showScreen('screen-menu'); STATE = 'MENU'; return;
  }

  const debit = await syncCoins(ENTRY_FEE, 0);
  if (!debit) {
    alert('Não foi possível debitar a entrada. Saldo insuficiente ou falha de rede.');
    showScreen('screen-menu'); STATE = 'MENU'; return;
  }
  entryDebited = true;

  document.getElementById('loading-text').textContent = 'Reunindo o elenco do Império…';
  const artists = await fetchArtists();
  if (artists.length < 2) {
    alert('Nenhum artista disponível para a memória.');
    showScreen('screen-menu'); STATE = 'MENU'; return;
  }

  // Sorteia 8 (ou tantos quantos houver, repetindo para chegar a 8 em casos extremos)
  let chosen = pick(artists, Math.min(8, artists.length));
  while (chosen.length < 8) chosen.push(chosen[chosen.length % artists.length]);

  const iconPool = shuffle(ICONS.slice());
  const deck = [];
  chosen.forEach((a, i) => {
    const key = `pair-${i}`;
    const cardData = { key, photo: a.foto, icon: iconPool[i] };
    deck.push({ ...cardData, id: key + '-a' });
    deck.push({ ...cardData, id: key + '-b' });
  });
  shuffle(deck);
  cards = deck.map(d => ({ ...d, matched: false, flipped: false }));

  renderBoard();
  pairsFound = 0; errors = 0; timeLeft = GAME_DURATION;
  firstPick = null; secondPick = null; lockBoard = false;
  updateHUD();
  showScreen(null);
  showHUD(true);
  STATE = 'PLAYING';
  startTimer();
}

function renderBoard() {
  board.innerHTML = '';
  cards.forEach(c => {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = c.id;
    el.innerHTML = `
      <div class="face face-back"></div>
      <div class="face face-front">
        <div class="photo" style="background-image:url('${c.photo}')"></div>
        <div class="icon">${c.icon}</div>
      </div>`;
    el.addEventListener('click', () => onCardClick(c, el));
    board.appendChild(el);
  });
}

function onCardClick(card, el) {
  if (STATE !== 'PLAYING' || lockBoard) return;
  if (card.matched || card.flipped) return;
  card.flipped = true;
  el.classList.add('flipped');

  if (!firstPick) { firstPick = { card, el }; return; }
  secondPick = { card, el };
  lockBoard = true;

  if (firstPick.card.key === secondPick.card.key) {
    firstPick.card.matched = true;
    secondPick.card.matched = true;
    firstPick.el.classList.add('matched');
    secondPick.el.classList.add('matched');
    pairsFound++;
    updateHUD();
    resetPicks();
    if (pairsFound === 8) winGame();
  } else {
    errors++;
    updateHUD();
    setTimeout(() => {
      firstPick.card.flipped = false;
      secondPick.card.flipped = false;
      firstPick.el.classList.remove('flipped');
      secondPick.el.classList.remove('flipped');
      resetPicks();
    }, 800);
  }
}
function resetPicks() {
  firstPick = null; secondPick = null;
  setTimeout(() => { lockBoard = false; }, 50);
}

function updateHUD() {
  elTime.textContent = `${Math.max(0, Math.ceil(timeLeft))}s`;
  elPairs.textContent = `${pairsFound}/8`;
  elErrors.textContent = errors;
  const pct = Math.max(0, timeLeft / GAME_DURATION) * 100;
  timeBar.style.width = pct + '%';
  timeBar.classList.remove('warn', 'danger');
  if (pct < 30) timeBar.classList.add('danger');
  else if (pct < 60) timeBar.classList.add('warn');
}

function startTimer() {
  clearInterval(timerInterval);
  const startedAt = performance.now();
  const initial = timeLeft;
  timerInterval = setInterval(() => {
    if (STATE !== 'PLAYING') return;
    const elapsed = (performance.now() - startedAt) / 1000;
    timeLeft = initial - elapsed;
    if (timeLeft <= 0) { timeLeft = 0; updateHUD(); timeUp(); return; }
    updateHUD();
  }, 100);
}

// ── End states
async function timeUp() {
  STATE = 'TIME_UP';
  clearInterval(timerInterval);
  showHUD(false);
  document.getElementById('tu-detail').textContent = `Pares: ${pairsFound}/8 · Erros: ${errors}`;
  showScreen('screen-timeup');
  // Entrada já foi debitada, nada a creditar. Registra "won=0" para histórico.
  document.getElementById('tu-saving').classList.remove('hidden');
  await syncCoins(0, 0);
  document.getElementById('tu-saving').classList.add('hidden');
}

async function winGame() {
  STATE = 'VICTORY';
  clearInterval(timerInterval);

  const flawless = errors === 0;
  let prize = Math.round(timeLeft * TIME_COEF);
  if (flawless) prize = Math.round(prize * (1 + FLAWLESS_BONUS));
  // Cap velocidade: completar em < 30s libera até 3× a entrada
  if ((GAME_DURATION - timeLeft) < SPEED_BONUS_THRESHOLD) {
    prize = Math.min(MAX_PRIZE, Math.max(prize, ENTRY_FEE * 2));
  }
  prize = Math.max(0, Math.min(MAX_PRIZE, prize));

  showHUD(false);
  document.getElementById('vic-prize').textContent = `+${prize} E$C`;
  document.getElementById('vic-detail').textContent = `Tempo restante: ${Math.ceil(timeLeft)}s · Erros: ${errors}`;
  document.getElementById('vic-flawless').classList.toggle('hidden', !flawless);
  showScreen('screen-victory');
  startConfetti();

  document.getElementById('vic-saving').classList.remove('hidden');
  await syncCoins(0, prize);
  document.getElementById('vic-saving').classList.add('hidden');
}

// ── Confetti
const cConf = document.getElementById('confetti');
const ctxConf = cConf.getContext('2d');
function sizeConfetti() { cConf.width = window.innerWidth; cConf.height = window.innerHeight; }
window.addEventListener('resize', sizeConfetti); sizeConfetti();
let confettiPieces = []; let confettiAnim = null;
function startConfetti() {
  confettiPieces = [];
  const colors = ['#ffd700','#ff9500','#c84bff','#4bf0ff','#ff4b96','#4ade80'];
  for (let i = 0; i < 140; i++) {
    confettiPieces.push({
      x: Math.random() * cConf.width,
      y: -20 - Math.random() * cConf.height,
      vy: 2 + Math.random() * 4,
      vx: (Math.random() - 0.5) * 3,
      size: 6 + Math.random() * 6,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length]
    });
  }
  cancelAnimationFrame(confettiAnim);
  loopConfetti();
  setTimeout(() => { cancelAnimationFrame(confettiAnim); ctxConf.clearRect(0,0,cConf.width,cConf.height); }, 4500);
}
function loopConfetti() {
  ctxConf.clearRect(0,0,cConf.width,cConf.height);
  confettiPieces.forEach(p => {
    p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    ctxConf.save();
    ctxConf.translate(p.x, p.y); ctxConf.rotate(p.rot);
    ctxConf.fillStyle = p.color;
    ctxConf.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.4);
    ctxConf.restore();
  });
  confettiAnim = requestAnimationFrame(loopConfetti);
}

// ── Listeners
document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-retry').addEventListener('click', startGame);
document.getElementById('btn-again').addEventListener('click', startGame);
document.getElementById('btn-menu-tu').addEventListener('click', () => { showScreen('screen-menu'); STATE = 'MENU'; });
document.getElementById('btn-menu-vic').addEventListener('click', () => { showScreen('screen-menu'); STATE = 'MENU'; });
