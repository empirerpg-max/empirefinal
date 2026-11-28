// Conferência no navegador da vitrine /beta-pecas (fundações do Beta, fase 0).
// Ver docs/beta-fundacoes.md, seção "Testes". Não é teste do `bun test`
// (extensão .mjs, sem ".test." no nome): roda à mão, com o app de pé.
//
// Uso:
//   1. bun run build
//   2. bunx wrangler dev -c dist/tanstack_start_app/wrangler.json --local --port 8799
//      (em outro terminal / em segundo plano)
//   3. node scripts/navegador/beta-pecas.mjs
//      (opcional: BASE=http://localhost:8799  FOTOS=pasta-para-screenshots)
//   4. pare o wrangler/workerd no fim.
//
// Precisa do Playwright com Chromium (local ou global, `npm i -g playwright`).
// Toda chamada /api/ é respondida com {} e qualquer host fora do localhost é
// bloqueado: nada sai para a internet nem grava nada.
// Admin de teste = tipoPerfil "Admin" com id qualquer (o id antigo só existe
// em src/components/LoginScreen.tsx).

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

async function carregarPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const global = execSync('npm root -g').toString().trim();
    return createRequire(join(global, 'noop.js'))('playwright');
  }
}
const { chromium } = await carregarPlaywright();
const BASE = process.env.BASE || 'http://localhost:8799';
const FOTOS = process.env.FOTOS || '';
const results = [];
const rec = (name, ok, ev) => { results.push({ name, ok, ev }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(ev)); };
const b = await chromium.launch();
async function novaPagina(width, admin = true) {
  const ctx = await b.newContext({ viewport: { width, height: 844 } });
  if (admin) await ctx.addInitScript(() => { try { localStorage.setItem('empire_login_user', JSON.stringify({id:'admin-teste',usuario:'Admin',tipoPerfil:'Admin'})); localStorage.setItem('empire_session_token', JSON.stringify('x')); } catch {} }); // about:blank não tem localStorage
  const p = await ctx.newPage();
  await p.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname !== 'localhost') return r.abort(); if (u.pathname.startsWith('/api/')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); return r.continue(); });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  return p;
}
const row = '[role=group][aria-label="Pílulas de teste"]';
const estado = (p) => p.evaluate((row) => {
  const el = document.querySelector(row); const r = el.getBoundingClientRect();
  const sel = [...el.querySelectorAll('[data-scroll-item]')].find(c => c.getAttribute('data-scroll-item') === 'Pílula 9');
  const s = sel.querySelector('button').getBoundingClientRect();
  return { sl: el.scrollLeft, max: el.scrollWidth - el.clientWidth, rowL: r.left, rowR: r.right, rowT: r.top, rowB: r.bottom, selL: s.left, selR: s.right,
    esq: !!document.querySelector('[aria-label="Rolar para a esquerda"]'), dir: !!document.querySelector('[aria-label="Rolar para a direita"]'),
    inicios: [...el.querySelectorAll('[data-scroll-item]')].map(c => Math.max(c.offsetLeft - 56, 0)) };
}, row);
const hist = (p) => p.evaluate(() => ({ len: history.length, state: JSON.stringify(history.state), path: location.pathname, folhas: document.querySelectorAll('[role=dialog]').length }));
async function abrir(p) { await p.goto(BASE + '/beta-pecas'); await p.waitForSelector(row); await p.waitForTimeout(700); }

for (const w of [320, 390, 1300]) {
  let p = await novaPagina(w);
  await abrir(p);
  let e = await estado(p);
  const visivel = (e) => e.selL >= e.rowL + (e.esq ? 56 : 0) - 0.5 && e.selR <= e.rowR - (e.dir ? 56 : 0) + 0.5;
  rec(`${w}: selecionado inteiro ao abrir`, visivel(e), { selL: e.selL, selR: e.selR, rowL: e.rowL, rowR: e.rowR, esq: e.esq, dir: e.dir });
  // pontas
  await p.evaluate((row) => { document.querySelector(row).scrollLeft = 0; }, row); await p.waitForTimeout(200);
  e = await estado(p); rec(`${w}: no começo só seta direita`, !e.esq && e.dir, { esq: e.esq, dir: e.dir });
  // clique seta direita para no começo de item
  await p.click('[aria-label="Rolar para a direita"]'); await p.waitForTimeout(900);
  e = await estado(p); rec(`${w}: seta direita para no começo de item`, e.sl > 0 && (e.inicios.some(i => Math.abs(i - e.sl) <= 1) || Math.abs(e.sl - e.max) <= 1), { sl: e.sl, inicios: e.inicios, max: e.max });
  await p.click('[aria-label="Rolar para a esquerda"]'); await p.waitForTimeout(900);
  e = await estado(p); rec(`${w}: seta esquerda para no começo de item`, e.inicios.some(i => Math.abs(i - e.sl) <= 1), { sl: e.sl });
  await p.evaluate((row) => { const el = document.querySelector(row); el.scrollLeft = el.scrollWidth; }, row); await p.waitForTimeout(200);
  e = await estado(p); rec(`${w}: no fim só seta esquerda`, e.esq && !e.dir, { esq: e.esq, dir: e.dir });
  // teclado
  await p.focus(`${row} [data-scroll-item="Pílula 1"] button`); await p.keyboard.press('ArrowRight');
  let foco = await p.evaluate(() => document.activeElement?.textContent);
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowLeft');
  const foco2 = await p.evaluate(() => document.activeElement?.textContent);
  await p.keyboard.press('End'); await p.waitForTimeout(600);
  const foco3 = await p.evaluate(() => document.activeElement?.textContent);
  rec(`${w}: ←/→/End movem o foco`, foco === 'Pílula 2' && foco2 === 'Pílula 2' && foco3 === 'Pílula 10', { foco, foco2, foco3 });
  // sem texto cortado
  const cort = await p.evaluate((row) => [...document.querySelectorAll(`${row} button`)].filter(b => b.scrollWidth > b.clientWidth + 0.5).map(b => b.textContent), row);
  rec(`${w}: nenhum texto cortado`, cort.length === 0, { cort });
  // área de toque da seta
  await p.evaluate((row) => { document.querySelector(row).scrollLeft = 0; }, row); await p.waitForTimeout(200);
  const toque = await p.evaluate((row) => {
    const r = document.querySelector(row).getBoundingClientRect();
    const btn = document.querySelector('[aria-label="Rolar para a direita"]').getBoundingClientRect();
    const sob = document.elementFromPoint(btn.left + btn.width / 2, btn.bottom - 1);
    return { rowH: r.height, btnT: btn.top, btnB: btn.bottom, rowT: r.top, rowB: r.bottom, foraCima: Math.max(0, r.top - btn.top), foraBaixo: Math.max(0, btn.bottom - r.bottom), sobBordaBaixo: sob?.getAttribute('aria-label') || sob?.tagName };
  }, row);
  rec(`${w}: área de toque 44px da seta (transbordo)`, toque.foraCima <= 4 && toque.foraBaixo <= 4, toque);
  // fonte chegando depois: itens alargam depois de montar
  await abrir(p);
  await p.addStyleTag({ content: `${row} button { letter-spacing: 0.25em; font-size: 15px; }` }); await p.waitForTimeout(900);
  e = await estado(p); rec(`${w}: selecionado inteiro após itens alargarem (fonte tardia)`, visivel(e), { selL: e.selL, selR: e.selR, rowL: e.rowL, rowR: e.rowR, esq: e.esq, dir: e.dir });

  // histórico (página nova por cenário: histórico = [about:blank, /beta-pecas])
  await p.context().close();
  p = await novaPagina(w); await abrir(p);
  let h0 = await hist(p), h1, h2, h3;
  await p.click('[data-testid=botao-menu]'); await p.waitForSelector('[role=dialog]');
  h1 = await hist(p);
  await p.goBack(); await p.waitForTimeout(600);
  h2 = await hist(p);
  rec(`${w}: ⋯ e voltar fecha só a folha`, h1.len === h0.len + 1 && h2.folhas === 0 && h2.path === '/beta-pecas', { h0, h1, h2 });
  // cancelar não deixa entrada
  await p.context().close(); p = await novaPagina(w); await abrir(p); h0 = await hist(p);
  await p.click('[data-testid=botao-menu]'); await p.waitForSelector('[role=dialog]');
  await p.click('text=Cancelar'); await p.waitForTimeout(700);
  h1 = await hist(p);
  const focoMenu = await p.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  await p.goBack(); await p.waitForTimeout(600); h2 = await hist(p);
  rec(`${w}: Cancelar sem entrada sobrando + foco volta ao ⋯`, h1.folhas === 0 && h2.path !== '/beta-pecas' && focoMenu === 'botao-menu', { h0, h1, focoMenu, h2 });
  // outra folha
  await p.context().close(); p = await novaPagina(w); await abrir(p); h0 = await hist(p);
  await p.click('[data-testid=botao-menu]'); await p.waitForSelector('[role=dialog]');
  await p.click('text=Abrir outra folha'); await p.waitForTimeout(700);
  h1 = await hist(p);
  const temFolha = await p.$('[data-testid=folha-simples]');
  const focoTroca = await p.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  rec(`${w}: folha aberta por troca fica com o foco (não o ⋯ atrás)`, focoTroca === 'Outra folha', { focoTroca });
  await p.goBack(); await p.waitForTimeout(600); h2 = await hist(p);
  const folhaSumiu = !(await p.$('[data-testid=folha-simples]'));
  await p.goBack(); await p.waitForTimeout(600); h3 = await hist(p);
  rec(`${w}: outra folha = 1 entrada; voltar fecha, voltar sai`, !!temFolha && h1.len === h0.len + 1 && h1.folhas === 1 && folhaSumiu && h2.path === '/beta-pecas' && h3.path !== '/beta-pecas', { h0, h1, h2, h3 });
  // X da outra folha
  await p.context().close(); p = await novaPagina(w); await abrir(p); h0 = await hist(p);
  await p.click('[data-testid=botao-menu]'); await p.waitForSelector('[role=dialog]');
  await p.click('text=Abrir outra folha'); await p.waitForTimeout(500);
  await p.click('[aria-label=Fechar]'); await p.waitForTimeout(700); h1 = await hist(p);
  await p.goBack(); await p.waitForTimeout(600); h2 = await hist(p);
  rec(`${w}: X da outra folha sem entrada sobrando`, h1.folhas === 0 && h2.path !== '/beta-pecas', { h0, h1, h2 });
  // navega
  await p.context().close(); p = await novaPagina(w); await abrir(p); h0 = await hist(p);
  await p.click('[data-testid=botao-menu]'); await p.waitForSelector('[role=dialog]');
  await p.click('text=Ir para o Perfil'); await p.waitForURL('**/perfil', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(800);
  h1 = await hist(p);
  await p.goBack(); await p.waitForTimeout(800); h2 = await hist(p);
  await p.goBack(); await p.waitForTimeout(800); h3 = await hist(p);
  rec(`${w}: Ir para o Perfil; 1 voltar volta à vitrine sem folha; sem voltar morto`, h1.path === '/perfil' && h2.path === '/beta-pecas' && h2.folhas === 0 && h3.path !== '/beta-pecas', { h0, h1, h2, h3 });
  // Esc
  await p.context().close(); p = await novaPagina(w); await abrir(p); h0 = await hist(p);
  await p.click('[data-testid=botao-menu]'); await p.waitForSelector('[role=dialog]');
  await p.keyboard.press('Escape'); await p.waitForTimeout(700); h1 = await hist(p);
  const focoEsc = await p.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  await p.goBack(); await p.waitForTimeout(600); h2 = await hist(p);
  rec(`${w}: Esc fecha, foco volta ao ⋯, sem entrada sobrando`, h1.folhas === 0 && focoEsc === 'botao-menu' && h2.path !== '/beta-pecas', { h1, focoEsc, h2 });


  // --- camadas EMPILHADAS: ⋯ por cima da "Outra folha" (entrada própria) ---
  const abrirEmpilhado = async () => {
    await p.click('[data-testid=botao-menu]'); await p.waitForSelector('[role=dialog]');
    await p.click('text=Abrir outra folha'); await p.waitForSelector('[data-testid=folha-simples]'); await p.waitForTimeout(400);
    await p.click('[data-testid=botao-menu-folha]'); await p.waitForSelector('[role=dialog][aria-label="Opções da folha"]'); await p.waitForTimeout(400);
  };
  const temMenuDeCima = () => p.$('[role=dialog][aria-label="Opções da folha"]').then(Boolean);
  const haFolha = () => p.$('[data-testid=folha-simples]').then(Boolean);
  // (1) voltar fecha só o de cima, depois a folha, depois sai da página
  await p.context().close(); p = await novaPagina(w); await abrir(p); h0 = await hist(p);
  await abrirEmpilhado();
  h1 = await hist(p);
  const focoFolha = await p.evaluate(() => document.activeElement?.closest('[role=dialog]')?.getAttribute('aria-label'));
  await p.goBack(); await p.waitForTimeout(700); h2 = await hist(p);
  const e2 = { menu: await temMenuDeCima(), folha: await haFolha(), foco: await p.evaluate(() => document.activeElement?.getAttribute('data-testid')) };
  await p.goBack(); await p.waitForTimeout(700); h3 = await hist(p);
  const e3 = { menu: await temMenuDeCima(), folha: await haFolha() };
  await p.goBack(); await p.waitForTimeout(700); const h4 = await hist(p);
  rec(`${w}: empilhado — voltar fecha só o ⋯, depois a folha, depois sai`,
    h1.len === h0.len + 2 && h1.folhas === 2 && focoFolha === 'Opções da folha' &&
    !e2.menu && e2.folha && e2.foco === 'botao-menu-folha' && h2.path === '/beta-pecas' &&
    !e3.menu && !e3.folha && h3.path === '/beta-pecas' && h4.path !== '/beta-pecas',
    { h0, h1, focoFolha, h2, e2, h3, e3, h4 });
  // (2) com os dois abertos, X da folha de baixo fecha os dois sem sobrar entrada
  await p.context().close(); p = await novaPagina(w); await abrir(p); h0 = await hist(p);
  await abrirEmpilhado();
  // o fundo do ⋯ cobre o X: clique programático (simula quem hospeda fechar a de baixo)
  await p.evaluate(() => document.querySelector('[data-testid=folha-simples] [aria-label=Fechar]').click());
  await p.waitForTimeout(900); h1 = await hist(p);
  const x1 = { menu: await temMenuDeCima(), folha: await haFolha() };
  await p.goBack(); await p.waitForTimeout(700); h2 = await hist(p);
  rec(`${w}: empilhado — X da folha de baixo fecha os dois, 1 voltar sai`,
    !x1.menu && !x1.folha && h1.folhas === 0 && h1.path === '/beta-pecas' && h1.len === h0.len + 2 && h2.path !== '/beta-pecas',
    { h0, h1, x1, h2 });
  // (3) ação navega no ⋯ de cima: /perfil; 1 voltar volta à vitrine sem nada aberto; mais 1 sai
  await p.context().close(); p = await novaPagina(w); await abrir(p); h0 = await hist(p);
  await abrirEmpilhado();
  await p.click('[role=dialog][aria-label="Opções da folha"] >> text=Ir para o Perfil');
  await p.waitForURL('**/perfil', { timeout: 6000 }).catch(() => {}); await p.waitForTimeout(800); h1 = await hist(p);
  await p.goBack(); await p.waitForTimeout(800); h2 = await hist(p);
  const n2 = { menu: await temMenuDeCima(), folha: await haFolha() };
  await p.goBack(); await p.waitForTimeout(800); h3 = await hist(p);
  rec(`${w}: empilhado — navega no ⋯ de cima; 1 voltar volta à vitrine sem nada aberto`,
    h1.path === '/perfil' && h2.path === '/beta-pecas' && h2.folhas === 0 && !n2.menu && !n2.folha && h3.path !== '/beta-pecas',
    { h0, h1, h2, n2, h3 });

  if (FOTOS && w !== 320) {
    await abrir(p);
    await p.screenshot({ path: `${FOTOS}/beta-pecas-${w}.png`, fullPage: true });
    await p.click('[data-testid=botao-menu]'); await p.waitForTimeout(500);
    await p.screenshot({ path: `${FOTOS}/beta-pecas-${w}-menu.png` });
    await p.click('text=Abrir outra folha'); await p.waitForTimeout(500);
    await p.screenshot({ path: `${FOTOS}/beta-pecas-${w}-outra-folha.png` });
  }
  await p.context().close();
}
// não admin
{
  const p = await novaPagina(390, false);
  await p.goto(BASE + '/beta-pecas'); await p.waitForTimeout(2000);
  const txt = await p.textContent('body');
  rec('sem login: tela de login, vitrine não aparece', txt.includes('Entre com seu usuário e senha') && !txt.includes('Peças do Beta'), {});
  await p.context().close();
}
{
  const p = await novaPagina(390, false);
  await p.context().addInitScript(() => { try { localStorage.setItem('empire_login_user', JSON.stringify({id:'123',usuario:'Fulano',tipoPerfil:'Jogador'})); localStorage.setItem('empire_session_token', JSON.stringify('x')); } catch {} });
  await p.goto(BASE + '/beta-pecas'); await p.waitForTimeout(2000);
  const txt = await p.textContent('body');
  rec('jogador comum vê "Página não encontrada."', txt.includes('Página não encontrada.') && !txt.includes('Peças do Beta'), {});
  await p.context().close();
}
await b.close();
const ok = results.filter(r => r.ok).length;
console.log(`\n${ok}/${results.length} pass`);
process.exit(ok === results.length ? 0 : 1);
