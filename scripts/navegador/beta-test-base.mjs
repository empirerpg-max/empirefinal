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
async function novaPagina(width, estado, admin = false) {
  const ctx = await b.newContext({ viewport: { width, height: 700 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((adm) => {
    try {
      localStorage.setItem('empire_login_user', JSON.stringify(adm ? { id: 'admin-teste', usuario: 'Admin', tipoPerfil: 'Admin' } : { id: 'jogador-teste', usuario: 'Jogador', tipoPerfil: 'Jogador' }));
      localStorage.setItem('empire_session_token', JSON.stringify('x'));
    } catch {}
  }, admin);
  const p = await ctx.newPage();
  p.posts = { escolha: [], reporte: [], status: [], config: [] };
  p.reportesGet = [];
  await p.route('**/*', (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.hostname !== 'localhost') return r.abort();
    const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/beta/estado') return json({ ok: true, ...estado });
    if (u.pathname === '/api/beta/escolha') { p.posts.escolha.push(req.postDataJSON()); return json({ ok: true, versao: req.postDataJSON().versao }); }
    if (u.pathname === '/api/beta/reporte') { p.posts.reporte.push(req.postDataJSON()); return json({ ok: true, id: 'R1' }); }
    if (u.pathname === '/api/beta/reportes') {
      p.reportesGet.push(u.search);
      const st = u.searchParams.get('status'); const antes = u.searchParams.get('antesDe');
      const mk = (n, o = {}) => ({ id: 'R' + n, jogadorId: 'j' + n, usuario: 'ana' + n, versao: 'beta', tela: '/album/$id', rota: '/album/$id', texto: 'Reporte ' + n, motivo: null, printUrl: null, tecnico: null, status: 'novo', criadoEm: 1764000000000 - n * 60000, ...o });
      if (antes) return json({ ok: true, reportes: [mk(21)] });
      if (!st) return json({ ok: true, reportes: Array.from({ length: 20 }, (_, i) => mk(i + 1)) });
      if (st !== 'novo') return json({ ok: true, reportes: [] });
      return json({ ok: true, reportes: [
        mk(1, { texto: 'Texto bem longo. '.repeat(40), motivo: 'quebrou', printUrl: PNG, tecnico: JSON.stringify({ ua: 'x'.repeat(300), tela: 'a'.repeat(200) }) }),
        mk(2),
      ] });
    }
    if (u.pathname === '/api/beta/reporte/status') { p.posts.status.push(req.postDataJSON()); return json({ ok: true }); }
    if (u.pathname === '/api/beta/config') {
      if (req.method() === 'POST') { p.posts.config.push(req.postDataJSON()); p.cfg = req.postDataJSON(); }
      return json({ ok: true, config: p.cfg || { modo: 'desligado', convidados: [] } });
    }
    if (u.pathname.startsWith('/api/')) return json({});
    return r.continue();
  });
  p.on('pageerror', (e) => console.log('PAGEERR', e.message));
  return p;
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
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
  rec('(c) mostra "Tela: Início" e interruptor ligado', await p.getByText('Tela: Início', { exact: true }).isVisible() && (await p.getByRole('switch').getAttribute('aria-checked')) === 'true');
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
  rec('(c) POST do reporte com texto, tela, rota e dados técnicos', rp?.texto === 'Teste de reporte' && rp.tela === '/' && rp.rota === '/' && rp.versao === 'beta' && !!rp.tecnico, rp && { ...rp, tecnico: (rp.tecnico || '').slice(0, 40) });
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

// (c2) rota com parâmetro: a tela é o routeId, nunca o valor do caminho
{
  const p = await novaPagina(390, BETA);
  await p.goto(BASE + '/album/SegredoXYZ99?aba=SegredoAba77'); await p.waitForTimeout(1500);
  await p.getByRole('button', { name: /Beta test: abrir/ }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Reportar um problema' }).click(); await p.waitForTimeout(400);
  const linha = await p.getByText(/^Tela: /).textContent();
  rec('(c2) linha "Tela:" mostra o routeId, sem o valor do caminho', linha === 'Tela: /album/$id' && !/Segredo/.test(linha), linha);
  await p.locator('textarea').fill('x');
  await p.getByRole('button', { name: 'Enviar' }).click(); await p.waitForTimeout(800);
  const rp = p.posts.reporte.at(-1);
  rec('(c2) POST leva o routeId em tela e sem valor de aba cru', rp?.tela === '/album/$id' && !/Segredo/.test(rp.tela), rp && { tela: rp.tela, rota: rp.rota });
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

// (e) tela do admin /beta-admin
{
  // jogador comum
  const p = await novaPagina(320, BETA);
  await p.goto(BASE + '/beta-admin'); await p.waitForTimeout(1500);
  rec('(e) jogador vê "Só o admin pode ver esta tela." e link para o Início', await p.getByText('Só o admin pode ver esta tela.').isVisible() && await p.getByRole('link', { name: 'Ir para o Início' }).isVisible());
  await p.context().close();
}
{
  const p = await novaPagina(320, BETA, true);
  await p.goto(BASE + '/beta-admin'); await p.waitForTimeout(1800);
  const t0 = await texto(p);
  rec('(e) admin vê abas e o filtro Novos com os reportes falsos', /Reportes/.test(t0) && /Chave do Beta/.test(t0) && /@ana1/.test(t0) && /@ana2/.test(t0), t0.slice(0, 200));
  rec('(e) primeira busca com status=novo', p.reportesGet[0] === '?status=novo', p.reportesGet);
  rec('(e) motivo em português', await p.getByText('Algo quebrou').isVisible());
  rec('(e) data em Brasília dd/mm HH:mm', /\d\d\/\d\d \d\d:\d\d/.test(t0) && t0.includes('24/11 12:59'), t0.match(/\d\d\/\d\d \d\d:\d\d/g));
  rec('(e) "ver mais" no texto longo (só no cartão 1)', await p.getByRole('button', { name: 'ver mais' }).count() === 1);
  await p.getByRole('button', { name: 'ver mais' }).click();
  rec('(e) ver mais vira ver menos', await p.getByRole('button', { name: 'ver menos' }).isVisible());
  await p.getByRole('button', { name: 'ver menos' }).click();
  // dados técnicos
  await p.getByRole('button', { name: 'Dados técnicos' }).click(); await p.waitForTimeout(200);
  const pre = await p.locator('pre').evaluate((e) => ({ rolaH: e.scrollWidth > e.clientWidth, json: e.textContent.includes('\n  "ua"'), caixa: e.getBoundingClientRect().right }));
  rec('(e) dados técnicos formatados, rolam dentro do cartão e a página não rola', pre.json && pre.rolaH && pre.caixa <= 320 && await semRolagemH(p), pre);
  await foto(p, 'beta-e-reportes-320.png');
  await p.getByRole('button', { name: 'Dados técnicos' }).click();
  // print abre grande numa folha; voltar fecha só ela
  const inicio = await estadoHist(p);
  await p.getByRole('button', { name: 'Abrir print em tamanho grande' }).click(); await p.waitForTimeout(500);
  rec('(e) print abre numa folha', (await estadoHist(p)).dialogos === 1 && await p.getByRole('dialog').getByRole('img').isVisible());
  await p.goBack(); await p.waitForTimeout(500);
  let h = await estadoHist(p);
  rec('(e) voltar fecha só a folha do print', h.dialogos === 0 && h.path === '/beta-admin' && JSON.stringify(h.over) === JSON.stringify(inicio.over), h);
  // mudar status
  await p.getByRole('button', { name: 'Mais opções do reporte' }).first().click(); await p.waitForTimeout(400);
  rec('(e) menu ⋯ sem a opção do status atual', await p.getByRole('button', { name: 'Marcar como visto' }).isVisible() && await p.getByRole('button', { name: 'Marcar como resolvido' }).isVisible() && await p.getByRole('button', { name: 'Voltar para novo' }).count() === 0);
  await p.getByRole('button', { name: 'Marcar como resolvido' }).click(); await p.waitForTimeout(800);
  rec('(e) POST de status certo', p.posts.status.at(-1)?.id === 'R1' && p.posts.status.at(-1)?.status === 'resolvido', p.posts.status);
  rec('(e) lista recarregada depois de mudar', p.reportesGet.length >= 2, p.reportesGet);
  // Todos + carregar mais
  await p.getByRole('button', { name: 'Todos', exact: true }).click(); await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Carregar mais' }).click(); await p.waitForTimeout(800);
  rec('(e) Carregar mais usa antesDe do último', p.reportesGet.some((q) => q.includes('antesDe=' + (1764000000000 - 20 * 60000))), p.reportesGet);
  rec('(e) 21 cartões e o botão some', (await p.locator('article').count()) === 21 && await p.getByRole('button', { name: 'Carregar mais' }).count() === 0);
  // fileiras sem texto cortado
  const cortado = await p.evaluate(() => [...document.querySelectorAll('[data-scroll-item] button')].filter((b) => b.scrollWidth > b.clientWidth + 1 || getComputedStyle(b).textOverflow === 'ellipsis').map((b) => b.textContent));
  rec('(e) abas e filtros sem texto cortado', cortado.length === 0, cortado);
  // chave do Beta
  await p.getByRole('button', { name: 'Chave do Beta', exact: true }).click(); await p.waitForTimeout(700);
  const salvar = p.getByRole('button', { name: 'Salvar', exact: true });
  rec('(e) Salvar começa desativado', await salvar.isDisabled());
  const t1 = await texto(p);
  rec('(e) 4 opções com explicação', ['Ninguém vê o Beta, só o admin.', 'Só quem estiver na lista abaixo.', 'Todos começam no Beta e podem voltar.', 'O Beta vira a única versão. O botão de voltar some.'].every((x) => t1.includes(x)));
  await p.getByRole('radio', { name: /Só convidados/ }).click();
  rec('(e) Salvar ativa ao mudar', await salvar.isEnabled());
  await p.getByLabel('ID ou @usuário do convidado').fill(' @123 ');
  await p.getByRole('button', { name: 'Adicionar' }).click();
  await p.getByLabel('ID ou @usuário do convidado').fill('@123');
  await p.getByRole('button', { name: 'Adicionar' }).click(); await p.waitForTimeout(300);
  rec('(e) convidado sem @, sem repetir', (await p.locator('main ul li').count()) === 1 && await p.getByText('Esse convidado já está na lista.').isVisible(), await p.locator('main ul li').allTextContents());
  await foto(p, 'beta-e-chave-320.png');
  rec('(e) sem rolagem horizontal na chave', await semRolagemH(p));
  await salvar.click(); await p.waitForTimeout(500);
  rec('(e) confirmação "Confirmar: Só convidados"', await p.getByRole('button', { name: 'Confirmar: Só convidados' }).isVisible());
  await p.getByRole('button', { name: 'Confirmar: Só convidados' }).click(); await p.waitForTimeout(800);
  rec('(e) POST da chave {modo:"convidados",convidados:["123"]}', JSON.stringify(p.posts.config.at(-1)) === JSON.stringify({ modo: 'convidados', convidados: ['123'] }), p.posts.config);
  rec('(e) Salvar volta a desativar depois de salvar', await salvar.isDisabled());
  // Obrigatório pede confirmação em vermelho
  await p.getByRole('radio', { name: /Obrigatório/ }).click();
  await salvar.click(); await p.waitForTimeout(500);
  const cor = await p.getByRole('button', { name: 'Confirmar: Obrigatório' }).evaluate((e) => getComputedStyle(e).color);
  rec('(e) Obrigatório: confirmação em vermelho', /^oklch\(0\.[5-8]\d* 0\.[12]\d* (1\d|2\d|3\d)(\.\d+)?\)/.test(cor) || /^rgb\((2[0-9]{2}|1[5-9][0-9]), ?\d{1,2}, ?\d{1,2}\)/.test(cor), cor);
  await p.context().close();
}

await b.close();
const falhas = results.filter((r) => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} ok`);
process.exit(falhas.length ? 1 : 0);
