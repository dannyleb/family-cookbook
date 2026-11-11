import { layoutTable, stepText } from './model.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const imgSrc = (name) => `images/${encodeURIComponent(name)}`;

// localStorage can be unavailable (private mode, blocked storage): never let that break the page.
const store = {
  get(key, fallback, area = 'localStorage') {
    try {
      const v = window[area].getItem(`cookbook:${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value, area = 'localStorage') {
    try {
      window[area].setItem(`cookbook:${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

const ICON = {
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  book: {},
  recipes: [],
  bySlug: new Map(),
  categories: [],
  query: store.get('query', '', 'sessionStorage'),
  filter: store.get('filter', 'all', 'sessionStorage'), // 'all' | 'favorites' | <category>
  favorites: new Set(store.get('favorites', [])),
  tableView: store.get('tableView', false),
  homeScroll: 0,
  cameFromHome: false,
};

const isFav = (slug) => state.favorites.has(slug);
function toggleFav(slug) {
  if (isFav(slug)) state.favorites.delete(slug);
  else state.favorites.add(slug);
  store.set('favorites', [...state.favorites]);
  document.querySelectorAll(`[data-fav="${CSS.escape(slug)}"]`).forEach(syncStar);
  if (!$('#home').hidden) renderChips();
}
function syncStar(btn) {
  const on = isFav(btn.dataset.fav);
  btn.setAttribute('aria-pressed', String(on));
  const label = btn.querySelector('.star-label');
  if (label) label.textContent = on ? 'Saved' : 'Save';
}
function starButton(r, withLabel = false) {
  return `<button type="button" class="star${withLabel ? ' star-wide' : ''}" data-fav="${esc(r.slug)}"
    aria-pressed="${isFav(r.slug)}" aria-label="Favorite: ${esc(r.title)}">${ICON.star}${
      withLabel ? `<span class="star-label">${isFav(r.slug) ? 'Saved' : 'Save'}</span>` : ''
    }</button>`;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function init() {
  let data;
  try {
    const res = await fetch('recipes.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
  } catch {
    $('#status').textContent = 'Couldn’t load the recipes. Check your connection and refresh.';
    return;
  }
  $('#status').hidden = true;

  state.book = data.book || {};
  state.recipes = data.recipes.map((r) => ({
    ...r,
    _title: fold(r.title),
    _hay: fold(
      [
        r.title,
        r.category,
        r.from,
        r.description,
        r.notes,
        ...r.tags,
        ...r.ingredients.map((i) => i.text),
      ].join(' \n '),
    ),
  }));
  state.bySlug = new Map(state.recipes.map((r) => [r.slug, r]));

  const order = (state.book.categories || []).map(String);
  const present = [...new Set(state.recipes.map((r) => r.category))];
  state.categories = [
    ...order.filter((c) => present.includes(c)),
    ...present.filter((c) => !order.includes(c)).sort((a, b) => a.localeCompare(b)),
  ];
  if (!['all', 'favorites', ...state.categories].includes(state.filter)) state.filter = 'all';

  $('#book-title').textContent = state.book.title || 'Family Cookbook';
  $('#book-subtitle').textContent = state.book.subtitle || '';
  $('#book-subtitle').hidden = !state.book.subtitle;

  bindHome();
  bindRecipeView();
  window.addEventListener('hashchange', route);
  route();
}

// ---------------------------------------------------------------------------
// Routing:  #/  -> home,  #/recipe/<slug>  -> recipe
// ---------------------------------------------------------------------------
function route() {
  const m = location.hash.match(/^#\/recipe\/([^/?#]+)/);
  const recipe = m && state.bySlug.get(decodeURIComponent(m[1]));
  if (recipe) showRecipe(recipe);
  else showHome();
}

function showHome() {
  const wasHidden = $('#home').hidden;
  setWake(false);
  $('#recipe').hidden = true;
  $('#recipe').innerHTML = '';
  $('#home').hidden = false;
  document.title = state.book.title || 'Family Cookbook';
  $('#search').value = state.query;
  renderChips();
  renderResults();
  if (wasHidden) requestAnimationFrame(() => window.scrollTo(0, state.homeScroll));
}

function showRecipe(r) {
  if (!$('#home').hidden) {
    state.homeScroll = window.scrollY;
    state.cameFromHome = true;
  }
  setWake(false);
  $('#home').hidden = true;
  $('#recipe').hidden = false;
  $('#recipe').innerHTML = recipeHTML(r);
  renderRecipeBody(r);
  bindRecipe(r);
  document.title = `${r.title} · ${state.book.title || 'Family Cookbook'}`;
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Home: search, filter chips, results
// ---------------------------------------------------------------------------
function bindHome() {
  const input = $('#search');
  input.addEventListener('input', () => {
    state.query = input.value;
    store.set('query', state.query, 'sessionStorage');
    renderChips();
    renderResults();
  });

  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    store.set('filter', state.filter, 'sessionStorage');
    renderChips();
    renderResults();
  });

  $('#results').addEventListener('click', (e) => {
    const star = e.target.closest('[data-fav]');
    if (star) {
      toggleFav(star.dataset.fav);
      if (state.filter === 'favorites') renderResults();
      return;
    }
    if (e.target.closest('[data-clear]')) {
      state.query = '';
      state.filter = 'all';
      store.set('query', '', 'sessionStorage');
      store.set('filter', 'all', 'sessionStorage');
      input.value = '';
      renderChips();
      renderResults();
      input.focus();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || $('#home').hidden) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    input.focus();
  });
}

function searchMatches() {
  const tokens = fold(state.query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return state.recipes.map((r) => ({ r, score: 1 }));
  return state.recipes
    .map((r) => ({
      r,
      score: tokens.every((t) => r._title.includes(t)) ? 2 : tokens.every((t) => r._hay.includes(t)) ? 1 : 0,
    }))
    .filter((x) => x.score > 0);
}

function renderChips() {
  const matches = searchMatches().map((x) => x.r);
  const count = (fn) => matches.filter(fn).length;
  const chip = (value, label, n) =>
    `<button type="button" class="chip${value === 'favorites' ? ' chip-fav' : ''}" data-filter="${esc(value)}"
      aria-pressed="${state.filter === value}"${n === 0 && state.filter !== value && value !== 'favorites' ? ' data-empty' : ''}>
      ${value === 'favorites' ? ICON.star : ''}<span>${esc(label)}</span><span class="chip-n">${n}</span></button>`;

  $('#chips').innerHTML = [
    chip('all', 'All', matches.length),
    chip('favorites', 'Favorites', count((r) => isFav(r.slug))),
    ...state.categories.map((c) => chip(c, c, count((r) => r.category === c))),
  ].join('');
}

function renderResults() {
  let list = searchMatches();
  if (state.filter === 'favorites') list = list.filter((x) => isFav(x.r.slug));
  else if (state.filter !== 'all') list = list.filter((x) => x.r.category === state.filter);
  list.sort((a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title));

  const total = state.recipes.length;
  const q = state.query.trim();
  $('#count').textContent =
    list.length === total ? `${total} recipe${total === 1 ? '' : 's'}` : `${list.length} of ${total} recipes`;

  if (!list.length) {
    let msg;
    if (state.filter === 'favorites' && !state.favorites.size) {
      msg = `<p class="empty-title">No favorites yet</p><p>Tap the ${ICON.star} on any recipe to save it here. Favorites are saved on this device.</p>`;
    } else if (q) {
      msg = `<p class="empty-title">Nothing matches “${esc(q)}”</p><p>Try one word, like an ingredient or a person’s name.</p>`;
    } else {
      msg = `<p class="empty-title">No recipes here yet</p>`;
    }
    $('#results').innerHTML = `<div class="empty">${msg}${
      q || state.filter !== 'all' ? '<button type="button" class="btn" data-clear>Show all recipes</button>' : ''
    }</div>`;
    return;
  }

  $('#results').innerHTML = list.map(({ r }) => cardHTML(r)).join('');
}

function cardHTML(r) {
  const meta = [r.time, r.from && `From ${r.from}`].filter(Boolean).map(esc).join('<span aria-hidden="true"> · </span>');
  return `<article class="card${r.image ? ' has-img' : ''}">
    ${r.image ? `<img class="card-img" src="${imgSrc(r.image)}" alt="" loading="lazy">` : ''}
    <div class="card-body">
      <p class="eyebrow">${esc(r.category)}</p>
      <h2 class="card-title"><a href="#/recipe/${encodeURIComponent(r.slug)}">${esc(r.title)}</a></h2>
      ${r.description ? `<p class="card-desc">${esc(r.description)}</p>` : ''}
      ${meta ? `<p class="card-meta">${meta}</p>` : ''}
    </div>
    ${starButton(r)}
  </article>`;
}

// ---------------------------------------------------------------------------
// Recipe page
// ---------------------------------------------------------------------------
function recipeHTML(r) {
  const facts = [
    ['Serves', r.serves],
    ['Time', r.time],
    ['From', r.from],
  ].filter(([, v]) => v);

  const scans = r.scans.length
    ? `<section class="block scans">
        <h2>Original ${r.scans.length > 1 ? 'pages' : 'card'}</h2>
        <div class="scan-list">${r.scans
          .map(
            (s, i) => `<figure><a href="${imgSrc(s)}" target="_blank" rel="noopener">
              <img src="${imgSrc(s)}" alt="Original recipe for ${esc(r.title)}${r.scans.length > 1 ? `, page ${i + 1}` : ''}" loading="lazy"></a>
              <figcaption>Tap to open full size</figcaption></figure>`,
          )
          .join('')}</div>
      </section>`
    : '';

  return `
    <div class="recipe-bar">
      <div class="wrap recipe-bar-inner">
        <button type="button" class="back" id="back">${ICON.back}<span>All recipes</span></button>
        ${starButton(r, true)}
      </div>
    </div>

    <article class="wrap recipe">
      <header class="recipe-head">
        <p class="eyebrow">${esc(r.category)}</p>
        <h1>${esc(r.title)}</h1>
        ${r.description ? `<p class="lede">${esc(r.description)}</p>` : ''}
        ${
          facts.length
            ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
            : ''
        }
        <div class="toggles">
          <label class="switch">
            <input type="checkbox" role="switch" id="table-toggle" ${state.tableView ? 'checked' : ''}>
            <span class="track" aria-hidden="true"></span><span>Table view</span>
          </label>
          ${
            'wakeLock' in navigator
              ? `<label class="switch">
                  <input type="checkbox" role="switch" id="wake-toggle">
                  <span class="track" aria-hidden="true"></span><span>Keep screen on</span>
                </label>`
              : ''
          }
        </div>
      </header>

      ${r.image ? `<img class="hero-img" src="${imgSrc(r.image)}" alt="${esc(r.title)}">` : ''}

      <div id="recipe-body"></div>

      ${r.notes ? `<section class="block notes"><h2>Notes</h2>${notesHTML(r.notes)}</section>` : ''}
      ${scans}
      ${
        r.tags.length
          ? `<p class="tags">${r.tags
              .map((t) => `<button type="button" class="tag" data-tag="${esc(t)}">#${esc(t)}</button>`)
              .join('')}</p>`
          : ''
      }
    </article>`;
}

function renderRecipeBody(r) {
  const body = $('#recipe-body');
  body.innerHTML = state.tableView ? tableHTML(r) : standardHTML(r);
  if (state.tableView) {
    const wrap = $('.flow-wrap', body);
    const hint = $('.flow-hint', body);
    hint.hidden = wrap.scrollWidth <= wrap.clientWidth + 1;
    wrap.addEventListener('scroll', () => wrap.classList.toggle('is-scrolled', wrap.scrollLeft > 0), { passive: true });
  }
}

function standardHTML(r) {
  let n = 0;
  const ingredients = r.ingredients
    .map((x) =>
      x.type === 'heading'
        ? `</ul><h3>${esc(x.text)}</h3><ul>`
        : `<li><label><input type="checkbox"><span>${esc(x.text)}</span></label></li>`,
    )
    .join('');
  const steps = [
    ...r.before.map((t) => `<li><span class="num">${++n}</span><p>${esc(t)}</p></li>`),
    ...r.steps.map((s) => `<li><span class="num">${++n}</span><p>${esc(stepText(r, s))}</p></li>`),
  ].join('');

  return `<div class="std">
    <section class="ingredients">
      <h2>Ingredients</h2>
      <ul>${ingredients}</ul>
    </section>
    <section class="method">
      <h2>Steps</h2>
      <ol>${steps}</ol>
    </section>
  </div>`.replace(/<ul><\/ul>/g, '');
}

function tableHTML(r) {
  const { cols, rows, header, cells } = layoutTable(r);
  const byRow = Array.from({ length: rows }, () => []);
  for (const c of cells) byRow[c.row].push(c);

  const td = (c) => {
    const span = `${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}`;
    const cls = { ingredient: 'ing', step: 'act', empty: 'gap' }[c.kind] + (c.col === 0 ? ' c0' : '');
    return `<td class="${cls}"${span}>${esc(c.text)}</td>`;
  };

  const head = header.map((t) => `<tr><td class="pre c0" colspan="${cols}"><span>${esc(t)}</span></td></tr>`).join('');
  const bodyRows = byRow
    .map((rowCells) => `<tr>${rowCells.sort((a, b) => a.col - b.col).map(td).join('')}</tr>`)
    .join('');

  return `<p class="flow-hint" hidden>Swipe sideways for the later steps →</p>
    <div class="flow-wrap">
      <table class="flow" style="--cols:${cols}">
        <caption class="sr-only">Recipe as a table: ingredients on the left, each step to the right of what it combines.</caption>
        <tbody>${head}${bodyRows}</tbody>
      </table>
    </div>`;
}

function notesHTML(text) {
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => /^[-*•]\s/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${esc(lines.join(' '))}</p>`;
    })
    .join('');
}

// Delegated handlers on the (persistent) recipe section: bound once.
function bindRecipeView() {
  $('#recipe').addEventListener('click', (e) => {
    const star = e.target.closest('[data-fav]');
    if (star) toggleFav(star.dataset.fav);
    const tag = e.target.closest('[data-tag]');
    if (tag) {
      state.query = tag.dataset.tag;
      state.filter = 'all';
      store.set('query', state.query, 'sessionStorage');
      store.set('filter', 'all', 'sessionStorage');
      state.homeScroll = 0;
      location.hash = '#/';
    }
  });
}

// Handlers on elements that are re-created with each recipe.
function bindRecipe(r) {
  const view = $('#recipe');

  $('#back', view).addEventListener('click', () => {
    if (state.cameFromHome) history.back();
    else location.hash = '#/';
  });

  $('#table-toggle', view).addEventListener('change', (e) => {
    state.tableView = e.target.checked;
    store.set('tableView', state.tableView);
    renderRecipeBody(r);
  });

  const wake = $('#wake-toggle', view);
  if (wake) wake.addEventListener('change', () => setWake(wake.checked));
}

// ---------------------------------------------------------------------------
// Keep screen on while cooking (Screen Wake Lock API)
// ---------------------------------------------------------------------------
const wake = { lock: null, wanted: false };
async function setWake(on) {
  wake.wanted = on;
  try {
    if (on && !wake.lock && 'wakeLock' in navigator) {
      wake.lock = await navigator.wakeLock.request('screen');
      wake.lock.addEventListener('release', () => (wake.lock = null));
    } else if (!on && wake.lock) {
      await wake.lock.release();
      wake.lock = null;
    }
  } catch {
    wake.wanted = false;
    const t = $('#wake-toggle');
    if (t) t.checked = false;
  }
}
document.addEventListener('visibilitychange', () => {
  if (wake.wanted && document.visibilityState === 'visible') setWake(true);
});

window.addEventListener('resize', () => {
  const wrap = $('.flow-wrap');
  const hint = $('.flow-hint');
  if (wrap && hint) hint.hidden = wrap.scrollWidth <= wrap.clientWidth + 1;
});

init();
