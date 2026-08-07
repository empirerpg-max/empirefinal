/* ================================================
   FUGA DO PAPARAZZI — Subway Surfers Edition
   3 pistas + pulo + esquiva, projeção 3/4 em Canvas 2D
   State: MENU → LOADING → RUNNING → CASHOUT_LOADING → DEAD/SUCCESS
================================================ */

const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwxbkUndhZPtFvtK1uIFTkPNN-m6WeiFVMU3IDzuahsC0oQp8Ba2GLQFOAPkWv8eiA3/exec';

const URL_PARAMS = new URLSearchParams(window.location.search);
const TELEGRAM_ID = (URL_PARAMS.get('tg') || 'guest').trim();
const ARTIST_NAME = (URL_PARAMS.get('artist') || '').trim();

// ─── CONSTANTES ──────────────────────────────
const ENTRY_FEE     = 50;
const COIN_VALUE    = 5;

const LANE_COUNT    = 3;
const LANE_OFFSET   = 0.18;   // distância das pistas laterais ao centro (em fração da largura)
const HORIZON_RATIO = 0.32;   // y do horizonte (% da altura)
const FLOOR_RATIO   = 0.92;   // y do plano do player (% da altura)

const PERSPECTIVE_K = 0.55;   // intensidade da perspectiva (1/(1+z*k))
const Z_SPAWN       = 9;      // profundidade onde objetos surgem
const Z_DESPAWN     = -0.6;   // profundidade onde somem (atrás do player)

const SPEED_BASE    = 6.5;    // unidades de Z por segundo
const SPEED_GROWTH  = 0.05;   // aceleração por segundo
const SPEED_MAX     = 16;

const GRAVITY       = 38;     // aceleração vertical (em "unidades" do mundo)
const JUMP_VY       = -14;
const SLIDE_MS      = 520;
const LANE_LERP     = 14;     // velocidade de transição lateral

const SPAWN_INTERVAL_BASE = 0.95; // segundos entre spawns
const SPAWN_INTERVAL_MIN  = 0.45;

// ─── STATE ───────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
let W = 0, H = 0, HORIZON_Y = 0, FLOOR_Y = 0, ROAD_HALF = 0;
let PX = 4; // tamanho do "pixel" lógico (escala dos sprites)

// Desenha um retângulo "pixel" arredondado pro grid de PX
function px(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
// Desenha sprite a partir de matriz de chars + paleta. Cada char = 1 "pixel" de tamanho `s`.
function drawSprite(map, palette, x, y, s) {
  for (let row = 0; row < map.length; row++) {
    const line = map[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      const c = palette[ch];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x + col * s), Math.round(y + row * s), Math.ceil(s), Math.ceil(s));
    }
  }
}

let STATE = 'MENU';
let player = {
  lane: 1, laneVisual: 1,
  y: 0, vy: 0, onGround: true,
  slideUntil: 0,
};
let obstacles = []; // {z, lane, type:'BARRICADE'|'DRONE'|'BLOCK'}
let coins = [];     // {z, lane, y}
let particles = [];
let flashAlpha = 0;
let speed = SPEED_BASE;
let distance = 0, sessionCoins = 0;
let spawnAcc = 0, spawnInterval = SPAWN_INTERVAL_BASE;
let lastTime = 0, animId = null;
let playClicked = false, cashoutClicked = false;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  HORIZON_Y = H * HORIZON_RATIO;
  FLOOR_Y = H * FLOOR_RATIO;
  ROAD_HALF = W * 0.45;
}
window.addEventListener('resize', () => { resize(); ctx.imageSmoothingEnabled = false; initBackground(); });
resize();

// ─── PROJEÇÃO 3/4 ───────────────────────────
// Cada objeto tem coordenadas no "mundo": lane (-1..1), y (altura mundo), z (profundidade).
// Convertemos pra tela via fator de perspectiva.
function project(laneX, worldY, z) {
  const f = 1 / (1 + Math.max(0, z) * PERSPECTIVE_K);
  const screenX = W / 2 + laneX * ROAD_HALF * f;
  const screenY = HORIZON_Y + (FLOOR_Y - HORIZON_Y) * f - worldY * f * (FLOOR_Y - HORIZON_Y) * 0.05;
  return { x: screenX, y: screenY, scale: f };
}

function laneToX(lane) {
  // lane 0=esquerda, 1=centro, 2=direita → -1 / 0 / +1
  return (lane - 1) * (LANE_OFFSET / 0.18);
}

// ─── PARALLAX FUNDO PIXEL ART ───────────────
// 3 camadas de prédios chunky com janelas em grid (estilo pixel)
const buildingsFar  = [];
const buildingsMid  = [];
const buildingsNear = [];
const stars = [];
function buildLayer(arr, count, minH, maxH, palette) {
  arr.length = 0;
  let x = -50;
  while (x < W * 1.4) {
    const w = 28 + Math.floor(Math.random() * 56);
    const h = minH + Math.floor(Math.random() * (maxH - minH));
    const c = palette[Math.floor(Math.random() * palette.length)];
    const win = Math.random() < 0.85;
    arr.push({ x, w, h, c, win, hue: Math.floor(Math.random() * 60) });
    x += w + 2 + Math.floor(Math.random() * 6);
  }
}
function initBackground() {
  buildLayer(buildingsFar,  16, 50,  100, ['#1a1238', '#221a44', '#2a1a4e']);
  buildLayer(buildingsMid,  14, 80,  170, ['#2a1450', '#3a1860', '#481a72']);
  buildLayer(buildingsNear, 10, 120, 230, ['#10081e', '#180a26', '#220c34']);
  stars.length = 0;
  for (let i = 0; i < 60; i++) stars.push({ x: Math.random() * W, y: Math.random() * HORIZON_Y * 0.85, b: Math.random() < 0.3 });
}

function scrollLayer(arr, dx) {
  for (const b of arr) {
    b.x -= dx;
    if (b.x + b.w < -20) {
      const last = arr.reduce((m, o) => Math.max(m, o.x + o.w), 0);
      b.x = last + 2 + Math.floor(Math.random() * 6);
    }
  }
}
function drawLayer(arr, windowColor, windowSize) {
  for (const b of arr) {
    px(b.x, HORIZON_Y - b.h, b.w, b.h, b.c);
    // topo (antena/caixa d'água) chance
    if (b.w > 36 && Math.random() < 0.0001) {} // estático: desenha só se sorteado na criação? simples:
    // janelas em grid
    if (b.win) {
      const step = windowSize * 2;
      for (let wy = HORIZON_Y - b.h + 6; wy < HORIZON_Y - 6; wy += step) {
        for (let wx = b.x + 4; wx < b.x + b.w - 4; wx += step) {
          // padrão pseudo-aleatório estável usando coords
          if (((wx * 31 + wy * 17 + b.hue) >> 1) % 5 < 2) {
            px(wx, wy, windowSize, windowSize, windowColor);
          }
        }
      }
    }
  }
}

function drawBackground(dt) {
  // Céu pixel (3 faixas)
  px(0, 0,                     W, HORIZON_Y * 0.45, '#08051a');
  px(0, HORIZON_Y * 0.45,      W, HORIZON_Y * 0.30, '#140a30');
  px(0, HORIZON_Y * 0.75,      W, HORIZON_Y * 0.25, '#2a0e4a');

  // Estrelas
  for (const s of stars) {
    px(s.x, s.y, s.b ? 2 : 1, s.b ? 2 : 1, s.b ? '#ffeeff' : '#aaaadd');
  }

  // Lua pixel
  px(W - 80, 36, 24, 24, '#ffe9b8');
  px(W - 76, 32, 16, 4,  '#ffe9b8');
  px(W - 80, 56, 24, 4,  '#ffe9b8');

  // 3 camadas de prédios (parallax)
  scrollLayer(buildingsFar,  speed * 0.6 * dt * 8);
  drawLayer(buildingsFar, '#ffaa55', 2);

  scrollLayer(buildingsMid,  speed * 1.4 * dt * 8);
  drawLayer(buildingsMid, '#ffcc66', 3);

  scrollLayer(buildingsNear, speed * 2.4 * dt * 8);
  drawLayer(buildingsNear, '#ff66cc', 3);

  // Letreiros neon flutuando (pixel)
  px(60, HORIZON_Y - 60, 10, 18, '#ff4baa');
  px(72, HORIZON_Y - 56, 6, 14,  '#4bf0ff');
  px(W - 160, HORIZON_Y - 90, 14, 22, '#ffcc00');
}

// ─── CHÃO PIXEL (asfalto + zebra) ───────────
let roadOffset = 0;
function drawRoad(dt) {
  roadOffset = (roadOffset + speed * dt * 0.5) % 1;

  // Calçada (faixa antes do horizonte)
  px(0, HORIZON_Y, W, 6, '#3a1a55');
  px(0, HORIZON_Y + 6, W, 2, '#ff4baa');

  // Asfalto: faixas horizontais alternadas pra dar textura "pixel"
  const groundH = H - HORIZON_Y - 8;
  const stripeH = 6;
  for (let y = 0; y < groundH; y += stripeH * 2) {
    px(0, HORIZON_Y + 8 + y,           W, stripeH, '#0a0618');
    px(0, HORIZON_Y + 8 + y + stripeH, W, stripeH, '#08040f');
  }

  // Bordas neon laterais (raias da rua) em perspectiva — chunky
  for (const lx of [-1.5, 1.5]) {
    let prev = project(lx, 0, Z_SPAWN);
    for (let i = 1; i <= 16; i++) {
      const z = Z_SPAWN * (1 - i / 16);
      const cur = project(lx, 0, z);
      ctx.fillStyle = '#ff4baa';
      ctx.fillRect(Math.round(cur.x) - 2, Math.round(cur.y), 4, 4);
      prev = cur;
    }
  }

  // Zebra das pistas (pixels grossos cada vez maiores)
  for (let i = 0; i < 14; i++) {
    const z = ((i + roadOffset) / 14) * Z_SPAWN;
    for (const lx of [-0.5, 0.5]) {
      const p = project(lx, 0, z);
      const sz = 3 + (1 / (1 + z)) * 14;
      px(p.x - sz / 2, p.y - sz / 2, sz, sz, '#4bf0ff');
    }
  }

  // Linha do horizonte com glow simulado por 3 px stacks
  px(0, HORIZON_Y - 2, W, 1, 'rgba(75,240,255,0.25)');
  px(0, HORIZON_Y - 1, W, 1, 'rgba(75,240,255,0.55)');
  px(0, HORIZON_Y,     W, 1, '#4bf0ff');
}

// ─── PAPARAZZI PURSUER (atrás do player) ────
// Sprite pixel do paparazzi com câmera grande
const PAPARAZZI_SPRITE = [
  '..bbbbb..',
  '.b00000b.',
  'bccccccccb',
  'b0c000c0b',
  '.b00000b.',
  'ssbbbbbss',
  's0sbbb s0s',
  '..bb.bb..',
  '..bb.bb..',
];
const PAPARAZZI_PALETTE = {
  '0': '#1a1a2a',  // preto roupa
  'b': '#0a0a14',  // contorno
  'c': '#444',     // câmera
  's': '#ff4baa',  // luz/colete
};
let pursuerFlash = 0;
function drawPaparazzi(dt) {
  // Posição: canto inferior-esquerdo, com leve oscilação
  const t = performance.now() / 200;
  const baseS = Math.max(4, Math.floor(Math.min(W, H) * 0.012));
  const sx = 24 + Math.sin(t) * 4;
  const sy = FLOOR_Y - PAPARAZZI_SPRITE.length * baseS - 8 + Math.cos(t * 0.7) * 3;

  // Sombra
  px(sx + 4, FLOOR_Y - 4, PAPARAZZI_SPRITE[0].length * baseS - 6, 4, 'rgba(0,0,0,0.55)');
  drawSprite(PAPARAZZI_SPRITE, PAPARAZZI_PALETTE, sx, sy, baseS);

  // Flash de câmera aleatório
  pursuerFlash -= dt;
  if (pursuerFlash <= 0 && Math.random() < 0.012) pursuerFlash = 0.12;
  if (pursuerFlash > 0) {
    const fx = sx + 2 * baseS;
    const fy = sy + 2 * baseS;
    px(fx - baseS, fy - baseS, baseS * 4, baseS * 4, 'rgba(255,255,255,0.85)');
    flashAlpha = Math.max(flashAlpha, 0.10);
  }
}

// ─── PLAYER ──────────────────────────────────
// Sprites pixel do artista (correndo / pulando / deslizando)
const ART_RUN_A = [
  '...kkkk...',
  '..kffffk..',
  '..kf..fk..',  // óculos escuros
  '..kbbbbk..',
  '..ffffff..',  // pele
  '.pppppppp.',  // jaqueta
  '.pyyyyyypp',
  '.pyyyyyypp',
  '..bbbbbb..',  // cinto
  '..jj..jj..',  // calça
  '..jj..jj..',
  '..jj..jj..',
  '..ss..ss..',  // tênis (correndo: pés desencontrados)
];
const ART_RUN_B = [
  '...kkkk...',
  '..kffffk..',
  '..kf..fk..',
  '..kbbbbk..',
  '..ffffff..',
  '.pppppppp.',
  '.pyyyyyypp',
  '.pyyyyyypp',
  '..bbbbbb..',
  '..jj..jj..',
  '..jj..jj..',
  '..jj..jj..',
  '...ssss...',
];
const ART_JUMP = [
  '...kkkk...',
  '..kffffk..',
  '..kf..fk..',
  '..kbbbbk..',
  '..ffffff..',
  '.pyypppyp.',  // braços abertos
  'ppyyyyyypp',
  '.pyyyyyyp.',
  '..bbbbbb..',
  '..jjjjjj..',
  '...jjjj...',
  '..ss..ss..',
];
const ART_SLIDE = [
  '...........',
  '...........',
  '...........',
  '...........',
  '..kkkk.....',
  '.kffffkpppp',
  '.kf..fpppppp',
  '.kbbbbpyyypp',
  '..ffbbbbbbbp',
  '..jjjjjjjjj.',
  '..ssssssss..',
];
const ART_PALETTE = {
  'k': '#1a0820',  // contorno
  'b': '#0a0410',
  'f': '#ffd5b8',  // pele
  'p': '#ff4baa',  // jaqueta neon (rosa)
  'y': '#4bf0ff',  // detalhe ciano
  'j': '#22154a',  // calça
  's': '#ffcc00',  // tênis
};

// ─── PLAYER ──────────────────────────────────
function drawPlayer() {
  const laneX = laneToX(player.laneVisual);
  const p = project(laneX, player.y, 0);
  const baseSize = Math.min(W, H) * 0.07;
  const sliding = isSliding();
  const inAir = !player.onGround;

  const sprite = sliding ? ART_SLIDE : (inAir ? ART_JUMP : (Math.floor(performance.now() / 90) % 2 ? ART_RUN_A : ART_RUN_B));
  const cols = sprite[0].length;
  const rows = sprite.length;
  const scale = Math.max(3, Math.floor(baseSize / 6));
  const sw = cols * scale;
  const sh = rows * scale;

  // Sombra
  px(p.x - sw * 0.45, FLOOR_Y + 2, sw * 0.9, 4, 'rgba(0,0,0,0.5)');

  // Glow neon (4 px stacks pra simular aura sem blur)
  ctx.globalAlpha = 0.35;
  for (const off of [[-2,0],[2,0],[0,-2],[0,2]]) {
    drawSprite(sprite, { 'p': '#ff4baa', 'y': '#4bf0ff' }, p.x - sw / 2 + off[0], p.y - sh + off[1], scale);
  }
  ctx.globalAlpha = 1;

  // Sprite principal
  drawSprite(sprite, ART_PALETTE, p.x - sw / 2, p.y - sh, scale);
}

// ─── OBSTÁCULOS / MOEDAS ─────────────────────
function spawn() {
  // Padrões: às vezes 2 obstáculos numa linha, deixando 1 pista livre
  const r = Math.random();
  if (r < 0.55) {
    const lane = Math.floor(Math.random() * LANE_COUNT);
    obstacles.push(makeObstacle(lane, randomType()));
  } else if (r < 0.85) {
    // dois obstáculos, uma pista livre
    const free = Math.floor(Math.random() * LANE_COUNT);
    for (let l = 0; l < LANE_COUNT; l++) {
      if (l === free) continue;
      obstacles.push(makeObstacle(l, randomType()));
    }
  } else {
    // linha cheia de barricada (precisa pular tudo)
    for (let l = 0; l < LANE_COUNT; l++) obstacles.push(makeObstacle(l, 'BARRICADE'));
  }

  // Linha de moedas com 35% de chance
  if (Math.random() < 0.7) {
    const coinLane = Math.floor(Math.random() * LANE_COUNT);
    const arc = Math.random() < 0.4; // arco em cima de barricada
    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const z = Z_SPAWN - 0.5 - i * 0.55;
      const y = arc ? Math.sin((i / (count - 1)) * Math.PI) * 6 : 0;
      coins.push({ lane: coinLane, z, y, alive: true });
    }
  }
}

function randomType() {
  const r = Math.random();
  if (r < 0.55) return 'BARRICADE'; // pular
  if (r < 0.85) return 'DRONE';     // esquivar
  return 'BLOCK';                   // trocar de pista
}

function makeObstacle(lane, type) {
  return { lane, z: Z_SPAWN, type };
}

// ─── SPRITES PIXEL DOS OBSTÁCULOS ───────────
const SPR_BARRICADE = [
  'rrrrrrrr',
  'rwwwwwwr',
  'rwrrrrwr',
  'rwrwwrwr',
  'rwrrrrwr',
  'rwwwwwwr',
  'rrrrrrrr',
  'kk....kk',
  'kk....kk',
];
const PAL_BARRICADE = { 'r': '#ff4baa', 'w': '#fff', 'k': '#1a0820' };

// Câmera gigante de paparazzi (drone) — precisa esquivar (slide)
const SPR_DRONE = [
  '...kkkkkk...',
  '..kggggggk..',
  '.kgwwwwwwgk.',
  'kgwccccccwgk',  // lente
  'kgwc rrr cwgk',
  'kgwccccccwgk',
  '.kgwwwwwwgk.',
  '..kggggggk..',
  '...kk..kk...',
];
const PAL_DRONE = { 'k': '#0a0414', 'g': '#444', 'w': '#888', 'c': '#1a1a2a', 'r': '#ff4baa', ' ': null };

// Holofote/painel (BLOCK) — precisa trocar de pista
const SPR_BLOCK = [
  'yyyyyyyyy',
  'ykrrrrrky',
  'ykrwwwrky',
  'ykrwwwrky',
  'ykrrrrrky',
  'yyyyyyyyy',
  '..yyyyy..',
  '..yyyyy..',
  '..yyyyy..',
  '..yyyyy..',
  '.kkkkkkk.',
];
const PAL_BLOCK = { 'y': '#ffcc00', 'k': '#1a0820', 'r': '#ff4466', 'w': '#fff' };

// Moeda (E$C) pixel art em frames pra rotação
const COIN_FRAMES = [
  [
    '.kkkkk.',
    'kyyyyyk',
    'kywwyyk',
    'kyyyyyk',
    'kyyyyyk',
    'kyyyyyk',
    '.kkkkk.',
  ],
  [
    '..kkk..',
    '.kyyyk.',
    '.kywyk.',
    '.kyyyk.',
    '.kyyyk.',
    '.kyyyk.',
    '..kkk..',
  ],
  [
    '...k...',
    '...k...',
    '...k...',
    '...k...',
    '...k...',
    '...k...',
    '...k...',
  ],
  [
    '..kkk..',
    '.koook.',
    '.koook.',
    '.koook.',
    '.koook.',
    '.koook.',
    '..kkk..',
  ],
];
const PAL_COIN = { 'k': '#7a5500', 'y': '#ffcc00', 'w': '#fff5b8', 'o': '#cc8800' };

function drawSpritePerspective(sprite, palette, laneX, worldY, z, baseScale) {
  const p = project(laneX, worldY, z);
  const cols = sprite[0].length;
  const rows = sprite.length;
  const s = Math.max(1, baseScale * p.scale);
  const sw = cols * s;
  const sh = rows * s;
  drawSprite(sprite, palette, p.x - sw / 2, p.y - sh, s);
  return p;
}

function drawObstacle(o) {
  const laneX = laneToX(o.lane);
  if (o.type === 'BARRICADE') {
    drawSpritePerspective(SPR_BARRICADE, PAL_BARRICADE, laneX, 0, o.z, 10);
  } else if (o.type === 'DRONE') {
    drawSpritePerspective(SPR_DRONE, PAL_DRONE, laneX, 12, o.z, 9);
    if (o.z < 1.2 && o.z > 0.6 && !o._flashed) {
      o._flashed = true;
      flashAlpha = Math.max(flashAlpha, 0.3);
    }
  } else { // BLOCK (holofote alto, troca de pista)
    drawSpritePerspective(SPR_BLOCK, PAL_BLOCK, laneX, 0, o.z, 11);
  }
}

function drawCoin(c) {
  const laneX = laneToX(c.lane);
  // Frame de rotação baseado em tempo + posição (cada moeda gira)
  const frameIdx = Math.floor((performance.now() / 90 + c.z * 2) % 4);
  drawSpritePerspective(COIN_FRAMES[frameIdx], PAL_COIN, laneX, c.y + 4, c.z, 4);
}

// Ordena por z desc para desenhar do mais longe ao mais perto
function drawWorldObjects() {
  const all = [];
  for (const o of obstacles) all.push({ kind: 'O', z: o.z, ref: o });
  for (const c of coins) if (c.alive) all.push({ kind: 'C', z: c.z, ref: c });
  all.sort((a, b) => b.z - a.z);
  for (const item of all) {
    if (item.kind === 'O') drawObstacle(item.ref);
    else drawCoin(item.ref);
  }
}

// ─── INPUT ──────────────────────────────────
function moveLane(dir) {
  if (STATE !== 'RUNNING') return;
  player.lane = Math.max(0, Math.min(LANE_COUNT - 1, player.lane + dir));
}
function jump() {
  if (STATE !== 'RUNNING') return;
  if (!player.onGround) return;
  player.vy = JUMP_VY;
  player.onGround = false;
}
function slide() {
  if (STATE !== 'RUNNING') return;
  player.slideUntil = performance.now() + SLIDE_MS;
  // Se estiver no ar, aborta o pulo (cai mais rápido)
  if (!player.onGround) player.vy = Math.max(player.vy, 8);
}
function isSliding() {
  return performance.now() < player.slideUntil && player.onGround;
}

document.addEventListener('keydown', e => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); moveLane(-1); }
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); moveLane(1); }
  else if (e.code === 'ArrowUp' || e.code === 'Space' || e.code === 'KeyW') { e.preventDefault(); jump(); }
  else if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); slide(); }
});

let touchStart = null;
const SWIPE_THRESHOLD = 28;
canvas.addEventListener('touchstart', e => {
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
}, { passive: true });
canvas.addEventListener('touchend', e => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (Math.max(adx, ady) < SWIPE_THRESHOLD) {
    // tap = pulo (mais intuitivo no mobile)
    jump();
  } else if (adx > ady) {
    moveLane(dx > 0 ? 1 : -1);
  } else {
    if (dy < 0) jump(); else slide();
  }
  touchStart = null;
}, { passive: true });

// ─── PARTICLES ───────────────────────────────
class Particle {
  constructor(x, y, color) {
    this.x = x; this.y = y; this.color = color;
    this.vx = (Math.random() - 0.5) * 200;
    this.vy = Math.random() * -160 - 40;
    this.life = 1; this.decay = 2 + Math.random();
    this.size = 3 + Math.random() * 4;
  }
  update(dt) { this.x += this.vx * dt; this.y += this.vy * dt; this.vy += 380 * dt; this.life -= this.decay * dt; }
  draw() {
    if (this.life <= 0) return;
    ctx.save(); ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.size, this.size);
    ctx.restore();
  }
}

// ─── COLLISIONS ──────────────────────────────
// player ocupa z ~ 0; consideramos colisão quando obstáculo cruza [-0.4, 0.4]
function checkCollisions() {
  const sliding = isSliding();
  const inAir   = !player.onGround;
  for (const o of obstacles) {
    if (o.lane !== player.lane) continue;
    if (o.z > 0.45 || o.z < -0.4) continue;
    if (o.type === 'BARRICADE') {
      // bate se NÃO estiver pulando
      if (!inAir) return true;
    } else if (o.type === 'DRONE') {
      // bate se NÃO estiver deslizando
      if (!sliding) return true;
    } else { // BLOCK
      // sempre bate (precisa trocar de pista)
      return true;
    }
  }
  return false;
}

function checkCoins() {
  for (const c of coins) {
    if (!c.alive) continue;
    if (c.lane !== player.lane) continue;
    if (c.z > 0.45 || c.z < -0.4) continue;
    // moeda em arco: se altura do player + jump compensa pouco
    c.alive = false;
    sessionCoins += COIN_VALUE;
    const laneX = laneToX(c.lane);
    const p = project(laneX, c.y + 6, c.z);
    for (let i = 0; i < 10; i++) particles.push(new Particle(p.x, p.y, '#ffcc00'));
    updateHUD();
  }
}

// ─── HUD ─────────────────────────────────────
function updateHUD() {
  document.getElementById('hud-coins').textContent = `${sessionCoins} 🪙`;
  document.getElementById('hud-dist').textContent = `${Math.floor(distance)}m`;
}

// ─── LOOP ────────────────────────────────────
function update(dt) {
  // Velocidade global
  speed = Math.min(SPEED_MAX, speed + SPEED_GROWTH * dt);
  distance += speed * dt * 1.6;

  // Player vertical
  player.vy += GRAVITY * dt;
  player.y -= player.vy * dt;
  if (player.y <= 0) { player.y = 0; player.vy = 0; player.onGround = true; }

  // Lane visual interpola
  player.laneVisual += (player.lane - player.laneVisual) * Math.min(1, LANE_LERP * dt);

  // Mundo
  for (const o of obstacles) o.z -= speed * dt;
  for (const c of coins)     c.z -= speed * dt;
  obstacles = obstacles.filter(o => o.z > Z_DESPAWN);
  coins     = coins.filter(c => c.z > Z_DESPAWN && c.alive);

  // Spawn
  spawnInterval = Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_BASE - distance * 0.0005);
  spawnAcc += dt;
  if (spawnAcc >= spawnInterval) { spawnAcc = 0; spawn(); }

  // Partículas
  particles = particles.filter(p => p.life > 0);
  for (const p of particles) p.update(dt);

  // Colisão
  if (checkCollisions()) { triggerDead(); return false; }
  checkCoins();

  return true;
}

function draw(dt) {
  drawBackground(dt);
  drawRoad(dt);
  drawWorldObjects();
  drawPlayer();
  drawPaparazzi(dt);
  for (const p of particles) p.draw();

  // Flash branco (câmeras / drones)
  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
    ctx.fillRect(0, 0, W, H);
    flashAlpha = Math.max(0, flashAlpha - 2.5 * dt);
  }
}

function gameLoop(ts) {
  if (STATE !== 'RUNNING') return;
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;

  const alive = update(dt);
  if (!alive) return;
  draw(dt);
  updateHUD();
  animId = requestAnimationFrame(gameLoop);
}

// ─── ECONOMIA ────────────────────────────────
async function callEmpire(payload) {
  try {
    const res = await fetch(WEBHOOK_URL, { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) return { ok: false, erro: 'HTTP ' + res.status };
    const txt = await res.text();
    try { return JSON.parse(txt); } catch (_) { return { ok: false, erro: 'Resposta inválida' }; }
  } catch (e) { return { ok: false, erro: e.message || 'Falha de rede' }; }
}

async function syncEmpireCoins(telegramId, wagerAmount, wonAmount) {
  const r = await callEmpire({
    acao: 'sync_game_coins',
    telegram_id: telegramId,
    wager: wagerAmount,
    won: wonAmount,
    gameContext: 'Fuga do Paparazzi',
    artistName: ARTIST_NAME,
  });
  return r && r.ok === true;
}

async function deductEntry() {
  if (!ARTIST_NAME) {
    alert('Nenhum artista selecionado. Volte ao menu e escolha um artista.');
    return false;
  }
  const ok = await syncEmpireCoins(TELEGRAM_ID, ENTRY_FEE, 0);
  if (!ok) alert('Não foi possível debitar a entrada. Saldo insuficiente ou falha de rede.');
  return ok;
}

// ─── TRANSIÇÕES ──────────────────────────────
async function startGame() {
  if (playClicked) return;
  playClicked = true;
  STATE = 'LOADING';
  showScreen('screen-loading');

  const ok = await deductEntry();
  if (!ok) { STATE = 'MENU'; showScreen('screen-menu'); playClicked = false; return; }

  // Reset
  player = { lane: 1, laneVisual: 1, y: 0, vy: 0, onGround: true, slideUntil: 0 };
  obstacles = []; coins = []; particles = [];
  speed = SPEED_BASE; distance = 0; sessionCoins = 0;
  spawnAcc = 0; spawnInterval = SPAWN_INTERVAL_BASE;
  flashAlpha = 0;
  cashoutClicked = false;
  initBackground();
  updateHUD();

  STATE = 'RUNNING';
  showScreen(null);
  document.getElementById('hud').classList.remove('hidden');

  lastTime = performance.now();
  animId = requestAnimationFrame(gameLoop);
}

async function triggerCashout() {
  if (STATE !== 'RUNNING' || cashoutClicked) return;
  cashoutClicked = true;
  STATE = 'CASHOUT_LOADING';
  if (animId) cancelAnimationFrame(animId);
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('cashout-amount').textContent = `+${sessionCoins} 🪙`;
  showScreen('screen-cashout');

  await syncEmpireCoins(TELEGRAM_ID, 0, sessionCoins);

  showScreen('screen-success');
  document.getElementById('success-prize').textContent = `+${sessionCoins} 🪙`;
  document.getElementById('success-dist').textContent = `Distância: ${Math.floor(distance)}m`;
  document.getElementById('success-saving').classList.add('hidden');
  document.getElementById('btn-play-again').disabled = false;
}

async function triggerDead() {
  STATE = 'DEAD';
  if (animId) cancelAnimationFrame(animId);
  document.getElementById('hud').classList.add('hidden');
  flashAlpha = 0.95;
  ctx.fillStyle = `rgba(255,255,255,0.95)`;
  ctx.fillRect(0, 0, W, H);

  showScreen('screen-dead');
  document.getElementById('dead-coins').textContent = `Perdeu: ${ENTRY_FEE} 🪙 + ${sessionCoins} 🪙 coletadas`;
  document.getElementById('dead-saving').classList.add('hidden');
  document.getElementById('btn-retry').disabled = false;
}

function goToMenu() {
  STATE = 'MENU';
  playClicked = false;
  cashoutClicked = false;
  if (animId) cancelAnimationFrame(animId);
  document.getElementById('hud').classList.add('hidden');
  obstacles = []; coins = []; particles = [];
  ctx.clearRect(0, 0, W, H);
  showScreen('screen-menu');
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  if (id) document.getElementById(id)?.classList.add('active');
}

document.getElementById('btn-play').addEventListener('click', startGame);
document.getElementById('btn-cashout').addEventListener('click', triggerCashout);
document.getElementById('btn-retry').addEventListener('click', goToMenu);
document.getElementById('btn-menu-dead').addEventListener('click', goToMenu);
document.getElementById('btn-play-again').addEventListener('click', goToMenu);
document.getElementById('btn-menu-suc').addEventListener('click', goToMenu);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && STATE === 'RUNNING' && animId) cancelAnimationFrame(animId);
});

// Init
showScreen('screen-menu');
initBackground();
drawBackground(0);
drawRoad(0);
