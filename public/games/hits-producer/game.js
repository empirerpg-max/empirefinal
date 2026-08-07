/* ================================================
   O PRODUTOR DE HITS — game.js
   State Machine: START_SCREEN → LOADING → PLAYING → PAUSED → GAME_OVER → VICTORY
================================================ */

// ─── CONSTANTES ──────────────────────────────
// Backend Empire (Apps Script). Mesma URL usada pelo client em src/lib/api.ts.
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwxbkUndhZPtFvtK1uIFTkPNN-m6WeiFVMU3IDzuahsC0oQp8Ba2GLQFOAPkWv8eiA3/exec';

// Identificação do jogador e do artista que está apostando — vindos via query string
// (a rota React /games/hits-producer injeta ?tg=...&artist=... antes de abrir o iframe).
const URL_PARAMS = new URLSearchParams(window.location.search);
const TELEGRAM_ID = (URL_PARAMS.get('tg') || 'guest').trim();
const ARTIST_NAME = (URL_PARAMS.get('artist') || '').trim();
const GAME_ID = 'produtor-de-hits';
const GAME_DURATION = 60;       // segundos até VICTORY
const LANE_COUNT = 4;
const NOTE_SPEED_BASE = 250;    // px/s
const BPM_INTERVAL = 20;        // segundos entre aumento de BPM
const NOTE_SPAWN_INTERVAL = 500; // ms entre spawns
const HIT_ZONE_HEIGHT = 80;     // px do fundo até hit zone center
const PERFECT_WINDOW = 15;      // px
const GOOD_WINDOW = 40;         // px
const MAX_LIVES = 3;
const HYPE_START = 50;
const HYPE_HIT_PERFECT = 8;
const HYPE_HIT_GOOD = 3;
const HYPE_MISS = 12;

const LANE_COLORS = ['#c84bff', '#4bf0ff', '#ff4b96', '#4bb4ff'];
const NOTE_COLORS = ['#e070ff', '#70f0ff', '#ff70b0', '#70c8ff'];

// ─── ESTADO GLOBAL ───────────────────────────
let STATE = 'START_SCREEN'; // estados possíveis: START_SCREEN, LOADING, PLAYING, PAUSED, GAME_OVER, VICTORY
let selectedWager = 0;
let score = 0;
let combo = 0;
let maxCombo = 0;
let lives = MAX_LIVES;
let hype = HYPE_START;
let notes = [];
let particles = [];
let feedbackTexts = [];
let gameTimer = 0;
let lastTime = 0;
let spawnTimer = 0;
let bpmTimer = 0;
let currentSpeed = NOTE_SPEED_BASE;
let animId = null;
let totalNotes = 0;
let hitNotes = 0;
let lanePressed = [false, false, false, false];

// ─── CANVAS & CTX ────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let W, H, laneW, hitZoneY;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  laneW = W / LANE_COUNT;
  hitZoneY = H - HIT_ZONE_HEIGHT;
}
window.addEventListener('resize', resize);
resize();

// ─── UTILS ───────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

// ─── UI HELPERS ──────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  if (id) document.getElementById(id).classList.add('active');
}
function showHUD(show) {
  document.getElementById('hud').classList.toggle('hidden', !show);
  document.getElementById('tap-buttons').classList.toggle('hidden', !show);
}
function updateHUD() {
  document.getElementById('hud-score-val').textContent = score;
  document.getElementById('hud-combo-val').textContent = `x${combo}`;
  const livesStr = '❤️'.repeat(lives) + '🖤'.repeat(MAX_LIVES - lives);
  document.getElementById('hud-lives-val').textContent = livesStr;
  const hypeBar = document.getElementById('hype-bar');
  hypeBar.style.width = clamp(hype, 0, 100) + '%';
  if (hype < 25) {
    hypeBar.style.background = 'linear-gradient(90deg, #ff4466, #ff8844)';
    hypeBar.style.boxShadow = '0 0 8px rgba(255,68,102,0.5)';
  } else if (hype < 50) {
    hypeBar.style.background = 'linear-gradient(90deg, #ffcc00, #ff8844)';
    hypeBar.style.boxShadow = '0 0 8px rgba(255,204,0,0.5)';
  } else {
    hypeBar.style.background = 'linear-gradient(90deg, #44ffaa, #4bf0ff)';
    hypeBar.style.boxShadow = '0 0 8px rgba(68,255,170,0.5)';
  }
}

// ─── NOTE CLASS ──────────────────────────────
class Note {
  constructor(lane) {
    this.lane = lane;
    this.x = lane * laneW + laneW / 2;
    this.y = -20;
    this.radius = Math.min(laneW * 0.28, 24);
    this.speed = currentSpeed;
    this.alive = true;
    this.hit = false;
  }
  update(dt) {
    this.y += this.speed * dt;
    // Se passou da hit zone sem ser acertada
    if (this.y > hitZoneY + GOOD_WINDOW * 2 && !this.hit) {
      this.alive = false;
      handleMiss(this.lane);
    }
    if (this.y > H + 30) this.alive = false;
  }
  draw() {
    if (!this.alive) return;
    const col = NOTE_COLORS[this.lane];
    // Glow externo
    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = col;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    // Inner highlight
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(this.x - this.radius * 0.25, this.y - this.radius * 0.25, this.radius * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
    // Nota musical (♪)
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.font = `bold ${this.radius}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♪', this.x, this.y);
    ctx.restore();
  }
}

// ─── PARTICLE CLASS ──────────────────────────
class Particle {
  constructor(x, y, color) {
    this.x = x; this.y = y;
    this.color = color;
    this.vx = rand(-120, 120);
    this.vy = rand(-160, -40);
    this.life = 1.0;
    this.decay = rand(1.5, 2.5);
    this.size = rand(3, 7);
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 200 * dt; // gravidade
    this.life -= this.decay * dt;
  }
  draw() {
    if (this.life <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 6;
    ctx.shadowColor = this.color;
    ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
    ctx.restore();
  }
}

// ─── FEEDBACK TEXT CLASS ─────────────────────
class FeedbackText {
  constructor(x, y, text, color) {
    this.x = x; this.y = y;
    this.text = text; this.color = color;
    this.life = 1.0;
    this.vy = -60;
  }
  update(dt) {
    this.y += this.vy * dt;
    this.life -= 2.2 * dt;
  }
  draw() {
    if (this.life <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 12;
    ctx.shadowColor = this.color;
    ctx.font = `bold 22px "Cabinet Grotesk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}

// ─── SPAWN NOTE ──────────────────────────────
function spawnNote() {
  const lane = randInt(0, LANE_COUNT - 1);
  notes.push(new Note(lane));
  totalNotes++;
}

// ─── BURST PARTICLES ─────────────────────────
function spawnBurst(x, y, color, count = 12) {
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(x, y, color));
  }
}

// ─── HIT DETECTION ───────────────────────────
/*
 * Quando o jogador pressiona uma lane:
 * 1. Encontramos a nota mais baixa (maior Y) naquela lane que ainda está ativa
 * 2. Calculamos dist = |nota.y - hitZoneY| (distância ao centro da hit zone)
 * 3. Se dist < PERFECT_WINDOW (15px) → PERFECT
 * 4. Se dist < GOOD_WINDOW (40px)    → GOOD
 * 5. Caso contrário                  → pressão fora de contexto (sem nota próxima)
 */
function handleLanePress(lane) {
  if (STATE !== 'PLAYING') return;
  lanePressed[lane] = true;
  setTimeout(() => { lanePressed[lane] = false; }, 120);

  // 1. Acha a nota mais próxima da hit zone nessa lane
  let closest = null;
  let closestDist = Infinity;
  for (const note of notes) {
    if (!note.alive || note.hit || note.lane !== lane) continue;
    const dist = Math.abs(note.y - hitZoneY);
    if (dist < closestDist) {
      closestDist = dist;
      closest = note;
    }
  }

  // 2. Sem nota próxima → pressão prematura (penalidade leve)
  if (!closest || closestDist > GOOD_WINDOW * 2) return;

  // 3. Avalia precisão
  const nx = closest.x;
  const ny = closest.y;
  closest.hit = true;
  closest.alive = false;
  hitNotes++;

  if (closestDist < PERFECT_WINDOW) {
    // PERFECT
    score += 20 * (1 + combo * 0.05);
    combo++;
    hype = clamp(hype + HYPE_HIT_PERFECT, 0, 100);
    spawnBurst(nx, ny, NOTE_COLORS[lane], 16);
    feedbackTexts.push(new FeedbackText(nx, hitZoneY - 30, 'PERFECT!', '#ffcc00'));
  } else {
    // GOOD
    score += 10;
    combo++;
    hype = clamp(hype + HYPE_HIT_GOOD, 0, 100);
    spawnBurst(nx, ny, NOTE_COLORS[lane], 6);
    feedbackTexts.push(new FeedbackText(nx, hitZoneY - 30, 'GOOD', '#44ffaa'));
  }
  if (combo > maxCombo) maxCombo = combo;
  score = Math.floor(score);
  updateHUD();
}

function handleMiss(lane) {
  combo = 0;
  hype = clamp(hype - HYPE_MISS, 0, 100);
  lives--;
  const cx = lane * laneW + laneW / 2;
  feedbackTexts.push(new FeedbackText(cx, hitZoneY - 30, 'MISS', '#ff4466'));
  updateHUD();
  if (hype <= 0 || lives <= 0) {
    triggerGameOver();
  }
}

// ─── DRAW BACKGROUND ─────────────────────────
function drawBackground() {
  // Fundo escuro com gradiente
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#08080f');
  grad.addColorStop(1, '#100820');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Lanes
  for (let i = 0; i < LANE_COUNT; i++) {
    const x = i * laneW;
    // Lane background
    ctx.fillStyle = LANE_COLORS[i].replace(')', ', 0.08)').replace('rgba', 'rgba');
    ctx.fillStyle = `rgba(${hexToRgb(NOTE_COLORS[i])}, 0.06)`;
    ctx.fillRect(x, 0, laneW, H);
    // Divisor entre lanes
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    // Glow nas bordas da lane (pressed)
    if (lanePressed[i]) {
      ctx.fillStyle = `rgba(${hexToRgb(NOTE_COLORS[i])}, 0.15)`;
      ctx.fillRect(x, 0, laneW, H);
    }
  }

  // Hit zone line
  ctx.save();
  ctx.shadowBlur = 16;
  ctx.shadowColor = 'rgba(255,255,255,0.3)';
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, hitZoneY);
  ctx.lineTo(W, hitZoneY);
  ctx.stroke();
  ctx.restore();

  // Receptores (circles na hit zone)
  for (let i = 0; i < LANE_COUNT; i++) {
    const cx = i * laneW + laneW / 2;
    const col = NOTE_COLORS[i];
    const pressed = lanePressed[i];
    ctx.save();
    ctx.shadowBlur = pressed ? 30 : 14;
    ctx.shadowColor = col;
    ctx.beginPath();
    ctx.arc(cx, hitZoneY, pressed ? 28 : 24, 0, Math.PI * 2);
    ctx.strokeStyle = col;
    ctx.lineWidth = pressed ? 3 : 2;
    ctx.stroke();
    ctx.fillStyle = `rgba(${hexToRgb(col)}, ${pressed ? 0.25 : 0.1})`;
    ctx.fill();
    ctx.restore();
  }
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

// ─── DRAW TIMER ──────────────────────────────
function drawTimer() {
  const remaining = Math.max(0, GAME_DURATION - gameTimer);
  ctx.save();
  ctx.font = `700 16px "Satoshi", sans-serif`;
  ctx.fillStyle = remaining < 10 ? '#ff4466' : 'rgba(255,255,255,0.4)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${Math.ceil(remaining)}s`, W / 2, 80);
  ctx.restore();
}

// ─── GAME LOOP ───────────────────────────────
function gameLoop(timestamp) {
  if (STATE !== 'PLAYING') return;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap 50ms
  lastTime = timestamp;

  gameTimer += dt;
  spawnTimer += dt * 1000;
  bpmTimer += dt;

  // Aumenta velocidade a cada BPM_INTERVAL segundos
  if (bpmTimer >= BPM_INTERVAL) {
    bpmTimer = 0;
    currentSpeed += 30;
  }

  // Spawn de nota
  if (spawnTimer >= NOTE_SPAWN_INTERVAL) {
    spawnTimer = 0;
    spawnNote();
  }

  // Atualizar notas
  notes = notes.filter(n => n.alive);
  for (const note of notes) note.update(dt);

  // Atualizar partículas
  particles = particles.filter(p => p.life > 0);
  for (const p of particles) p.update(dt);

  // Atualizar feedbacks
  feedbackTexts = feedbackTexts.filter(f => f.life > 0);
  for (const f of feedbackTexts) f.update(dt);

  // Draw
  drawBackground();
  for (const note of notes) note.draw();
  for (const p of particles) p.draw();
  for (const f of feedbackTexts) f.draw();
  drawTimer();

  // Fim do tempo → VICTORY
  if (gameTimer >= GAME_DURATION) {
    triggerVictory();
    return;
  }

  animId = requestAnimationFrame(gameLoop);
}

// ─── ECONOMY (Apps Script `sync_game_coins`) ─
// O backend espera: { acao, telegram_id, wager, won, gameContext, artistName }
// e retorna { ok: true, novoSaldo } ou { ok: false, erro }.
// Não enviamos Content-Type para evitar preflight CORS contra o Apps Script
// (o doPost faz JSON.parse(e.postData.contents) — funciona com text/plain).
async function callEmpire(payload) {
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (!res.ok) return { ok: false, erro: 'HTTP ' + res.status };
    const txt = await res.text();
    try { return JSON.parse(txt); } catch (_) { return { ok: false, erro: 'Resposta inválida' }; }
  } catch (e) {
    return { ok: false, erro: e.message || 'Falha de rede' };
  }
}

async function syncEmpireCoins(telegramId, wagerAmount, wonAmount) {
  const r = await callEmpire({
    acao: 'sync_game_coins',
    telegram_id: telegramId,
    wager: wagerAmount,
    won: wonAmount,
    gameContext: 'O Produtor de Hits',
    artistName: ARTIST_NAME
  });
  return r && r.ok === true;
}

// Debita a aposta antes de iniciar a sessão. Bloqueia o jogo se faltar saldo.
async function transactEmpireCoins(wager, action) {
  if (!ARTIST_NAME) {
    alert('Nenhum artista selecionado. Volte ao menu e escolha um artista para apostar.');
    return false;
  }
  if (action !== 'deduct') return true;
  const ok = await syncEmpireCoins(TELEGRAM_ID, wager, 0);
  if (!ok) {
    alert('Não foi possível debitar a aposta. Saldo insuficiente ou falha de rede.');
  }
  return ok;
}

// ─── STATE TRANSITIONS ───────────────────────
async function startGame() {
  if (!selectedWager) {
    alert('Selecione uma aposta antes de jogar!');
    return;
  }
  STATE = 'LOADING';
  showScreen('screen-loading');
  showHUD(false);

  const ok = await transactEmpireCoins(selectedWager, 'deduct');
  if (!ok) {
    STATE = 'START_SCREEN';
    showScreen('screen-start');
    return;
  }

  // Reset estado do jogo
  notes = []; particles = []; feedbackTexts = [];
  score = 0; combo = 0; maxCombo = 0;
  lives = MAX_LIVES; hype = HYPE_START;
  gameTimer = 0; spawnTimer = 0; bpmTimer = 0;
  currentSpeed = NOTE_SPEED_BASE;
  totalNotes = 0; hitNotes = 0;
  lanePressed = [false, false, false, false];

  updateHUD();
  STATE = 'PLAYING';
  showScreen(null);
  showHUD(true);

  lastTime = performance.now();
  animId = requestAnimationFrame(gameLoop);
}

function pauseGame() {
  if (STATE !== 'PLAYING') return;
  STATE = 'PAUSED';
  if (animId) cancelAnimationFrame(animId);
  showScreen('screen-paused');
}

function resumeGame() {
  if (STATE !== 'PAUSED') return;
  STATE = 'PLAYING';
  showScreen(null);
  lastTime = performance.now();
  animId = requestAnimationFrame(gameLoop);
}

async function triggerGameOver() {
  STATE = 'GAME_OVER';
  if (animId) cancelAnimationFrame(animId);
  showHUD(false);
  showScreen('screen-gameover');

  document.getElementById('go-wager-lost').textContent = `Aposta perdida: ${selectedWager} 🪙`;
  document.getElementById('go-score').textContent = `Pontuação: ${score} | Combo máx: x${maxCombo}`;

  // A aposta já foi debitada no startGame — não chamamos sync de novo aqui.
  // Apenas garantimos uma micro-pausa para a UI assentar e liberamos o botão.
  const savingEl = document.getElementById('go-saving');
  const retryBtn = document.getElementById('btn-retry');
  savingEl.classList.remove('hidden');
  retryBtn.disabled = true;
  await new Promise(r => setTimeout(r, 250));
  savingEl.classList.add('hidden');
  retryBtn.disabled = false;
}

async function triggerVictory() {
  STATE = 'VICTORY';
  if (animId) cancelAnimationFrame(animId);
  showHUD(false);
  showScreen('screen-victory');

  const accuracy = totalNotes > 0 ? hitNotes / totalNotes : 0;
  const comboMultiplier = 1 + (maxCombo / 100);
  const prize = Math.floor(selectedWager * accuracy * comboMultiplier);

  document.getElementById('vic-prize').textContent = `+${prize} 🪙`;
  document.getElementById('vic-score').textContent = `Score: ${score} | Precisão: ${Math.round(accuracy * 100)}%`;

  const savingEl = document.getElementById('vic-saving');
  const playBtn = document.getElementById('btn-play-again');
  savingEl.classList.remove('hidden');
  playBtn.disabled = true;

  // Crédita só o prêmio (a aposta original ficou retida quando começamos).
  await syncEmpireCoins(TELEGRAM_ID, 0, prize);

  savingEl.classList.add('hidden');
  playBtn.disabled = false;
}

function goToMenu() {
  STATE = 'START_SCREEN';
  if (animId) cancelAnimationFrame(animId);
  notes = []; particles = []; feedbackTexts = [];
  selectedWager = 0;
  document.querySelectorAll('.btn-wager').forEach(b => b.classList.remove('selected'));
  showHUD(false);
  showScreen('screen-start');
  // Limpa canvas
  ctx.clearRect(0, 0, W, H);
  drawBackground();
}

// ─── INPUT BINDINGS ──────────────────────────
// Teclado D F J K
const KEY_MAP = { 'd': 0, 'f': 1, 'j': 2, 'k': 3 };
document.addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  if (key in KEY_MAP) handleLanePress(KEY_MAP[key]);
  if (key === 'escape') {
    if (STATE === 'PLAYING') pauseGame();
    else if (STATE === 'PAUSED') resumeGame();
  }
});

// Touch nas tap-buttons
document.querySelectorAll('.tap-btn').forEach(btn => {
  btn.addEventListener('touchstart', e => {
    e.preventDefault();
    handleLanePress(parseInt(btn.dataset.lane));
  }, { passive: false });
  btn.addEventListener('mousedown', e => {
    handleLanePress(parseInt(btn.dataset.lane));
  });
});

// Wager buttons (anti-double-click)
document.querySelectorAll('.btn-wager').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedWager = parseInt(btn.dataset.amount);
    document.querySelectorAll('.btn-wager').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});

// Botão iniciar (após selecionar wager, clicando em btn-wager já selecionado = start)
// Criamos um botão de start separado dentro do screen-start
const startBtn = document.createElement('button');
startBtn.className = 'btn-primary';
startBtn.id = 'btn-start';
startBtn.textContent = '▶ JOGAR';
startBtn.style.marginTop = '8px';
let startClicked = false;
startBtn.addEventListener('click', () => {
  if (startClicked) return; // anti-double-click
  startClicked = true;
  setTimeout(() => { startClicked = false; }, 1500);
  startGame();
});
document.querySelector('#screen-start .screen-inner').appendChild(startBtn);

document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-retry').addEventListener('click', () => { goToMenu(); });
document.getElementById('btn-menu-go').addEventListener('click', goToMenu);
document.getElementById('btn-play-again').addEventListener('click', () => { goToMenu(); });
document.getElementById('btn-menu-vic').addEventListener('click', goToMenu);

// Pausar quando o app perde foco
document.addEventListener('visibilitychange', () => {
  if (document.hidden && STATE === 'PLAYING') pauseGame();
});

// ─── INIT ─────────────────────────────────────
showScreen('screen-start');
drawBackground();
