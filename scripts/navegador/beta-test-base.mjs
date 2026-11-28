// Conferência no navegador das telas do Beta test (faixa na versão anterior,
// selo BETA, folhas de reportar e de voltar). Padrão de beta-pecas.mjs.
//
// Uso:
//   1. bun run build
//   2. bunx wrangler dev -c dist/tanstack_start_app/wrangler.json --local --port 8799
//   3. node scripts/navegador/beta-test-base.mjs
//      (opcional: BASE=http://localhost:8799  FOTOS=pasta-para-screenshots)
//
// /api/beta/* é interceptado (estado, escolha, reporte); o resto de /api/ responde {}
// e qualquer host fora do localhost é bloqueado: nada sai para a internet.

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

async function carregarPlaywright() {
  try { return await import('playwright'); }
  catch { const g = execSync('npm root -g').toString().trim(); return createRequire(join(g, 'noop.js'))('playwright'); }
}
const { chromium } = await carregarPlaywright();
const BASE = process.env.BASE || 'http://localhost:8799';
const FOTOS = process.env.FOTOS || '';
const results = [];
const rec = (name, ok, ev) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, ev === undefined ? '' : JSON.stringify(ev)); };
const b = await chromium.launch();

// estado: o que GET /api/beta/estado devolve; posts: corpos recebidos.
async function novaPagina(width, estado) {
  const ctx = await b.newContext({ viewport: { width, height: 700 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('empire_login_user', JSON.stringify({ id: 'jogador-teste', usuario: 'Jogador', tipoPerfil: 'Jogador' }));
      localStorage.setItem('empire_session_token', JSON.stringify('x'));
    } catch {}
  });
  const p = await ctx.newPage();
  p.posts = { escolha: [], reporte: [] };
  await p.route('**/*', (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.hostname !== 'localhost') return r.abort();
    const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/beta/estado') return json({ ok: true, ...estado });
    if (u.pathname === '/api/beta/escolha') { p.posts.escolha.push(req.postDataJSON()); return json({ ok: true, versao: req.postDataJSON().versao }); }
    if (u.pathname === '/api/beta/reporte') { p.posts.reporte.push(req.postDataJSON()); return json({ ok: true, id: 'R1' }); }
    if (u.pathname.startsWith('/api/')) return json({});
    return r.continue();
  });
  p.on('pageerror', (e) => console.log('PAGEERR', e.message));
  return p;
}
const ANTERIOR = { modo: 'todos', podeVer: true, podeVoltar: true, versao: 'anterior', boasVindasVistas: true };
const BETA = { ...ANTERIOR, versao: 'beta' };
const DESLIGADO = { modo: 'desligado', podeVer: false, podeVoltar: false, versao: 'anterior', boasVindasVistas: true };
const foto = (p, nome) => FOTOS ? p.screenshot({ path: join(FOTOS, nome) }) : null;
const semRolagemH = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth && (() => { const s = document.getElementById('app-scroll'); return !s || s.scrollWidth <= s.clientWidth; })());
const texto = (p) => p.evaluate(() => document.body.innerText);
const estadoHist = (p) => p.evaluate(() => ({ path: location.pathname, over: (history.state && history.state.__overlays) || null, dialogos: document.querySelectorAll('[role=dialog]').length }));
async function abrir(p) { await p.goto(BASE + '/'); await p.waitForTimeout(1500); }

// (a) desligado: nada aparece
for (const w of [320, 390]) {
  const p = await novaPagina(w, DESLIGADO); await abrir(p);
  const t = await texto(p);
  rec(`(a) ${w}px desligado: sem "Versão anterior" nem "BETA"`, !/Versão anterior/.test(t) && !/\bBETA\b/.test(t));
  rec(`(a) ${w}px sem rolagem horizontal`, await semRolagemH(p));
  if (w === 320) await foto(p, 'beta-a-desligado-320.png');
  await p.context().close();
}

// (b) faixa na anterior; trocar para o Beta sem recarregar
for (const w of [320, 390]) {
  const p = await novaPagina(w, ANTERIOR); await abrir(p);
  await p.evaluate(() => { window.__semRecarga = 1; });
  const navAntes = await p.evaluate(() => performance.getEntriesByType('navigation').length);
  const faixa = p.getByText('Versão anterior', { exact: true });
  rec(`(b) ${w}px faixa visível`, await faixa.isVisible());
  const bt = await p.getByRole('button', { name: 'Reportar', exact: true }).boundingBox();
  const bi = await p.getByRole('button', { name: 'Ir para o Beta test' }).boundingBox();
  rec(`(b) ${w}px os dois botões inteiros na tela`, !!bt && !!bi && bt.x >= 0 && bi.x + bi.width <= w, { bt, bi });
  rec(`(b) ${w}px sem rolagem horizontal`, await semRolagemH(p));
  const alt = await p.evaluate(() => { const el = [...document.querySelectorAll('div')].find(d => d.textContent === 'VersãoanteriorReportarIr para o Beta test' || (d.className.includes('z-[59]'))); return el && Math.round(el.getBoundingClientRect().height); });
  rec(`(b) ${w}px faixa com 32 px de altura`, alt === 32, { alt });
  const pad = await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('app-scroll')).paddingTop));
  rec(`(b) ${w}px paddingTop do conteúdo soma 32 (64+32)`, pad === 96, { pad });
  if (w === 320) await foto(p, 'beta-b-faixa-320.png');
  await p.getByRole('button', { name: 'Ir para o Beta test' }).click();
  await p.waitForTimeout(600);
  const t = await texto(p);
  rec(`(b) ${w}px selo BETA aparece e faixa some`, /\bBETA\b/.test(t) && !/Versão anterior/.test(t));
  rec(`(b) ${w}px sem recarregar`, (await p.evaluate(() => window.__semRecarga)) === 1 && (await p.evaluate(() => performance.getEntriesByType('navigation').length)) === navAntes);
  rec(`(b) ${w}px POST escolha beta`, p.posts.escolha.at(-1)?.versao === 'beta', p.posts.escolha);
  const pad2 = await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('app-scroll')).paddingTop));
  rec(`(b) ${w}px paddingTop volta a 64`, pad2 === 64, { pad2 });
  // selo e topo em 320: sem sobreposição
  const caixas = await p.evaluate(() => {
    const nav = document.querySelector('nav');
    const els = [...nav.querySelectorAll('a, button')].map(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, n: e.getAttribute('aria-label') || e.textContent }; }).filter(e => e.r > e.l).sort((a, b) => a.l - b.l);
    return els;
  });
  let sobrepoe = false; for (let i = 1; i < caixas.length; i++) if (caixas[i].l < caixas[i - 1].r - 0.5) sobrepoe = true;
  rec(`(b) ${w}px topo sem sobreposição e dentro da tela`, !sobrepoe && caixas.at(-1).r <= w && caixas[0].l >= 0, caixas);
  const selo = await p.getByRole('button', { name: /Beta test: abrir/ }).boundingBox();
  rec(`(b) ${w}px selo com alvo de 40 px`, selo.height >= 40 && selo.width >= 40, selo);
  rec(`(b) ${w}px sem rolagem horizontal com selo`, await semRolagemH(p));
  if (w === 320) await foto(p, 'beta-b-selo-320.png');
  await p.context().close();
}

// (c) selo -> FolhaBeta -> Reportar -> voltar fecha uma de cada vez
{
  const p = await novaPagina(320, BETA); await abrir(p);
  const inicio = await estadoHist(p);
  await p.getByRole('button', { name: /Beta test: abrir/ }).click(); await p.waitForTimeout(500);
  rec('(c) FolhaBeta abre com os itens', await p.getByText('Você está no Beta test').first().isVisible()
    && await p.getByText('Reportar um problema').isVisible() && await p.getByText('Como usar').isVisible() && await p.getByText('Voltar para a versão anterior').isVisible());
  await foto(p, 'beta-c-folhabeta-320.png');
  await p.getByRole('button', { name: 'Reportar um problema' }).click(); await p.waitForTimeout(500);
  rec('(c) Reportar abre por cima (2 folhas)', (await estadoHist(p)).dialogos === 2, await estadoHist(p));
  const enviar = p.getByRole('button', { name: 'Enviar' });
  rec('(c) Enviar desabilitado com texto vazio', await enviar.isDisabled());
  rec('(c) mostra "Tela: /" e interruptor ligado', await p.getByText(/^Tela: \//).isVisible() && (await p.getByRole('switch').getAttribute('aria-checked')) === 'true');
  await foto(p, 'beta-c-reportar-320.png');
  await p.goBack(); await p.waitForTimeout(600);
  let h = await estadoHist(p);
  rec('(c) voltar fecha só a Reportar', h.dialogos === 1 && !!(await p.getByText('Você está no Beta test').first().isVisible()) && h.path === '/', h);
  await p.goBack(); await p.waitForTimeout(600);
  h = await estadoHist(p);
  rec('(c) voltar de novo fecha a FolhaBeta; URL do começo e sem entrada órfã', h.dialogos === 0 && h.path === inicio.path && JSON.stringify(h.over) === JSON.stringify(inicio.over), { h, inicio });
  // envio do reporte
  await p.getByRole('button', { name: /Beta test: abrir/ }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Reportar um problema' }).click(); await p.waitForTimeout(400);
  await p.locator('textarea').fill('Teste de reporte');
  rec('(c) contador de caracteres', await p.getByText('16/2000').isVisible());
  await p.getByRole('button', { name: 'Enviar' }).click(); await p.waitForTimeout(800);
  const rp = p.posts.reporte.at(-1);
  rec('(c) POST do reporte com texto, tela, rota e dados técnicos', rp?.texto === 'Teste de reporte' && rp.rota === '/' && rp.versao === 'beta' && !!rp.tecnico, rp && { ...rp, tecnico: (rp.tecnico || '').slice(0, 40) });
  rec('(c) toast "Recebido! A moderação vai olhar."', await p.getByText('Recebido! A moderação vai olhar.').isVisible());
  h = await estadoHist(p);
  rec('(c) depois do envio só a FolhaBeta segue aberta', h.dialogos === 1, h);
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  h = await estadoHist(p);
  rec('(c) Esc fecha a FolhaBeta sem entrada órfã', h.dialogos === 0 && JSON.stringify(h.over) === JSON.stringify(inicio.over), h);
  // imagem grande demais (espera o toast, que fica no topo, sair)
  await p.waitForTimeout(4500);
  await p.getByRole('button', { name: /Beta test: abrir/ }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Reportar um problema' }).click(); await p.waitForTimeout(400);
  await p.locator('input[type=file]').setInputFiles({ name: 'g.png', mimeType: 'image/png', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) });
  rec('(c) print acima de 8 MB recusado', await p.getByText('A imagem passa de 8 MB.').isVisible());
  rec('(c) input aceita só imagem', (await p.locator('input[type=file]').getAttribute('accept')) === 'image/*');
  await p.context().close();
}

// (d) voltar para a anterior com motivo
{
  const p = await novaPagina(320, BETA); await abrir(p);
  await p.evaluate(() => { window.__semRecarga = 1; });
  const inicio = await estadoHist(p);
  await p.getByRole('button', { name: /Beta test: abrir/ }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Voltar para a versão anterior' }).click(); await p.waitForTimeout(600);
  let h = await estadoHist(p);
  rec('(d) FolhaVoltarVersao substitui a FolhaBeta (1 folha)', h.dialogos === 1 && await p.getByText('Voltar para a versão anterior?').isVisible(), h);
  rec('(d) tem os botões "Voltar agora" e "Ficar no Beta"', await p.getByRole('button', { name: 'Voltar agora' }).isVisible() && await p.getByRole('button', { name: 'Ficar no Beta' }).isVisible());
  await foto(p, 'beta-d-voltar-320.png');
  await p.getByRole('radio', { name: 'Ficou lento' }).click();
  await p.locator('textarea').fill('demora para abrir');
  await p.getByRole('button', { name: 'Voltar agora' }).click(); await p.waitForTimeout(900);
  const e = p.posts.escolha.at(-1);
  rec('(d) POST escolha anterior com motivo "lento" e texto', e?.versao === 'anterior' && e.motivo === 'lento' && e.texto === 'demora para abrir', e);
  const t = await texto(p);
  rec('(d) faixa aparece, selo some, sem recarregar', /Versão anterior/.test(t) && !/\bBETA\b/.test(t) && (await p.evaluate(() => window.__semRecarga)) === 1);
  rec('(d) toast "Pronto! Você está na versão anterior."', await p.getByText('Pronto! Você está na versão anterior.').isVisible());
  h = await estadoHist(p);
  rec('(d) sem folha aberta e sem entrada órfã', h.dialogos === 0 && JSON.stringify(h.over) === JSON.stringify(inicio.over), { h, inicio });
  await p.context().close();
  // "Ficar no Beta" fecha sem trocar
  const q = await novaPagina(320, BETA); await abrir(q);
  const i2 = await estadoHist(q);
  await q.getByRole('button', { name: /Beta test: abrir/ }).click(); await q.waitForTimeout(400);
  await q.getByRole('button', { name: 'Voltar para a versão anterior' }).click(); await q.waitForTimeout(500);
  await q.getByRole('button', { name: 'Ficar no Beta' }).click(); await q.waitForTimeout(600);
  const h2 = await estadoHist(q);
  rec('(d) "Ficar no Beta" fecha sem POST', h2.dialogos === 0 && q.posts.escolha.length === 0 && JSON.stringify(h2.over) === JSON.stringify(i2.over), h2);
  await q.context().close();
}

await b.close();
const falhas = results.filter((r) => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} ok`);
process.exit(falhas.length ? 1 : 0);
