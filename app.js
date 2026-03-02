/* ─────────────────────────────────────────────────────────────
   UnlockHub — app.js
   ───────────────────────────────────────────────────────────── */

// ══ CONFIG — update WORKER_URL after deploying to Cloudflare ══
const WORKER_URL = 'https://achievement.sashabro1997.workers.dev';
// ══════════════════════════════════════════════════════════════

/* ── State ─────────────────────────────────────────────────── */
let currentGame = null;
let screenshots = [];
let lightboxIndex = 0;
let currentProfileSteamId = '';
let currentAchAppId = '';
let reviewCursor = '*';
let reviewsLoaded = false;
let hlsPlayer = null;
let topGamesCache = [];
let topGamesUpdatedAt = 0;
let topGamesTotal = 0;
let topGamesLoading = false;

/* ── DOM refs ──────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

/* ═════════════════════════════════ INIT ══════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  i18n.init();
  setupHeader();
  setupSearch();
  setupParticles();
  setupLangBtn();
  setupModalClose();
  setupLightbox();
  setupVideoModal();
  setupProfileSection();
  prefillHints();
  loadTopGames();
});

/* ── Header scroll effect ──────────────────────────────────── */
function setupHeader() {
  const h = document.querySelector('.header');
  window.addEventListener('scroll', () => {
    h.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });
}

/* ── Language button ───────────────────────────────────────── */
function setupLangBtn() {
  const btn = $('lang-btn');
  btn.addEventListener('click', () => {
    const next = i18n.lang === 'en' ? 'uk' : 'en';
    i18n.setLang(next);
    btn.querySelector('.lang-label').textContent = i18n.t('lang_switch');
    btn.querySelector('.flag').textContent = next === 'uk' ? '🇺🇦' : '🇬🇧';
    if (topGamesCache.length) renderTopGames(topGamesCache, topGamesUpdatedAt);
    updateTopGamesMoreBtn();
  });
}

/* ── Search ────────────────────────────────────────────────── */
function setupSearch() {
  const form = $('search-form');
  const input = $('search-input');

  form.addEventListener('submit', e => { e.preventDefault(); doSearch(input.value.trim()); });
  // Nav links
  document.querySelectorAll('[data-section]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const sec = el.dataset.section;
      if (sec === 'library') showProfileSection();
      if (sec === 'home') showHero();
      if (sec === 'explore') {
        showHero();
        setTimeout(() => { const inp = $('search-input'); if (inp) inp.focus(); }, 100);
      }
    });
  });
}

function prefillHints() {
  $$('.search-hint').forEach(h => {
    h.addEventListener('click', () => {
      $('search-input').value = h.dataset.query;
      doSearch(h.dataset.query);
    });
  });
}

async function doSearch(query) {
  if (!query) return;

  // Detect profile URL
  if (query.includes('steamcommunity.com/id/') || query.includes('steamcommunity.com/profiles/')) {
    return loadProfile(query);
  }
  // Detect store URL
  const storeM = query.match(/store\.steampowered\.com\/app\/(\d+)/);
  if (storeM) return openGameById(storeM[1]);

  // Text search
  showResultsSection();
  showLoading('results-grid');

  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    renderGameCards(data.results || [], $('results-grid'));
    $('results-count').textContent = data.results?.length || 0;
  } catch (e) {
    showToast(i18n.t('error_generic'), 'error');
    $('results-grid').innerHTML = emptyState('error');
  }
}

/* ── Sections ──────────────────────────────────────────────── */
function showHero() {
  $('hero').classList.remove('hidden');
  $('top-live-section').classList.remove('hidden');
  $('results-section').classList.add('hidden');
  $('profile-section').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showResultsSection() {
  $('hero').classList.add('hidden');
  $('top-live-section').classList.add('hidden');
  $('results-section').classList.remove('hidden');
  $('profile-section').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showProfileSection() {
  $('hero').classList.add('hidden');
  $('top-live-section').classList.add('hidden');
  $('results-section').classList.add('hidden');
  $('profile-section').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadTopGames() {
  const grid = $('top-games-grid');
  if (!grid) return;
  topGamesLoading = true;
  topGamesCache = [];
  topGamesTotal = 0;
  updateTopGamesMoreBtn();
  showLoading('top-games-grid');
  try {
    const data = await api('/api/top-games?limit=20&offset=0');
    topGamesCache = data.games || [];
    topGamesUpdatedAt = data.updated_at || 0;
    topGamesTotal = data.total || topGamesCache.length;
    renderTopGames(topGamesCache, topGamesUpdatedAt);
  } catch {
    grid.innerHTML = emptyState('media', i18n.t('top_games_empty'));
    $('top-games-count').textContent = '0';
  } finally {
    topGamesLoading = false;
    updateTopGamesMoreBtn();
  }
}

async function loadMoreTopGames() {
  if (topGamesLoading) return;
  if (topGamesTotal && topGamesCache.length >= topGamesTotal) return;

  topGamesLoading = true;
  updateTopGamesMoreBtn(true);
  try {
    const data = await api(`/api/top-games?limit=20&offset=${topGamesCache.length}`);
    const incoming = data.games || [];
    topGamesTotal = data.total || topGamesTotal || (topGamesCache.length + incoming.length);
    topGamesCache = topGamesCache.concat(incoming);
    renderTopGames(topGamesCache, topGamesUpdatedAt || data.updated_at || 0);
  } catch {
    showToast(i18n.t('error_generic'), 'error');
  } finally {
    topGamesLoading = false;
    updateTopGamesMoreBtn();
  }
}

function updateTopGamesMoreBtn(forceLoading = false) {
  const btn = $('top-games-more-btn');
  if (!btn) return;
  const loading = forceLoading || topGamesLoading;
  const hasMore = !topGamesTotal || topGamesCache.length < topGamesTotal;
  btn.style.display = hasMore ? 'inline-flex' : 'none';
  btn.disabled = loading;
  btn.textContent = loading ? `${i18n.t('loading')}` : i18n.t('top_games_load_more');
}

function renderTopGames(games, updatedAt = 0) {
  const grid = $('top-games-grid');
  if (!grid) return;
  if (!games.length) {
    grid.innerHTML = emptyState('media', i18n.t('top_games_empty'));
    $('top-games-count').textContent = '0';
    $('top-games-updated').textContent = i18n.t('top_games_subtitle');
    updateTopGamesMoreBtn();
    return;
  }

  $('top-games-count').textContent = games.length;
  if (updatedAt) {
    const dt = new Date(updatedAt * 1000);
    $('top-games-updated').textContent = `${i18n.t('top_games_updated')}: ${dt.toLocaleString()}`;
  } else {
    $('top-games-updated').textContent = i18n.t('top_games_subtitle');
  }

  grid.innerHTML = games.map((g, i) => `
    <div class="game-card" style="animation-delay:${i * 25}ms" onclick="openGameById('${g.appid}')">
      <div class="card-img-wrap">
        <img src="${g.cover}" alt="${escHtml(g.name)}" loading="lazy"
             onerror="this.src='${g.fallback || 'https://via.placeholder.com/300x450/0d1325/4f8ef7?text=No+Image'}'">
        <span class="card-addon">#${g.rank}</span>
      </div>
      <div class="card-body">
        <div class="card-name" title="${escHtml(g.name)}">${escHtml(g.name)}</div>
        <div class="card-price">
          <span class="price">${(g.peak_in_game || 0).toLocaleString()}</span>
          <span class="original" style="text-decoration:none">${i18n.t('top_games_players')}</span>
        </div>
      </div>
    </div>`).join('');
  updateTopGamesMoreBtn();
}

/* ── Render game cards ─────────────────────────────────────── */
function renderGameCards(games, container) {
  if (!games.length) {
    container.innerHTML = emptyState('search');
    return;
  }
  container.innerHTML = games.map((g, i) => `
    <div class="game-card" style="animation-delay:${i * 40}ms" onclick="openGameById('${g.appid}')">
      <div class="card-img-wrap${g.is_main_game === false ? ' addon' : ''}">
        <img src="${g.cover}" alt="${escHtml(g.name)}" loading="lazy"
             onerror="this.src='${g.fallback || 'https://via.placeholder.com/300x450/0d1325/4f8ef7?text=No+Image'}'">
        ${g.is_main_game === false ? `<span class="card-addon">DLC / Add-on</span>` : ''}
        ${g.price?.discount ? `<span class="card-discount">-${g.price.discount}%</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-name" title="${escHtml(g.name)}">${escHtml(g.name)}</div>
        <div class="card-price">
          ${!g.price
      ? `<span class="free">${i18n.t('game_free')}</span>`
      : g.price.formatted
        ? (g.price.discount
          ? `<span class="price">${g.price.formatted}</span><span class="original">${formatCents(g.price.original)}</span>`
          : `<span class="price">${g.price.formatted}</span>`)
        : g.price.final
          ? `<span class="price">${(g.price.final / 100).toFixed(2)}&thinsp;€</span>`
          : ''}
        </div>
      </div>
    </div>`).join('');
}

/* ── Open game detail ──────────────────────────────────────── */
async function openGameById(appid) {
  openModal();
  showModalLoading();

  try {
    const data = await api(`/api/game?id=${appid}&l=english`);
    currentGame = data;
    screenshots = data.screenshots || [];
    renderModal(data);
  } catch (e) {
    $('modal-box').innerHTML = `<div class="loading-center">${emptyState('error')}</div>`;
  }
}

/* ── Modal ─────────────────────────────────────────────────── */
function openModal() {
  $('modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  currentGame = null;
  screenshots = [];
}

function setupModalClose() {
  // Keep close behavior explicit (X / Esc) to avoid accidental closes while scrolling.
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeLightbox(); closeVideoModal(); } });
}

function showModalLoading() {
  $('modal-box').innerHTML = `<div class="loading-center"><div class="spinner"></div><p>${i18n.t('loading')}</p></div>`;
}

function renderModal(g) {
  const pct = g.review_summary?.total_reviews
    ? Math.round(g.review_summary.total_positive / g.review_summary.total_reviews * 100) : null;
  const scoreClass = pct >= 70 ? 'pos' : pct >= 40 ? 'mix' : 'neg';
  const moviesWithUrl = (g.movies || []).map(m => {
    const videoUrl = m.mp4_max || m.mp4_480 || m.hls_h264 || m.webm_max || m.webm_480 || '';
    const streamType = m.hls_h264 ? 'hls' : (videoUrl.includes('.m3u8') ? 'hls' : 'file');
    return { ...m, videoUrl, streamType };
  }).filter(m => m.videoUrl);

  $('modal-box').innerHTML = `
    <div class="modal-hero">
      <img class="modal-hero-img" src="${g.background || g.header}" alt="${escHtml(g.name)}"
           onerror="this.src='${g.header}'">
      <div class="modal-hero-overlay">
        <div class="modal-tag-row">
          ${(g.genres || []).slice(0, 3).map(gn => `<span class="pill pill-blue">${gn}</span>`).join('')}
          ${g.is_free ? `<span class="pill pill-green">${i18n.t('game_free')}</span>` : ''}
          ${g.metacritic ? `<span class="pill pill-purple">Metacritic ${g.metacritic.score}</span>` : ''}
        </div>
        <h2 class="modal-title">${escHtml(g.name)}</h2>
        <div class="modal-meta-row">
          ${g.developer ? `<span>👨‍💻 ${escHtml(g.developer)}</span>` : ''}
          ${g.release ? `<span>📅 ${escHtml(g.release)}</span>` : ''}
          ${g.price ? `<span>💰 ${g.price.formatted}</span>` : g.is_free ? `<span>🆓 ${i18n.t('game_free')}</span>` : ''}
        </div>
      </div>
      <button class="modal-close" onclick="closeModal()" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="modal-tabs" role="tablist">
      ${[['overview', 'tab_overview'], ['screenshots', 'tab_screenshots'], ['videos', 'tab_videos'], ['reviews', 'tab_reviews'], ['achievements', 'tab_achievements']]
      .map(([id, key], i) => `<button class="tab-btn${i === 0 ? ' active' : ''}" onclick="switchTab('${id}')" data-tab="${id}">${i18n.t(key)}</button>`).join('')}
    </div>

    <div class="modal-body">
      <!-- OVERVIEW -->
      <div class="tab-panel active" id="tab-overview">
        <div class="overview-grid">
          <div class="game-description">${sanitizeHtml(g.about || g.description || '')}</div>
          <div class="overview-sidebar">
            ${pct !== null ? `
            <div class="info-box review-score-box">
              <div class="review-score-big review-score-${scoreClass}">${g.review_summary.score_desc || ''}</div>
              <div class="review-score-label">${g.review_summary.total_reviews?.toLocaleString() || 0} ${i18n.t('tab_reviews').toLowerCase()}</div>
              <div class="review-bar-wrap">
                <div class="review-bar-track"><div class="review-bar-fill" style="width:${pct}%;background:${pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)'}"></div></div>
                <div class="review-num"><span>${i18n.t('reviews_positive')} ${g.review_summary.total_positive?.toLocaleString()}</span><span>${g.review_summary.total_negative?.toLocaleString()} ${i18n.t('reviews_negative')}</span></div>
              </div>
            </div>` : ''}
            <div class="info-box">
              ${infoRow(i18n.t('game_developer'), g.developer)}
              ${infoRow(i18n.t('game_publisher'), g.publisher)}
              ${infoRow(i18n.t('game_release'), g.release)}
              ${infoRow(i18n.t('game_price'), g.is_free ? i18n.t('game_free') : g.price?.formatted)}
              ${g.platforms ? infoRow(i18n.t('game_platforms'), [g.platforms.windows ? 'Win' : '', g.platforms.mac ? 'Mac' : '', g.platforms.linux ? 'Linux' : ''].filter(Boolean).join(', ')) : ''}
              ${g.website ? `<div class="info-row"><span class="label">${i18n.t('game_website')}</span><a href="${g.website}" target="_blank" class="value" style="color:var(--blue)">Link →</a></div>` : ''}
            </div>
            <a href="https://store.steampowered.com/app/${g.appid}" target="_blank" class="btn btn-primary btn-lg" style="width:100%;justify-content:center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"/></svg>
              ${i18n.t('btn_view_steam')}
            </a>
          </div>
        </div>
      </div>

      <!-- SCREENSHOTS -->
      <div class="tab-panel" id="tab-screenshots">
        ${screenshots.length ? `
        <div class="screenshots-grid">
          ${screenshots.map((s, i) => `
            <div class="screenshot-item" onclick="openLightbox(${i})">
              <img src="${s.thumb}" alt="Screenshot ${i + 1}" loading="lazy">
            </div>`).join('')}
        </div>` : `<div>${emptyState('media', i18n.t('no_screenshots'))}</div>`}
      </div>

      <!-- VIDEOS -->
      <div class="tab-panel" id="tab-videos">
        ${moviesWithUrl.length ? `
        <div class="videos-grid">
          ${moviesWithUrl.map(m => {
        const encodedUrl = encodeURIComponent(m.videoUrl);
        const encodedName = encodeURIComponent(m.name || 'Trailer');
        const encodedType = encodeURIComponent(m.streamType || 'file');
        return `
            <div class="video-item" onclick="openVideoByEncoded('${encodedUrl}','${encodedName}','${encodedType}')">
              <img src="${m.thumb}" alt="${escHtml(m.name)}" loading="lazy">
              <div class="video-play-btn">
                <svg viewBox="0 0 80 80" fill="none"><circle cx="40" cy="40" r="39" stroke="white" stroke-opacity="0.3" stroke-width="2"/><circle cx="40" cy="40" r="39" fill="rgba(79,142,247,0.2)"/><path d="M33 28l22 12-22 12V28z" fill="white"/></svg>
              </div>
              <div class="video-name">${escHtml(m.name)}</div>
            </div>`;
      }).join('')}
        </div>` : `<div>${emptyState('media', i18n.t('no_videos'))}</div>`}
      </div>

      <!-- REVIEWS -->
      <div class="tab-panel" id="tab-reviews">
        <div id="reviews-body">
          <div class="loading-center"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- ACHIEVEMENTS -->
      <div class="tab-panel" id="tab-achievements">
        <div class="ach-profile-bar">
          <input class="ach-profile-input" id="ach-profile-input" placeholder="${i18n.t('profile_placeholder')}" type="url">
          <button class="btn btn-primary btn-sm" onclick="loadAchievements('${g.appid}')">${i18n.t('btn_sync')}</button>
        </div>
        <div id="ach-body">
          <div class="loading-center"><div class="spinner"></div></div>
        </div>
      </div>
    </div>`;

  // Auto-load reviews + achievements (global)
  loadReviews(g.appid);
  loadAchievements(g.appid);
  currentAchAppId = String(g.appid);
}

function infoRow(label, value) {
  if (!value) return '';
  return `<div class="info-row"><span class="label">${label}</span><span class="value">${escHtml(String(value))}</span></div>`;
}

function switchTab(id) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${id}`));
}

/* ── Reviews ───────────────────────────────────────────────── */
async function loadReviews(appid, cursor = '*') {
  const body = $('reviews-body');
  if (!body) return;

  try {
    const data = await api(`/api/reviews?id=${appid}&cursor=${encodeURIComponent(cursor)}`);
    const sum = data.summary || {};
    const reviews = data.reviews || [];
    const pct = sum.total_reviews ? Math.round(sum.total_positive / sum.total_reviews * 100) : null;
    const cls = pct >= 70 ? 'pos' : pct >= 40 ? 'mix' : 'neg';

    const header = `
      <div class="reviews-header">
        ${pct !== null ? `
        <div style="display:flex;flex-direction:column;gap:4px">
          <span class="review-score-big review-score-${cls}" style="font-size:24px">${sum.review_score_desc || ''}</span>
          <span style="font-size:12px;color:var(--text-2)">${(sum.total_reviews || 0).toLocaleString()} ${i18n.t('tab_reviews').toLowerCase()}</span>
        </div>
        <span class="pill ${pct >= 70 ? 'pill-green' : pct >= 40 ? 'pill-blue' : 'pill-red'}">${pct}% ${i18n.t('reviews_positive')}</span>` : ''}
      </div>`;

    const cards = reviews.map(r => `
      <div class="review-card">
        <div class="review-top">
          <div class="review-thumb ${r.positive ? 'pos' : 'neg'}">${r.positive ? '👍' : '👎'}</div>
          <div class="review-meta">
            <div class="review-verdict ${r.positive ? 'pos' : 'neg'}">${r.positive ? i18n.t('reviews_positive') : i18n.t('reviews_negative')}</div>
            <div class="review-hours">${r.hours}h ${i18n.t('profile_hours')}</div>
          </div>
        </div>
        <div class="review-text" id="rev-${r.id}" style="display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden">
          ${escHtml(r.text)}
        </div>
        ${r.text.length > 200 ? `<div class="review-expand" onclick="expandReview('rev-${r.id}',this)">${i18n.t('btn_show_more')}</div>` : ''}
      </div>`).join('');

    const canLoadMore = data.cursor && data.cursor !== '*' && reviews.length === 10;
    if (cursor === '*') {
      body.innerHTML = header +
        (reviews.length
          ? `<div class="reviews-list">${cards}</div>`
          : `<p style="color:var(--text-2);text-align:center;padding:40px">${i18n.t('reviews_empty')}</p>`) +
        `<div style="text-align:center;margin-top:16px" id="reviews-more-wrap">
          ${canLoadMore ? `<button class="btn btn-ghost" onclick="loadMoreReviews('${appid}','${data.cursor}')">${i18n.t('btn_next')}</button>` : ''}
        </div>`;
    } else {
      const list = body.querySelector('.reviews-list');
      if (list) list.insertAdjacentHTML('beforeend', cards);
      const moreWrap = $('reviews-more-wrap');
      if (moreWrap) {
        moreWrap.innerHTML = canLoadMore
          ? `<button class="btn btn-ghost" onclick="loadMoreReviews('${appid}','${data.cursor}')">${i18n.t('btn_next')}</button>`
          : '';
      }
    }
  } catch {
    if (body) body.innerHTML = `<p style="color:var(--text-2);text-align:center;padding:40px">${i18n.t('error_generic')}</p>`;
  }
}

function expandReview(id, btn) {
  const el = $(id);
  el.style.display = 'block';
  btn.remove();
}

async function loadMoreReviews(appid, cursor) {
  const btn = document.querySelector('#reviews-more-wrap .btn');
  if (btn) btn.disabled = true;
  await loadReviews(appid, cursor);
}

/* ── Achievements ──────────────────────────────────────────── */
async function loadAchievements(appid) {
  const body = $('ach-body');
  const inp = $('ach-profile-input');
  const profileUrl = inp ? inp.value.trim() : '';
  let steamid = currentProfileSteamId;

  if (profileUrl && profileUrl.includes('steamcommunity.com')) {
    // resolve steamid inline from worker
    try {
      const pd = await api(`/api/profile?url=${encodeURIComponent(profileUrl)}`);
      steamid = pd.steamid || '';
      currentProfileSteamId = steamid;
    } catch { }
  }

  if (!body) return;
  body.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;

  try {
    const lang = i18n.lang;
    let data;
    try {
      data = await api(`/api/achievements?appid=${appid}&steamid=${steamid}&l=${lang}`);
    } catch (e) {
      if (!steamid) throw e;
      // If profile achievements fail (private profile / invalid steamid), fallback to global achievements.
      data = await api(`/api/achievements?appid=${appid}&l=${lang}`);
    }

    if (!data.total) {
      body.innerHTML = `<p style="color:var(--text-2);text-align:center;padding:40px">${i18n.t('ach_empty')}</p>`;
      return;
    }

    const pct = data.percent;
    const circumference = 2 * Math.PI * 35;
    const offset = circumference - (pct / 100) * circumference;

    body.innerHTML = `
      <svg width="0" height="0"><defs>
        <linearGradient id="achGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#4f8ef7"/><stop offset="100%" stop-color="#7c4dff"/>
        </linearGradient>
      </defs></svg>
      <div class="ach-header">
        <div class="ach-progress-ring">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="35" stroke-width="6" class="ring-bg"/>
            <circle cx="40" cy="40" r="35" stroke-width="6" class="ring-fill"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${steamid ? offset : circumference}"/>
          </svg>
          <div class="ach-pct-text">${steamid ? pct + '%' : '—'}</div>
        </div>
        <div class="ach-counts">
          ${steamid ? `<div><b>${data.unlocked}</b> / ${data.total}</div>
          <div class="ach-counts" style="color:var(--text-2)">${i18n.t('ach_unlocked')}</div>` :
        `<div><b>${data.total}</b></div>
          <div class="ach-counts" style="color:var(--text-2)">${i18n.t('tab_achievements')}</div>
          <div style="font-size:12px;color:var(--text-3);max-width:200px;margin-top:4px">${i18n.t('ach_enter_profile')}</div>`}
        </div>
      </div>
      <div class="ach-list">
        ${data.achievements.map(a => `
        <div class="ach-item ${a.unlocked ? 'unlocked' : ''}">
          <img class="ach-icon ${a.unlocked ? '' : 'gray'}" src="${a.unlocked ? a.icon : a.icon_gray}" alt="${escHtml(a.displayName)}"
               onerror="this.src='${a.icon}'">
          <div class="ach-info">
            <div class="ach-name">${escHtml(a.displayName)}</div>
            <div class="ach-desc">${a.hidden && !a.unlocked ? (i18n.lang === 'uk' ? 'Приховане досягнення' : 'Hidden achievement') : escHtml(a.description)}</div>
          </div>
          <div class="ach-right">
            ${a.unlocked && a.unlock_time ? `<div class="ach-unlock-date">✅ ${new Date(a.unlock_time * 1000).toLocaleDateString()}</div>` :
            !a.unlocked ? `<div class="ach-lock-icon">🔒</div><div class="ach-pct">${a.global_pct.toFixed(1)}%</div>` : ''}
          </div>
        </div>`).join('')}
      </div>`;
  } catch {
    if (body) body.innerHTML = `<p style="color:var(--text-2);text-align:center;padding:40px">${i18n.t('error_generic')}</p>`;
  }
}

/* ── Profile ────────────────────────────────────────────────── */
function setupProfileSection() {
  const btn = $('profile-sync-btn');
  const inp = $('profile-url-input');
  if (!btn || !inp) return;
  btn.addEventListener('click', () => {
    const url = inp.value.trim();
    if (url) loadProfile(url);
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const url = inp.value.trim(); if (url) loadProfile(url); } });
}

async function loadProfile(url) {
  showProfileSection();
  $('profile-url-input').value = url;
  $('profile-header').innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  $('library-grid').innerHTML = '';

  try {
    const data = await api(`/api/profile?url=${encodeURIComponent(url)}`);
    currentProfileSteamId = data.steamid || '';
    renderProfile(data);
  } catch (e) {
    $('profile-header').innerHTML = `<div class="loading-center">${emptyState('error', i18n.t('profile_private'))}</div>`;
  }
}

function renderProfile(d) {
  const statusMap = {
    0: i18n.t('profile_status_offline'),
    1: i18n.t('profile_status_online'),
    2: i18n.t('profile_status_busy'),
    3: i18n.t('profile_status_away'),
    4: i18n.t('profile_status_snooze'),
  };
  const statusLabel = statusMap[d.status] || '';
  $('profile-header').innerHTML = `
    <div class="profile-avatar"><img src="${d.avatar}" alt="${escHtml(d.name)}"></div>
    <div class="profile-info">
      <div class="profile-name">${escHtml(d.name)} ${statusLabel ? `<span class="pill pill-${d.status === 1 ? 'green' : 'blue'}" style="font-size:11px">${statusLabel}</span>` : ''}</div>
      <div class="profile-stats">
        <div class="profile-stat"><span class="profile-stat-val">${d.game_count}</span><span class="profile-stat-lbl">${i18n.t('profile_games')}</span></div>
        <div class="profile-stat"><span class="profile-stat-val">${d.total_hours.toLocaleString()}</span><span class="profile-stat-lbl">${i18n.t('profile_hours')}</span></div>
        ${d.country ? `<div class="profile-stat"><span class="profile-stat-val">${d.country}</span><span class="profile-stat-lbl">${i18n.t('profile_country')}</span></div>` : ''}
      </div>
    </div>
    <a href="${d.profile_url}" target="_blank" class="btn btn-ghost btn-sm" style="margin-left:auto">${i18n.t('btn_view_steam')} →</a>`;

  const topH = d.games[0]?.hours || 1;
  $('library-grid').innerHTML = d.games.map((g, i) => `
    <div class="lib-card" style="animation-delay:${i * 30}ms" onclick="openGameById('${g.appid}')">
      <div class="lib-card-img">
        <img src="${g.header}" alt="${escHtml(g.name)}" loading="lazy"
             onerror="this.style.display='none'">
      </div>
      <div class="lib-card-body">
        <div class="lib-card-name" title="${escHtml(g.name)}">${escHtml(g.name)}</div>
        <div class="lib-card-hours ${g.hours_2w ? 'lib-card-recent' : ''}">${g.hours}h${g.hours_2w ? ` · ${g.hours_2w}h ${i18n.t('profile_recent')}` : ''}</div>
      </div>
    </div>`).join('');
}

/* ── Lightbox ───────────────────────────────────────────────── */
function setupLightbox() {
  $('lightbox-close').addEventListener('click', closeLightbox);
  $('lightbox-prev').addEventListener('click', () => moveLightbox(-1));
  $('lightbox-next').addEventListener('click', () => moveLightbox(1));
  $('lightbox').addEventListener('click', e => { if (e.target === $('lightbox')) closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (!$('lightbox') || $('lightbox').classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') moveLightbox(-1);
    if (e.key === 'ArrowRight') moveLightbox(1);
  });
}

function openLightbox(index) {
  lightboxIndex = index;
  $('lightbox').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  updateLightbox();
}

function closeLightbox() {
  $('lightbox').classList.add('hidden');
  document.body.style.overflow = '';
}

function moveLightbox(dir) {
  lightboxIndex = (lightboxIndex + dir + screenshots.length) % screenshots.length;
  updateLightbox();
}

function updateLightbox() {
  const s = screenshots[lightboxIndex];
  if (!s) return;
  $('lightbox-img').src = s.full;
  $('lightbox-counter').textContent = `${lightboxIndex + 1} / ${screenshots.length}`;
}

/* ── Video modal ────────────────────────────────────────────── */
function setupVideoModal() {
  $('video-modal-close').addEventListener('click', closeVideoModal);
  $('video-modal').addEventListener('click', e => { if (e.target === $('video-modal')) closeVideoModal(); });
  const player = $('video-player');
  player.addEventListener('error', () => {
    showToast(i18n.lang === 'uk' ? 'Не вдалося завантажити відео' : 'Failed to load video', 'error');
  });
}

function openVideoByEncoded(encodedUrl, encodedName, encodedType = 'file') {
  try {
    openVideo(decodeURIComponent(encodedUrl), decodeURIComponent(encodedName), decodeURIComponent(encodedType || 'file'));
  } catch {
    openVideo(encodedUrl, encodedName, 'file');
  }
}

function ensureHlsScript() {
  return new Promise((resolve, reject) => {
    if (window.Hls) return resolve(window.Hls);
    const existing = document.querySelector('script[data-hlsjs="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Hls));
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';
    s.async = true;
    s.dataset.hlsjs = '1';
    s.onload = () => resolve(window.Hls);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function destroyHlsPlayer() {
  if (hlsPlayer) {
    try { hlsPlayer.destroy(); } catch { }
    hlsPlayer = null;
  }
}

async function openVideo(url, name, streamType = 'file') {
  if (!url) return;
  const player = $('video-player');
  destroyHlsPlayer();
  player.pause();
  player.removeAttribute('src');
  player.load();

  if (streamType === 'hls' || /\.m3u8(\?|$)/i.test(url)) {
    try {
      await ensureHlsScript();
      if (window.Hls && window.Hls.isSupported()) {
        hlsPlayer = new window.Hls();
        hlsPlayer.loadSource(url);
        hlsPlayer.attachMedia(player);
        hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, () => {
          player.play().catch(() => { });
        });
      } else {
        player.src = url;
        player.load();
        player.play().catch(() => { });
      }
    } catch {
      player.src = url;
      player.load();
      player.play().catch(() => { });
    }
  } else {
    player.crossOrigin = 'anonymous';
    player.src = url;
    player.load();
    player.play().catch(() => { });
  }

  $('video-modal-title').textContent = name;
  $('video-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeVideoModal() {
  const player = $('video-player');
  destroyHlsPlayer();
  player.pause();
  player.src = '';
  $('video-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ── Particles ──────────────────────────────────────────────── */
function setupParticles() {
  const canvas = $('particles-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];
  let W, H;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  class Particle {
    reset() {
      this.x = Math.random() * W;
      this.y = Math.random() * H;
      this.r = Math.random() * 1.5 + 0.3;
      this.dx = (Math.random() - 0.5) * 0.3;
      this.dy = -Math.random() * 0.4 - 0.1;
      this.a = Math.random() * 0.5 + 0.1;
    }
    constructor() { this.reset(); }
    update() {
      this.x += this.dx; this.y += this.dy;
      if (this.y < -4) this.reset();
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(79,142,247,${this.a})`;
      ctx.fill();
    }
  }

  particles = Array.from({ length: 100 }, () => new Particle());

  function loop() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(loop);
  }
  loop();
}

/* ── Toast ─────────────────────────────────────────────────── */
function showToast(msg, type = 'info') {
  const c = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── API helper ─────────────────────────────────────────────── */
async function api(path) {
  const res = await fetch(WORKER_URL + path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

/* ── Helpers ─────────────────────────────────────────────────── */
function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sanitizeHtml(html) {
  // Strip scripts, iframes, event handlers, and ALL inline styles (Steam HTML has fixed widths)
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\sstyle\s*=\s*"[^"]*"/gi, '')  // remove all inline styles
    .replace(/\swidth\s*=\s*"[^"]*"/gi, '')  // remove fixed width attrs
    .replace(/\sheight\s*=\s*"[^"]*"/gi, ''); // remove fixed height attrs
}

function formatCents(val) {
  if (!val) return '';
  return (val / 100).toFixed(2);
}

function showLoading(containerId) {
  const el = $(containerId);
  if (el) el.innerHTML = `<div class="loading-center"><div class="spinner"></div><p>${i18n.t('loading')}</p></div>`;
}

function emptyState(type, msg = '') {
  const icons = {
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };
  return `<div class="empty-state">
    ${icons[type] || icons.error}
    <p>${msg || i18n.t(type === 'search' ? 'results_empty' : 'error_generic')}</p>
  </div>`;
}
