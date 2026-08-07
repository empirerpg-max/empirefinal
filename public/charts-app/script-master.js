// ============================================================
// EMPIRE CHARTS — script-master.js
// ============================================================

const API = "https://script.google.com/macros/s/AKfycbyDQK3x0fU5V6qnFgtRyf8IPTNPDm2eeQsvZRwmHnCb_sCKLyc8wuwhuNZxEWjGEiYe/exec";

// ============================================================
// PERFORMANCE: Cache local em memória (evita refetch repetido)
// ============================================================
const _cache = {};
async function fetchCached(url) {
  if (_cache[url]) return _cache[url];
  const data = await fetch(url, { redirect: 'follow' }).then(r => r.json());
  _cache[url] = data;
  return data;
}

// ============================================================
// BANNER FIXO — #1s da semana em todas as abas
// ============================================================
async function buildBanner() {
  if (document.getElementById('empire-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'empire-banner';

  // Logo à esquerda
  banner.innerHTML = `
    <div class="banner-logo"><img src="logo.png" onerror="this.parentElement.style.display='none'"></div>
    <div class="banner-sep"></div>`;

  document.body.insertBefore(banner, document.body.firstChild);

  try {
    const data = await fetchCached(API + '?action=getBannerN1s');
    const items = [
      { label: 'billboard hot 100', color: 'var(--empire)', d: data.hot100 },
      { label: 'spotify global',    color: 'var(--spotify)', d: data.spotify },
      { label: 'apple music global',color: 'var(--apple)',   d: data.apple },
      { label: 'youtube global',    color: 'var(--youtube)', d: data.youtube },
      { label: 'digital sales',     color: 'var(--gold)',    d: data.sales },
      { label: 'billboard 200',     color: '#bbb',           d: data.bb200 },
    ];

    const cards = items.filter(it => it.d).map(it => {
      const cover = it.d.capa || '';
      const title = it.d.tit || '—';
      const artist = it.d.art || '';
      return '<div class="banner-card">'
        + (cover ? '<img src="' + cover + '" class="banner-cover" onerror="this.style.display=\'none\'">' : '')
        + '<div class="banner-info">'
        + '<span class="banner-platform" style="color:' + it.color + '">' + it.label + '</span>'
        + '<div class="banner-title">' + title + '</div>'
        + (artist ? '<div class="banner-artist">' + artist + '</div>' : '')
        + '</div></div>';
    }).join('');

    banner.innerHTML = `
      <div class="banner-logo"><img src="logo.png" onerror="this.parentElement.style.display='none'"></div>
      <div class="banner-sep"></div>
      <div class="banner-cards">${cards}</div>`;
  } catch(e) { /* silently fail */ }
}

// ============================================================
// HOME — capa estilo revista + lançamentos
// ============================================================
async function loadHome() {
  const app = document.getElementById('app');
  document.body.className = '';
  app.innerHTML = '<div class="skeleton" style="height:520px;margin-bottom:12px;"></div>'
    + '<div class="skeleton" style="height:80px;"></div>';

  let coverData = {}, releases = [];
  try {
    coverData = await fetchCached(API + '?action=getTopArtistCover');
  } catch(e) {
    console.error('getTopArtistCover falhou:', e);
  }
  try {
    releases = await fetchCached(API + '?action=getReleases');
  } catch(e) {
    console.error('getReleases falhou:', e);
  }

  // Se voltou erro da API (objeto com campo error)
  if (coverData && coverData.error) {
    app.innerHTML = `<p style="text-align:center;color:#555;padding:60px;letter-spacing:2px;font-size:12px;">
      ERRO DA API: ${coverData.error}<br><br>
      Verifique se o deploy do Apps Script foi republicado com as novas funções.
    </p>`;
    return;
  }

  // Se voltou vazio, mostra mensagem útil
  if (!coverData || !coverData.name) {
    app.innerHTML = '<p style="text-align:center;color:#555;padding:60px;letter-spacing:2px;font-size:12px;">TOP ARTIST NÃO ENCONTRADO — verifique se a planilha TOP_50_ARTISTAS_MENSAL tem linhas com RANK = 1</p>';
    return;
  }

  const art = coverData;
  const img = art.img || '';
  const name = art.name || '';
  const headline = art.headline || '';
  const editorial = art.editorial || '';
  const author = art.author || '';
  const month = art.month || '';
  const pts = art.pts || '';

  const typeColor = t => {
    t = (t || '').toUpperCase();
    if (t.includes('LEAD'))  return '#8a2be2';
    if (t.includes('PRÉ') || t.includes('PRE')) return '#1DB954';
    if (t.includes('PÓS') || t.includes('POS')) return '#fa243c';
    if (t.includes('PROMO')) return '#d4af37';
    return '#555';
  };

  const releasesHtml = (releases && releases.length) ? `
  <div class="home-releases">
    <h2 class="home-section-title">MOST RECENT RELEASES</h2>
    <div class="home-releases-track">
      ${releases.map(r => `
        <div class="release-card">
          <div class="release-type" style="background:${typeColor(r.tipo)}">${r.tipo || 'SINGLE'}</div>
          <div class="release-title">${r.musica || r.titulo || r.t || '—'}</div>
          <div class="release-date">${r.data || ''}</div>
        </div>`).join('')}
    </div>
  </div>` : '';

  // Formata o editorial: "site\n\n<b>TÍTULO</b>\n\ntexto" → HTML legível
  function formatEditorial(text) {
    if (!text) return '';
    // Remove tags HTML existentes exceto <b>
    text = text.replace(/<(?!b>|\/b>)[^>]+>/gi, '');
    // Quebra em parágrafos por linha dupla ou \n
    const lines = text.split(/\n/).map(l => l.trim()).filter(l => l);
    return lines.map((line, i) => {
      if (i === 0) return `<div class="home-editorial-site">${line}</div>`;
      // Linha em negrito (tag <b> ou toda em maiúsculas curta)
      if (line.startsWith('<b>') || (line === line.toUpperCase() && line.length < 120))
        return `<div class="home-editorial-headline">${line.replace(/<\/?b>/g,'')}</div>`;
      return `<p class="home-editorial-para">${line}</p>`;
    }).join('');
  }

  app.innerHTML = `
  <div class="home-cover">
    <div class="home-cover-img" style="background-image:url('${img}')">
      <div class="home-cover-overlay"></div>
      <div class="home-cover-top">
        <img src="logo.png" class="home-logo" onerror="this.style.display='none'">
        <span class="home-issue">${month}</span>
      </div>
      <div class="home-cover-badge">TOP ARTIST</div>
      <div class="home-cover-content">
        <h1 class="home-cover-name">${name}</h1>
        ${pts ? `<div class="home-cover-pts">${pts} <span>PTS</span></div>` : ''}
      </div>
    </div>
    ${editorial ? `
    <div class="home-editorial">
      ${author ? `<div class="home-editorial-label">${author}</div>` : ''}
      <div class="home-editorial-text">${formatEditorial(editorial)}</div>
    </div>` : ''}
  </div>
  ${releasesHtml}`;
}

// ============================================================
// MENU
// ============================================================
function buildMenu() {
  const navMenu = document.getElementById('menu-nav');
  if (!navMenu) return;

  // Menu horizontal — desktop
  navMenu.innerHTML = `
    <a href="index.html" class="menu-item">Home</a>
    <a href="realtime.html" class="menu-item">🔴 Live</a>
    <div class="menu-item" onclick="window.location.href='artists.html'">🌟 Artists</div>
    <div class="menu-item">Hot 100
      <div class="submenu">
        <a href="charts.html?tab=BILLBOARD HOT 100" class="sub-btn">Billboard Hot 100</a>
        <a href="charts.html?tab=BILLBOARD HOT 100&style=true" class="sub-btn">Hot 100 by Style</a>
      </div>
    </div>
    <div class="menu-item" style="color:var(--spotify)">Spotify
      <div class="submenu">
        <a href="charts.html?tab=SPOTIFY" class="sub-btn">Global Charts</a>
        <a href="countries.html?tab=SPOTIFY COUNTRIES" class="sub-btn">By Country</a>
        <a href="monthly.html?p=SPOTIFY" class="sub-btn">Monthly Artists</a>
      </div>
    </div>
    <div class="menu-item" style="color:var(--apple)">Apple Music
      <div class="submenu">
        <a href="charts.html?tab=APPLE MUSIC" class="sub-btn">Global Charts</a>
        <a href="countries.html?tab=APPLE MUSIC COUNTRIES" class="sub-btn">By Country</a>
        <a href="monthly.html?p=APPLE MUSIC" class="sub-btn">Monthly Artists</a>
      </div>
    </div>
    <div class="menu-item" style="color:var(--youtube)">YouTube
      <div class="submenu">
        <a href="charts.html?tab=YOUTUBE" class="sub-btn">Global Charts</a>
        <a href="countries.html?tab=YOUTUBE COUNTRIES" class="sub-btn">By Country</a>
        <a href="monthly.html?p=YOUTUBE" class="sub-btn">Monthly Artists</a>
      </div>
    </div>
    <div class="menu-item">Albums
      <div class="submenu">
        <a href="charts.html?tab=DADOS ÁLBUNS" class="sub-btn">Billboard 200</a>
        <a href="charts.html?tab=DADOS ÁLBUNS&style=true" class="sub-btn">Albums by Style</a>
      </div>
    </div>
    <a href="charts.html?tab=DIGITAL SALES" class="menu-item">Sales</a>`;

  // Hambúrguer no header — sempre recria para garantir no primeiro carregamento
  const header = document.querySelector('header');
  if (header && !header.querySelector('.nav-hamburger')) {
    const btn = document.createElement('div');
    btn.className = 'nav-hamburger';
    btn.setAttribute('aria-label', 'Menu');
    btn.innerHTML = '<span></span><span></span><span></span>';
    btn.onclick = toggleDrawer;
    header.style.position = 'fixed';
    header.appendChild(btn);
  }

  // Remove drawer anterior se existir (garante re-render correto)
  const oldDrawer = document.getElementById('nav-drawer');
  const oldOverlay = document.getElementById('nav-overlay');
  if (oldDrawer) oldDrawer.remove();
  if (oldOverlay) oldOverlay.remove();
    const overlay = document.createElement('div');
    overlay.className = 'nav-overlay';
    overlay.id = 'nav-overlay';
    overlay.onclick = closeDrawer;

    const drawer = document.createElement('div');
    drawer.className = 'nav-drawer';
    drawer.id = 'nav-drawer';
    drawer.innerHTML = `
      <a href="index.html" class="drawer-item">Home</a>
      <a href="realtime.html" class="drawer-item" style="color:#e00;">🔴 Live</a>
      <a href="artists.html" class="drawer-item" style="color:var(--gold)">🌟 Artists</a>
      <div class="drawer-item" onclick="toggleDrawerSub(this)">Hot 100
        <div class="drawer-sub">
          <a href="charts.html?tab=BILLBOARD HOT 100">Billboard Hot 100</a>
          <a href="charts.html?tab=BILLBOARD HOT 100&style=true">Hot 100 by Style</a>
        </div>
      </div>
      <div class="drawer-item" style="color:var(--spotify)" onclick="toggleDrawerSub(this)">Spotify
        <div class="drawer-sub">
          <a href="charts.html?tab=SPOTIFY">Global Charts</a>
          <a href="countries.html?tab=SPOTIFY COUNTRIES">By Country</a>
          <a href="monthly.html?p=SPOTIFY">Monthly Artists</a>
        </div>
      </div>
      <div class="drawer-item" style="color:var(--apple)" onclick="toggleDrawerSub(this)">Apple Music
        <div class="drawer-sub">
          <a href="charts.html?tab=APPLE MUSIC">Global Charts</a>
          <a href="countries.html?tab=APPLE MUSIC COUNTRIES">By Country</a>
          <a href="monthly.html?p=APPLE MUSIC">Monthly Artists</a>
        </div>
      </div>
      <div class="drawer-item" style="color:var(--youtube)" onclick="toggleDrawerSub(this)">YouTube
        <div class="drawer-sub">
          <a href="charts.html?tab=YOUTUBE">Global Charts</a>
          <a href="countries.html?tab=YOUTUBE COUNTRIES">By Country</a>
          <a href="monthly.html?p=YOUTUBE">Monthly Artists</a>
        </div>
      </div>
      <div class="drawer-item" onclick="toggleDrawerSub(this)">Albums
        <div class="drawer-sub">
          <a href="charts.html?tab=DADOS ÁLBUNS">Billboard 200</a>
          <a href="charts.html?tab=DADOS ÁLBUNS&style=true">Albums by Style</a>
        </div>
      </div>
      <a href="charts.html?tab=DIGITAL SALES" class="drawer-item">Sales</a>`;

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
}

function toggleDrawer() {
  document.getElementById('nav-drawer').classList.toggle('open');
  document.getElementById('nav-overlay').classList.toggle('open');
}

function closeDrawer() {
  document.getElementById('nav-drawer').classList.remove('open');
  document.getElementById('nav-overlay').classList.remove('open');
}

function toggleDrawerSub(el) {
  const sub = el.querySelector('.drawer-sub');
  if (!sub) return;
  sub.classList.toggle('open');
  el.classList.toggle('open');
}

// ============================================================
// DIRETÓRIO DE ARTISTAS
// ============================================================
async function loadHOFList() {
  const app = document.getElementById('app');
  document.body.className = '';
  app.innerHTML = '<div class="skeleton"></div>'.repeat(5);

  const list = await fetchCached(API + "?action=getHOFList");

  // Coleta países e estilos únicos para os filtros
  const countries = [...new Set(list.map(a => a.country).filter(Boolean))].sort();
  const styles = [...new Set(list.map(a => a.style).filter(Boolean))].sort();

  let h = `
    <h2 style="text-align:center;font-family:'Plus Jakarta Sans';font-weight:800;letter-spacing:6px;margin-bottom:24px;">DIRECTORY</h2>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:30px;align-items:center;">
      <input id="hof-search" type="text" placeholder="🔍  Buscar artista..." oninput="filterHOF()"
        style="padding:10px 18px;border-radius:50px;border:1px solid #333;background:#111;color:#fff;font-size:13px;outline:none;min-width:220px;">
      <select id="hof-country" onchange="filterHOF()"
        style="padding:10px 18px;border-radius:50px;border:1px solid #333;background:#111;color:#aaa;font-size:12px;outline:none;cursor:pointer;">
        <option value="">🌍 Todos os países</option>
        ${countries.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
      <select id="hof-style" onchange="filterHOF()"
        style="padding:10px 18px;border-radius:50px;border:1px solid #333;background:#111;color:#aaa;font-size:12px;outline:none;cursor:pointer;">
        <option value="">🎵 Todos os estilos</option>
        ${styles.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
    </div>
    <div id="hof-count" style="text-align:center;font-size:11px;color:#555;letter-spacing:2px;margin-bottom:20px;">${list.length} ARTISTAS</div>
    <div id="hof-grid" class="hof-grid">`;

  list.forEach(a => {
    const meta = a.country ? `${a.country} • ${a.style}` : a.style;
    h += `<div class="hof-card" onclick="loadHOFProfile('${a.name}')"
      data-name="${a.name.toLowerCase()}"
      data-country="${(a.country || '').toLowerCase()}"
      data-style="${(a.style || '').toLowerCase()}">
      <img src="${a.img}" onerror="this.src='https://via.placeholder.com/150'">
      <h3>${a.name}</h3><p class="hof-meta">${meta}</p>
    </div>`;
  });

  app.innerHTML = h + '</div>';
}

function filterHOF() {
  const q = document.getElementById('hof-search').value.toLowerCase().trim();
  const country = document.getElementById('hof-country').value.toLowerCase();
  const style = document.getElementById('hof-style').value.toLowerCase();
  const cards = document.querySelectorAll('.hof-card');
  let visible = 0;
  cards.forEach(card => {
    const matchName = !q || card.dataset.name.includes(q);
    const matchCountry = !country || card.dataset.country === country;
    const matchStyle = !style || card.dataset.style === style;
    const show = matchName && matchCountry && matchStyle;
    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const countEl = document.getElementById('hof-count');
  if (countEl) countEl.textContent = `${visible} ARTISTAS`;
}

// ============================================================
// PERFIL DO ARTISTA (HOF)
// ============================================================
async function loadHOFProfile(name) {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="skeleton" style="height:300px;margin-bottom:10px;"></div><div class="skeleton"></div><div class="skeleton"></div>';

  const d = await fetchCached(`${API}?action=getHOFProfile&artist=${encodeURIComponent(name)}`);
  if (!d || !d.name) { app.innerHTML = '<p style="text-align:center;color:#555;">Perfil não encontrado.</p>'; return; }

  // Tabela de chart runs — r.v contém posições separadas por " - "
  const runs = d.runs || [];

  let runsTable = '';
  if (runs.length) {
    const parsed = runs.map(r => {
      const positions = String(r.v).split('-').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
      const peak = positions.length ? Math.min(...positions) : 999;
      const weeks = positions.length;
      return { title: r.t, peak, weeks };
    });

    parsed.sort((a, b) => a.peak !== b.peak ? a.peak - b.peak : b.weeks - a.weeks);
    const maxWeeks = Math.max(...parsed.map(r => r.weeks));
    const peakColor = p => p === 1 ? 'var(--gold)' : p <= 10 ? '#aaa' : '#555';
    const peakLabel = p => p === 1 ? '#1' : '#' + p;

    runsTable = `
    <div style="margin-top:40px;max-width:800px;">
      <h3 style="font-size:12px;letter-spacing:3px;color:#555;margin-bottom:20px;text-transform:uppercase;">Chart Runs</h3>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #222;">
            <th style="text-align:left;font-size:10px;letter-spacing:2px;color:#444;padding:0 0 12px;font-weight:600;">MUSICA</th>
            <th style="text-align:center;font-size:10px;letter-spacing:2px;color:#444;padding:0 16px 12px;font-weight:600;white-space:nowrap;">PICO</th>
            <th style="text-align:center;font-size:10px;letter-spacing:2px;color:#444;padding:0 16px 12px;font-weight:600;white-space:nowrap;">SEMANAS</th>
            <th style="padding:0 0 12px;width:35%;"></th>
          </tr>
        </thead>
        <tbody>
          ${parsed.map(r => {
            const barW = Math.round((r.weeks / maxWeeks) * 100);
            return '<tr style="border-bottom:1px solid #111;">'
              + '<td style="padding:12px 0;font-size:13px;color:#ccc;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + r.title + '">' + r.title + '</td>'
              + '<td style="padding:12px 16px;text-align:center;font-size:15px;font-weight:900;color:' + peakColor(r.peak) + ';white-space:nowrap;">' + peakLabel(r.peak) + '</td>'
              + '<td style="padding:12px 16px;text-align:center;font-size:15px;font-weight:700;color:var(--empire);">' + r.weeks + '</td>'
              + '<td style="padding:12px 0;"><div style="background:#111;border-radius:3px;height:5px;"><div style="background:var(--empire);height:5px;border-radius:3px;width:' + barW + '%;opacity:0.6;"></div></div></td>'
              + '</tr>';
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // Números #1
  const n1s = [
    { label: 'Hot 100', val: d.n1_hot100, color: '#fff' },
    { label: 'Spotify', val: d.n1_spotify, color: 'var(--spotify)' },
    { label: 'YouTube', val: d.n1_youtube, color: 'var(--youtube)' },
    { label: 'BB 200', val: d.n1_bb200, color: 'var(--gold)' },
  ].filter(x => x.val && x.val !== '-' && x.val !== '' && Number(x.val) !== 0);

  // Top músicas por plataforma
  const platformSection = (title, color, items) => {
    if (!items || !items.length) return '';
    return `<div>
      <h4 style="font-size:11px;letter-spacing:2px;color:${color};margin-bottom:12px;text-transform:uppercase;">${title}</h4>
      ${items.slice(0, 5).map((m, i) => `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
          <span style="font-size:13px;color:#444;width:16px;text-align:right;">${i + 1}</span>
          <span style="font-size:13px;flex:1;color:#ccc;">${m.t}</span>
          <span style="font-size:12px;color:${color};font-weight:700;">${m.v}</span>
        </div>`).join('')}
    </div>`;
  };

  app.innerHTML = `
    <button onclick="loadHOFList()" style="background:none;border:1px solid #333;color:#888;padding:8px 18px;border-radius:50px;cursor:pointer;font-size:11px;letter-spacing:1px;margin-bottom:30px;">← VOLTAR</button>

    <!-- Cabeçalho do perfil -->
    <div style="display:flex;align-items:center;gap:30px;margin-bottom:40px;flex-wrap:wrap;">
      <img src="${d.img}" onerror="this.src='https://via.placeholder.com/150'"
        style="width:140px;height:140px;border-radius:50%;object-fit:cover;border:3px solid var(--gold);flex-shrink:0;">
      <div style="flex:1;min-width:200px;">
        <p style="font-size:11px;letter-spacing:3px;color:#555;margin:0 0 6px;text-transform:uppercase;">${d.country || ''} ${d.country && d.style ? '•' : ''} ${d.style || ''}</p>
        <h1 style="font-size:clamp(28px,5vw,52px);font-weight:900;margin:0 0 16px;letter-spacing:-1px;text-transform:uppercase;">${d.name}</h1>
        ${n1s.length ? `<div style="display:flex;gap:12px;flex-wrap:wrap;">
          ${n1s.map(x => `<div style="background:#111;border:1px solid #222;border-radius:12px;padding:10px 18px;text-align:center;">
            <div style="font-size:20px;font-weight:900;color:${x.color};">${x.val}</div>
            <div style="font-size:9px;color:#555;letter-spacing:2px;margin-top:2px;text-transform:uppercase;">${x.label} #1s</div>
          </div>`).join('')}
        </div>` : ''}
      </div>
    </div>

    <!-- Tabela de runs -->
    ${runsTable}

    <!-- Top músicas e álbuns -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:30px;margin-top:40px;">
      ${platformSection('Spotify', 'var(--spotify)', d.sp)}
      ${platformSection('Apple Music', 'var(--apple)', d.am)}
      ${platformSection('YouTube', 'var(--youtube)', d.yt)}
      ${platformSection('Álbuns', 'var(--gold)', d.alb)}
    </div>`;
}

// ============================================================
// REAL TIME
// ============================================================
async function loadRealTime() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="skeleton"></div>'.repeat(3);
  document.body.className = '';
  const d = await fetchCached(API + "?action=getRealTime");

  const row = (l, c) => l.map(i => {
    const pos = i.posicao || i.pos || i.p || '-';
    const cover = i.capa || i.c || 'https://via.placeholder.com/45';
    const title = i.titulo || i.musica || i.tit || i.t || '-';
    const val = i.streams || i.semana || i.val || i.s || '-';
    return `<div class="chart-row" style="grid-template-columns:35px 45px 1fr 90px;padding:10px;border-bottom:1px solid #1a1a1a;">
      <div class="rank" style="font-size:14px;">${pos}</div>
      <img src="${cover}">
      <div style="padding-left:10px;"><b style="font-size:12px;">${title}</b></div>
      <div style="color:${c};font-weight:800;font-size:12px;text-align:right;">${val}</div>
    </div>`;
  }).join('');

  app.innerHTML = `
    <h2 style="text-align:center;font-family:'Plus Jakarta Sans';margin-bottom:30px;">LIVE PREVIEWS</h2>
    <div class="rt-grid">
      <div class="rt-col"><div class="rt-head" style="color:var(--spotify);">Spotify</div>${row(d.spotify, 'var(--spotify)')}</div>
      <div class="rt-col"><div class="rt-head" style="color:var(--apple);">Apple Music</div>${row(d.apple, 'var(--apple)')}</div>
      <div class="rt-col"><div class="rt-head" style="color:#fff;">YouTube</div>${row(d.youtube, '#fff')}</div>
    </div>`;
}

// ============================================================
// CHARTS GERAIS — filtros temáticos com setas
// ============================================================
let chartCache = [];

// Retorna cores do tema ativo para usar nos filtros
function getThemeAccent() {
  const b = document.body.classList;
  if (b.contains('theme-spotify'))   return { color: '#1DB954', bg: 'rgba(29,185,84,0.12)',  border: 'rgba(29,185,84,0.4)' };
  if (b.contains('theme-apple'))     return { color: '#fa243c', bg: 'rgba(250,36,60,0.08)',   border: 'rgba(250,36,60,0.35)' };
  if (b.contains('theme-youtube'))   return { color: '#ff0000', bg: 'rgba(255,0,0,0.1)',      border: 'rgba(255,0,0,0.35)' };
  if (b.contains('theme-billboard')) return { color: '#e31c23', bg: 'rgba(227,28,35,0.08)',   border: 'rgba(227,28,35,0.3)' };
  return { color: '#8a2be2', bg: 'rgba(138,43,226,0.12)', border: 'rgba(138,43,226,0.4)' };
}

// Renderiza um pill-container com setas
function pillRow(id, pills, activeIndex = 0) {
  return `
  <div class="filter-row" id="row-${id}">
    <button class="filter-arrow" onclick="scrollPills('${id}',-1)" aria-label="anterior">&#8249;</button>
    <div class="pill-container" id="${id}">
      ${pills}
    </div>
    <button class="filter-arrow" onclick="scrollPills('${id}',1)" aria-label="próximo">&#8250;</button>
  </div>`;
}

function scrollPills(id, dir) {
  const el = document.getElementById(id);
  if (el) el.scrollBy({ left: dir * 200, behavior: 'smooth' });
}

async function initChart(tab, hasStyle) {
  const app = document.getElementById('app');
  applyChartTheme(tab);
  app.innerHTML = '<div class="skeleton"></div>'.repeat(5);

  const f = await fetchCached(`${API}?action=getFilters&tab=${tab}`);
  const ac = getThemeAccent();

  const datePills = f.dates.map((d, i) =>
    `<div class="pill date-pill ${i === 0 ? 'active' : ''}" onclick="updateChart(this,'${tab}','${d}',${hasStyle})">${d}</div>`
  ).join('');

  const stylePills = hasStyle
    ? `<div class="pill style-pill active" onclick="applyGenre('ALL',event)">TODOS OS ESTILOS</div>`
      + (f.styles || []).map(s => `<div class="pill style-pill" onclick="applyGenre('${s.replace(/'/g,"\\'")}',event)">${s}</div>`).join('')
    : '';

  const searchBg  = document.body.classList.contains('theme-billboard') || document.body.classList.contains('theme-apple') ? '#f2f2f2' : '#111';
  const searchClr = document.body.classList.contains('theme-billboard') || document.body.classList.contains('theme-apple') ? '#000' : '#fff';

  const h = `
    <h2 style="text-align:center;text-transform:uppercase;margin-bottom:24px;letter-spacing:2px;font-weight:900;">${tab}</h2>
    <div class="filter-group">
      ${pillRow('date-pills', datePills)}
      ${hasStyle ? pillRow('style-pills', stylePills) : ''}
      <div class="filter-search-row">
        <input id="chart-search" type="text" placeholder="🔍  Artista ou música..."
          oninput="applyChartSearch()"
          style="background:${searchBg};color:${searchClr};border-color:${ac.border};">
        <button class="filter-clear" onclick="document.getElementById('chart-search').value='';applyChartSearch()">✕ Limpar</button>
      </div>
    </div>
    <div id="chart-area"></div>`;

  app.innerHTML = h;
  updateChart(null, tab, f.dates[0], hasStyle);
}

async function updateChart(el, tab, date, hasStyle) {
  if (el) {
    document.querySelectorAll('.date-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
  }
  const area = document.getElementById('chart-area');
  area.innerHTML = '<div class="skeleton"></div>'.repeat(5);

  const res = await fetchCached(`${API}?action=getChart&tab=${tab}&date=${date}`);
  chartCache = res;

  if (hasStyle) {
    const styles = [...new Set(res.map(i => i.estilo || i.style))].filter(s => s).sort();
    const sContainer = document.getElementById('style-pills');
    if (sContainer) {
      sContainer.innerHTML =
        `<div class="pill style-pill active" onclick="applyGenre('ALL',event)">TODOS OS ESTILOS</div>` +
        styles.map(s => `<div class="pill style-pill" onclick="applyGenre('${s}',event)">${s}</div>`).join('');
    }
  }

  const searchEl = document.getElementById('chart-search');
  if (searchEl) searchEl.value = '';

  renderRows(res, tab);
}

function applyGenre(genre, ev) {
  document.querySelectorAll('.style-pill').forEach(p => p.classList.remove('active'));
  if (ev && ev.target) ev.target.classList.add('active');
  const q = (document.getElementById('chart-search')?.value || '').toLowerCase().trim();
  let filtered = genre === 'ALL' ? chartCache : chartCache.filter(i => (i.estilo || i.style) === genre);
  if (q) filtered = filtered.filter(i => _matchSearch(i, q));
  renderRows(filtered, document.querySelector('h2')?.innerText || '');
}

function applyChartSearch() {
  const q = (document.getElementById('chart-search')?.value || '').toLowerCase().trim();
  const activeStyle = document.querySelector('.style-pill.active')?.innerText;
  let filtered = chartCache;
  if (activeStyle && activeStyle !== 'TODOS OS ESTILOS') {
    filtered = filtered.filter(i => (i.estilo || i.style) === activeStyle);
  }
  if (q) filtered = filtered.filter(i => _matchSearch(i, q));
  renderRows(filtered, document.querySelector('h2')?.innerText || '');
}

function _matchSearch(i, q) {
  const title = (i.musica || i.titulo || i.album || i.tit || i.t || '').toLowerCase();
  const artist = (i.artista || i.art || i.a || '').toLowerCase();
  return title.includes(q) || artist.includes(q);
}

function renderRows(data, tab) {
  const area = document.getElementById('chart-area');
  const isBB = tab.includes('BILLBOARD');
  const isYT = tab.includes('YOUTUBE');

  if (!data.length) {
    area.innerHTML = '<p style="text-align:center;color:#555;padding:40px;">Nenhum resultado encontrado.</p>';
    return;
  }

  area.innerHTML = data.map(i => {
    const pos = i.posicao || i.pos || i.p || '-';
    const cover = i.capa || i.c || 'https://via.placeholder.com/45';
    const title = i.musica || i.titulo || i.album || i.tit || i.t || '-';
    const artist = i.artista || i.art || i.a || '';
    const val = i.semana || i.streams || i.pontos || i.vendas || i.val || i.s || '0';
    const st = i.status || i.st || '=';
    const stClass = st == '↑' ? 'up' : (st == '↓' ? 'down' : (st == 'NEW' ? 'new' : ''));
    const stIcon = st == '↑' ? '▲' : (st == '↓' ? '▼' : (st == 'NEW' ? 'NEW' : '='));
    const label = isYT ? 'VIEWS' : (isBB ? 'PTS' : (tab.includes('ÁLBUNS') ? 'UNIDADES' : ''));
    return `<div class="chart-row">
      <div><div class="rank">${pos}</div><div class="st-tag ${stClass}">${stIcon}</div></div>
      <img src="${cover}">
      <div style="padding-left:15px;overflow:hidden;">
        <b style="font-size:16px;white-space:nowrap;text-transform:${isBB ? 'uppercase' : 'none'};">${title}</b>
        <br><span style="color:#888;font-size:13px;">${artist}</span>
      </div>
      <div style="text-align:right;"><b style="font-size:16px;">${val} ${label}</b></div>
    </div>`;
  }).join('');
}

// ============================================================
// COUNTRIES — implementação completa
// ============================================================
let countryCache = [];

async function initCountry(tab) {
  const app = document.getElementById('app');
  applyChartTheme(tab);
  app.innerHTML = '<div class="skeleton"></div>'.repeat(5);

  const f = await fetchCached(`${API}?action=getFilters&tab=${tab}`);
  if (!f || !f.dates || !f.dates.length) {
    app.innerHTML = `<p style="text-align:center;color:#555;padding:60px;font-size:12px;letter-spacing:2px;">NENHUMA DATA ENCONTRADA PARA "${tab}"</p>`;
    return;
  }
  const ac = getThemeAccent();
  const searchBg  = document.body.classList.contains('theme-apple') ? '#f2f2f2' : '#111';
  const searchClr = document.body.classList.contains('theme-apple') ? '#000' : '#fff';

  const datePills = f.dates.map((d, i) =>
    `<div class="pill date-pill ${i === 0 ? 'active' : ''}" onclick="updateCountry(this,'${tab}','${d}')">${d}</div>`
  ).join('');

  const h = `
    <h2 style="text-align:center;text-transform:uppercase;margin-bottom:24px;letter-spacing:2px;font-weight:900;">${tab.replace(' COUNTRIES','')}: Por País</h2>
    <div class="filter-group">
      ${pillRow('date-pills', datePills)}
      <div class="filter-search-row">
        <input id="country-filter" type="text" placeholder="🔍  País, artista ou música..."
          oninput="applyCountrySearch()"
          style="background:${searchBg};color:${searchClr};border-color:${ac.border};">
        <select id="country-select" onchange="applyCountrySearch()"
          style="padding:10px 16px;border-radius:50px;border:1px solid ${ac.border};background:${searchBg};color:${searchClr};font-size:12px;outline:none;cursor:pointer;">
          <option value="">🌍 Todos os países</option>
        </select>
        <button class="filter-clear" onclick="document.getElementById('country-filter').value='';document.getElementById('country-select').value='';applyCountrySearch()">✕ Limpar</button>
      </div>
    </div>
    <div id="chart-area"></div>`;

  app.innerHTML = h;
  updateCountry(null, tab, f.dates[0]);
}

async function updateCountry(el, tab, date) {
  if (el) {
    document.querySelectorAll('.date-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
  }
  const area = document.getElementById('chart-area');
  area.innerHTML = '<div class="skeleton"></div>'.repeat(5);

  const res = await fetchCached(`${API}?action=getChart&tab=${tab}&date=${date}`);
  countryCache = res;

  // Popula o select de países usando campo 'pais'
  const countrySel = document.getElementById('country-select');
  if (countrySel) {
    const countries = [...new Set(res.map(i => i.pais || '').filter(Boolean))].sort();
    countrySel.innerHTML = `<option value="">🌍 Todos os países</option>` +
      countries.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  const searchEl = document.getElementById('country-filter');
  if (searchEl) searchEl.value = '';

  renderCountryRows(res);
}

function applyCountrySearch() {
  const q = (document.getElementById('country-filter')?.value || '').toLowerCase().trim();
  const country = (document.getElementById('country-select')?.value || '');
  let filtered = countryCache;
  if (country) filtered = filtered.filter(i => (i.pais || '') === country);
  if (q) {
    filtered = filtered.filter(i => {
      const title = (i.tit || '').toLowerCase();
      const artist = (i.art || '').toLowerCase();
      const pais = (i.pais || '').toLowerCase();
      return title.includes(q) || artist.includes(q) || pais.includes(q);
    });
  }
  renderCountryRows(filtered);
}

function renderCountryRows(data) {
  const area = document.getElementById('chart-area');
  if (!data || !data.length) {
    area.innerHTML = '<p style="text-align:center;color:#555;padding:40px;">Nenhum resultado encontrado.</p>';
    return;
  }
  area.innerHTML = data.map(i => {
    const pos   = i.pos  || '-';
    const cover = i.capa || 'https://via.placeholder.com/45';
    const title = i.tit  || '-';
    const artist = i.art || '';
    const pais  = i.pais || '';
    const val   = i.val  || '0';
    return `<div class="chart-row" style="grid-template-columns:40px 50px 1fr 110px 120px;">
      <div class="rank" style="font-size:16px;">${pos}</div>
      <img src="${cover}" onerror="this.src='https://via.placeholder.com/45'">
      <div style="padding-left:12px;overflow:hidden;">
        <b style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;">${title}</b>
        <span style="color:#888;font-size:12px;">${artist}</span>
      </div>
      <div style="text-align:right;font-size:13px;font-weight:700;">${val}</div>
      <div style="text-align:right;font-size:10px;color:#888;letter-spacing:1px;text-transform:uppercase;">${pais}</div>
    </div>`;
  }).join('');
}

// ============================================================
// MONTHLY
// ============================================================
async function initMonthly(p) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="filter-group">
    <div id="year-pills" class="pill-container"></div>
    <div id="month-pills" class="pill-container"></div>
    <div style="text-align:center;">
      <select id="aS" onchange="renderM('${p}')"
        style="padding:10px;border-radius:10px;background:#111;color:#fff;border:1px solid #333;display:none;outline:none;"></select>
    </div>
  </div>
  <div id="profile-area"></div>`;

  const years = await fetchCached(`${API}?action=getMonthlyYears`);
  document.getElementById('year-pills').innerHTML =
    years.map(y => `<div class="pill year-pill" onclick="handleYearClick(this,'${y}','${p}')">${y}</div>`).join('');

  applyChartTheme(p);
}

async function handleYearClick(el, year, p) {
  document.querySelectorAll('.year-pill').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const months = await fetchCached(`${API}?action=getMonthlyDates&year=${year}`);
  document.getElementById('month-pills').innerHTML =
    months.map(m => `<div class="pill month-pill" onclick="handleMonthClick(this,'${m}','${year}','${p}')">${m}</div>`).join('');
}

async function handleMonthClick(el, month, year, p) {
  document.querySelectorAll('.month-pill').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('aS').style.display = 'inline-block';
  const artists = await fetchCached(`${API}?action=getArtists&platform=${p}&month=${month}&year=${year}`);
  document.getElementById('aS').innerHTML =
    `<option value="">SELECT ARTIST</option>` +
    artists.map(a => `<option value="${a}">${a}</option>`).join('');
}

async function renderM(p) {
  const profile = document.getElementById('profile-area');
  const a = document.getElementById('aS').value;
  const y = document.querySelector('.year-pill.active')?.innerText;
  const m = document.querySelector('.month-pill.active')?.innerText;
  if (!a) return;

  profile.innerHTML = '<div class="skeleton" style="height:400px;"></div>';
  const data = await fetchCached(`${API}?action=getMonthlyStats&platform=${p}&month=${m}&year=${y}&artist=${a}`);
  const art = data[0];

  const rank = art.rank && art.rank !== '-' ? art.rank : null;

  // Ícone de play SVG decorativo — cor e estilo por plataforma
  const playBtn = (color, bg) => `
    <div style="width:36px;height:36px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:default;">
      <svg width="13" height="14" viewBox="0 0 13 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 1.5L11.5 7L2 12.5V1.5Z" fill="${color}"/>
      </svg>
    </div>`;

  // Badge de ranking mensal
  const rankBadge = (color, label) => rank ? `
    <div style="display:inline-flex;align-items:center;gap:8px;background:${color}18;border:1px solid ${color}33;border-radius:50px;padding:6px 16px;margin-top:12px;">
      <span style="font-size:18px;font-weight:900;color:${color};">#${rank}</span>
      <span style="font-size:10px;color:${color}99;letter-spacing:2px;text-transform:uppercase;">${label}</span>
    </div>` : '';

  if (p.includes('SPOTIFY')) {
    profile.innerHTML = `
      <div class="sp-banner" style="background-image:url('${art.capaArtista || art.capa}')">
        <div style="position:relative;z-index:2;">
          <h1 style="font-size:80px;font-weight:900;margin:0;letter-spacing:-4px;text-transform:uppercase;">${a}</h1>
          <p style="font-weight:700;font-size:18px;margin-top:5px;">${art.totalOuvintes || art.ov} ouvintes mensais</p>
          ${rankBadge('#1DB954', `Top ${rank} em ${m} ${y}`)}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:40px;max-width:1100px;margin:0 auto;">
        <div>
          <h3 style="font-size:20px;margin-bottom:20px;">Populares</h3>
          ${(art.musicas || art.m).map((mus, i) => `
            <div class="chart-row" style="grid-template-columns:30px 60px 1fr auto 90px;gap:0;align-items:center;">
              <span style="color:#b3b3b3;font-weight:700;font-size:14px;">${i + 1}</span>
              <img src="${mus.capaMusica || mus.c}">
              <b style="padding-left:14px;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${mus.titulo || mus.t}</b>
              ${playBtn('#1DB954', 'rgba(29,185,84,0.12)')}
              <span style="text-align:right;color:#b3b3b3;font-size:13px;">${mus.streams || mus.s}</span>
            </div>`).join('')}
        </div>
        <div>
          <h3 style="font-size:20px;margin-bottom:20px;">Sobre</h3>
          <div style="background:#181818;padding:25px;border-radius:8px;color:#aaa;line-height:1.6;">${art.sobre || art.bio}</div>
        </div>
      </div>`;

  } else if (p.includes('APPLE')) {
    profile.innerHTML = `
      <div class="am-profile-header">
        <img src="${art.capaArtista || art.capa}" class="am-artist-img">
        <div style="padding-left:45px;">
          <h1 style="font-size:56px;font-weight:900;margin:0;">${a}</h1>
          <div style="color:var(--apple);font-weight:700;font-size:20px;margin-top:8px;">${art.totalOuvintes || art.ov} ouvintes mensais</div>
          ${rankBadge('#fa243c', `Top ${rank} em ${m} ${y}`)}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 300px;gap:50px;">
        <div>
          <h3 style="border-bottom:1px solid #eee;padding-bottom:10px;">Top Songs</h3>
          ${(art.musicas || art.m).slice(0, 5).map(mus => `
            <div class="chart-row" style="grid-template-columns:60px 1fr auto 90px;padding:12px 0;gap:0;align-items:center;">
              <img src="${mus.capaMusica || mus.c}" style="border-radius:6px;">
              <b style="padding-left:14px;font-size:15px;">${mus.titulo || mus.t}</b>
              ${playBtn('#fa243c', 'rgba(250,36,60,0.08)')}
              <span style="text-align:right;color:#8e8e93;font-size:13px;padding-left:10px;">${mus.streams || mus.s}</span>
            </div>`).join('')}
        </div>
        <div>
          <h3 style="border-bottom:1px solid #eee;padding-bottom:10px;">Sobre</h3>
          <div style="color:#444;line-height:1.6;">${art.sobre || art.bio}</div>
        </div>
      </div>`;

  } else if (p.includes('YOUTUBE')) {
    profile.innerHTML = `
      <div class="yt-banner" style="background-image:url('${art.capaArtista || art.capa}')"></div>
      <div style="display:flex;align-items:center;padding:20px 0 40px 0;">
        <img src="${art.capaArtista || art.capa}" class="yt-avatar">
        <div style="padding-left:30px;">
          <h2 style="font-size:36px;margin:0;">${a}</h2>
          <div style="color:#aaa;">${art.totalOuvintes || art.ov} visualizações mensais</div>
          ${rankBadge('#ff0000', `Top ${rank} em ${m} ${y}`)}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:40px;">
        <div>
          <h4 style="border-left:3px solid var(--youtube);padding-left:10px;">VÍDEOS POPULARES</h4>
          ${(art.musicas || art.m).slice(0, 5).map(mus => `
            <div style="display:flex;gap:15px;margin-bottom:20px;align-items:center;">
              <div style="position:relative;flex-shrink:0;">
                <img src="${mus.capaMusica || mus.c}" style="width:180px;height:101px;object-fit:cover;border-radius:12px;display:block;">
                <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
                  ${playBtn('#fff', 'rgba(0,0,0,0.55)')}
                </div>
              </div>
              <div>
                <b style="display:block;font-size:16px;">${mus.titulo || mus.t}</b>
                <span style="color:#aaa;font-size:13px;">${mus.streams || mus.s} views</span>
              </div>
            </div>`).join('')}
        </div>
        <div>
          <h4 style="border-left:3px solid var(--youtube);padding-left:10px;">INFORMAÇÕES</h4>
          <div style="background:#0f0f0f;padding:20px;border-radius:12px;color:#aaa;line-height:1.6;">${art.sobre || art.bio}</div>
        </div>
      </div>`;
  }
}

// ============================================================
// TEMA
// ============================================================
function applyChartTheme(tab) {
  const b = document.body;
  b.className = '';
  if (tab.includes('BILLBOARD')) b.classList.add('theme-billboard');
  else if (tab.includes('SPOTIFY')) b.classList.add('theme-spotify');
  else if (tab.includes('APPLE')) b.classList.add('theme-apple');
  else if (tab.includes('YOUTUBE')) b.classList.add('theme-youtube');
}
