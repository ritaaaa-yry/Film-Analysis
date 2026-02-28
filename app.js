// app.js
// Dashboard skeleton:
// - global filter state (platform, year range, genre, min votes, search)
// - tab navigation
// - per-tab Static/Interactive view toggle
// - data loading from movies_tidy.csv (with demo fallback)

/** ===========================
 *  Utilities
 *  =========================== */

function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function clamp(n, lo, hi) {
  const x = Number.isFinite(n) ? n : lo;
  return Math.max(lo, Math.min(hi, x));
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function toNumber(v) {
  if (v === null || v === undefined) return NaN;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : NaN;
}

// Minimal CSV parser (handles quoted fields).
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') { // escaped quote
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (ch === ',' || ch === '\n' || ch === '\r')) {
      if (ch === ',' ) {
        row.push(cur);
        cur = "";
        continue;
      }
      // newline
      if (ch === '\r' && next === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }

    cur += ch;
  }

  // last cell
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }

  // Remove empty trailing rows
  return rows.filter(r => r.some(cell => String(cell).trim() !== ""));
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(h => String(h).trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj = {};
    header.forEach((h, j) => obj[h] = r[j] ?? "");
    out.push(obj);
  }
  return out;
}

/** ===========================
 *  Global State
 *  =========================== */

const state = {
  dataLoaded: false,
  dataSource: "none",
  // filters
  platform: ["douban", "imdb"],
  yearMin: 1990,
  yearMax: 2025,
  genre: [],
  minVotes: 0,
  search: "",
  // ui
  tab: "overview",
  viewMode: { overview: "static", genre: "static", platform: "static", deepdive: "static" },
};

let movies = []; // canonical array of movie objects (normalized keys)

/** ===========================
 *  Data normalization
 *  ===========================
 * Expected (flexible) columns in movies_tidy.csv:
 * - title / movie_title / name
 * - year / release_year
 * - platform (douban/imdb)
 * - rating / score
 * - votes / num_votes
 * - genre / genres (pipe/comma separated or single value)
 */

function normalizeMovieRow(row) {
  const get = (...keys) => {
    for (const k of keys) {
      if (row[k] !== undefined) return row[k];
      // case-insensitive
      const found = Object.keys(row).find(x => x.toLowerCase() === k.toLowerCase());
      if (found) return row[found];
    }
    return "";
  };

  const title = String(get("title", "movie_title", "name")).trim();
  const year = toNumber(get("year", "release_year"));
  const platform = String(get("platform", "source")).trim().toLowerCase();
  const rating = toNumber(get("rating", "score", "avg_rating", "mean_rating"));
  const votes = toNumber(get("votes", "num_votes", "vote_count", "rating_count"));

  // Parse genre(s)
  const genreRaw = String(get("genre", "genres")).trim();
  const genreList = genreRaw
    ? genreRaw.split(/\s*[|,;/]\s*/g).map(g => g.trim()).filter(Boolean)
    : [];

  return { title, year, platform, rating, votes, genreList, genreRaw };
}

function buildGenreUniverse(data) {
  const all = [];
  data.forEach(d => d.genreList.forEach(g => all.push(g)));
  return uniq(all).sort((a, b) => a.localeCompare(b));
}

function inferYearBounds(data) {
  const ys = data.map(d => d.year).filter(Number.isFinite);
  if (!ys.length) return { min: 1900, max: 2100 };
  return { min: Math.min(...ys), max: Math.max(...ys) };
}

/** ===========================
 *  Filtering
 *  =========================== */

function getActiveFilters() {
  // read UI -> state (but keep sanitization)
  const platformSel = qsa("#platform option").filter(o => o.selected).map(o => o.value);
  state.platform = platformSel.length ? platformSel : [];

  const yMin = clamp(toNumber(qs("#year-min").value), 1900, 2100);
  const yMax = clamp(toNumber(qs("#year-max").value), 1900, 2100);
  state.yearMin = Math.min(yMin, yMax);
  state.yearMax = Math.max(yMin, yMax);

  const genreSel = qsa("#genre option").filter(o => o.selected).map(o => o.value);
  state.genre = genreSel;

  const mv = toNumber(qs("#min-votes").value);
  state.minVotes = Number.isFinite(mv) ? Math.max(0, mv) : 0;

  state.search = String(qs("#search").value || "").trim().toLowerCase();
}

function applyFilters(data) {
  const platSet = new Set(state.platform);
  const genreSet = new Set(state.genre);

  return data.filter(d => {
    if (platSet.size && !platSet.has(d.platform)) return false;
    if (Number.isFinite(d.year)) {
      if (d.year < state.yearMin || d.year > state.yearMax) return false;
    }
    if (Number.isFinite(d.votes) && d.votes < state.minVotes) return false;
    if (state.search) {
      if (!String(d.title).toLowerCase().includes(state.search)) return false;
    }
    if (genreSet.size) {
      // at least one genre matches
      const ok = d.genreList.some(g => genreSet.has(g));
      if (!ok) return false;
    }
    return true;
  });
}

/** ===========================
 *  Rendering
 *  =========================== */

function renderStateView() {
  qs("#state-view").textContent = JSON.stringify({
    tab: state.tab,
    viewMode: state.viewMode[state.tab],
    data: { loaded: state.dataLoaded, source: state.dataSource, n: movies.length },
    filters: {
      platform: state.platform,
      yearMin: state.yearMin,
      yearMax: state.yearMax,
      genre: state.genre,
      minVotes: state.minVotes,
      search: state.search,
    }
  }, null, 2);
}

function renderKPI(filtered) {
  const n = filtered.length;
  const avgRating = (() => {
    const rs = filtered.map(d => d.rating).filter(Number.isFinite);
    if (!rs.length) return null;
    return rs.reduce((a, b) => a + b, 0) / rs.length;
  })();
  const totalVotes = (() => {
    const vs = filtered.map(d => d.votes).filter(Number.isFinite);
    if (!vs.length) return null;
    return vs.reduce((a, b) => a + b, 0);
  })();

  const kpi = qs("#kpi");
  kpi.innerHTML = "";
  kpi.appendChild(kpiCard(n, "Movies (after filters)"));
  kpi.appendChild(kpiCard(avgRating === null ? "—" : avgRating.toFixed(2), "Avg rating"));
  kpi.appendChild(kpiCard(totalVotes === null ? "—" : totalVotes.toLocaleString(), "Total votes"));
}

function kpiCard(value, label) {
  const div = document.createElement("div");
  div.className = "kpi";
  div.innerHTML = `<div class="v">${value}</div><div class="k">${label}</div>`;
  return div;
}

function renderOverviewTable(filtered) {
  const tbody = qs("#overview-table tbody");
  tbody.innerHTML = "";
  const top = [...filtered]
    .sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity))
    .slice(0, 20);

  top.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHTML(d.title)}</td>
      <td>${Number.isFinite(d.year) ? d.year : ""}</td>
      <td>${escapeHTML(d.genreList.join(", "))}</td>
      <td>${escapeHTML(d.platform)}</td>
      <td>${Number.isFinite(d.rating) ? d.rating.toFixed(1) : ""}</td>
      <td>${Number.isFinite(d.votes) ? d.votes.toLocaleString() : ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPlatformTable(filtered) {
  const tbody = qs("#platform-table tbody");
  tbody.innerHTML = "";
  const rows = [...filtered].slice(0, 50);
  rows.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHTML(d.title)}</td>
      <td>${Number.isFinite(d.year) ? d.year : ""}</td>
      <td>${escapeHTML(d.platform)}</td>
      <td>${Number.isFinite(d.rating) ? d.rating.toFixed(1) : ""}</td>
      <td>${Number.isFinite(d.votes) ? d.votes.toLocaleString() : ""}</td>
      <td>${escapeHTML(d.genreList.join(", "))}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDeepDiveTable(filtered) {
  const tbody = qs("#deepdive-table tbody");
  tbody.innerHTML = "";
  const rows = [...filtered].slice(0, 50);
  rows.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHTML(d.title)}</td>
      <td>${Number.isFinite(d.year) ? d.year : ""}</td>
      <td>${escapeHTML(d.platform)}</td>
      <td>${Number.isFinite(d.rating) ? d.rating.toFixed(1) : ""}</td>
      <td>${Number.isFinite(d.votes) ? d.votes.toLocaleString() : ""}</td>
      <td>${escapeHTML(d.genreList.join(", "))}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderGenreTable(filtered) {
  const tbody = qs("#genre-table tbody");
  tbody.innerHTML = "";

  const counts = new Map();
  filtered.forEach(d => {
    d.genreList.forEach(g => counts.set(g, (counts.get(g) ?? 0) + 1));
  });

  const rows = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);

  rows.forEach(([g, c]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHTML(g)}</td><td>${c.toLocaleString()}</td>`;
    tbody.appendChild(tr);
  });
}

function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderAll() {
  getActiveFilters();
  const filtered = applyFilters(movies);

  renderStateView();
  renderKPI(filtered);
  renderOverviewTable(filtered);
  renderGenreTable(filtered);
  renderPlatformTable(filtered);
  renderDeepDiveTable(filtered);
}

/** ===========================
 *  Tabs
 *  =========================== */

function setActiveTab(tab) {
  state.tab = tab;

  qsa(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  qsa(".tab-pane").forEach(pane => {
    pane.classList.toggle("active", pane.id === `tab-${tab}`);
  });

  // Ensure view mode is applied to the newly shown pane
  applyViewMode(tab, state.viewMode[tab]);
  renderStateView();
}

function wireTabs() {
  qsa(".tab").forEach(btn => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });
}

/** ===========================
 *  Static / Interactive view toggle per tab
 *  =========================== */

function applyViewMode(tab, mode) {
  state.viewMode[tab] = mode;

  const pane = qs(`#tab-${tab}`);
  if (!pane) return;

  const showStatic = mode === "static";
  qsa("[data-view='static']", pane).forEach(el => el.style.display = showStatic ? "block" : "none");
  qsa("[data-view='interactive']", pane).forEach(el => el.style.display = showStatic ? "none" : "block");

  // sync switch UI
  const sw = qs(`.view-switch[data-target-tab='${tab}']`);
  if (sw) sw.checked = (mode === "interactive");

  renderStateView();
}

function wireViewToggles() {
  qsa(".view-switch").forEach(sw => {
    sw.addEventListener("change", () => {
      const tab = sw.dataset.targetTab;
      applyViewMode(tab, sw.checked ? "interactive" : "static");
    });
  });
}

/** ===========================
 *  Data loading
 *  =========================== */

async function loadMoviesCSV(path = "Data_merged_cleaned.csv") {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path} (HTTP ${res.status})`);
  }
  const text = await res.text();
  const rows = parseCSV(text);
  const objs = rowsToObjects(rows);
  const normalized = objs.map(normalizeMovieRow).filter(d => d.title);

  return normalized;
}

function populateGenreSelect(genres) {
  const sel = qs("#genre");
  const prev = new Set(qsa("#genre option").filter(o => o.selected).map(o => o.value));

  sel.innerHTML = "";
  genres.forEach(g => {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    opt.selected = prev.has(g);
    sel.appendChild(opt);
  });
}

function syncYearInputs(bounds) {
  const minEl = qs("#year-min");
  const maxEl = qs("#year-max");

  // if user hasn't typed anything meaningful, update to data bounds
  const curMin = toNumber(minEl.value);
  const curMax = toNumber(maxEl.value);

  if (!Number.isFinite(curMin) || curMin === 1990) minEl.value = bounds.min;
  if (!Number.isFinite(curMax) || curMax === 2025) maxEl.value = bounds.max;

  // always update input ranges
  minEl.min = bounds.min;
  maxEl.min = bounds.min;
  minEl.max = bounds.max;
  maxEl.max = bounds.max;
}

async function handleLoadCSV() {
  try {
    setStatus(`Loading Data_merged_cleaned.csv...`);
    const data = await loadMoviesCSV("Data_merged_cleaned.csv");
    movies = data;
    state.dataLoaded = true;
    state.dataSource = "Data_merged_cleaned.csv";

    const genres = buildGenreUniverse(movies);
    populateGenreSelect(genres);

    const bounds = inferYearBounds(movies);
    syncYearInputs(bounds);

    setStatus(`Loaded ${movies.length} movies from Data_merged_cleaned.csv`);
    renderAll();
  } catch (err) {
    console.error(err);
    setStatus(`Could not load Data_merged_cleaned.csv. Use "Load demo" or check filename/path.`);
  }
}

function handleLoadDemo() {
  // Small demo dataset (kept minimal for skeleton)
  movies = [
    { title: "Inception", year: 2010, platform: "imdb", rating: 8.8, votes: 2300000, genreList: ["Sci-Fi", "Action"], genreRaw: "Sci-Fi|Action" },
    { title: "The Dark Knight", year: 2008, platform: "imdb", rating: 9.0, votes: 2800000, genreList: ["Action", "Crime"], genreRaw: "Action|Crime" },
    { title: "Spirited Away", year: 2001, platform: "douban", rating: 9.3, votes: 1900000, genreList: ["Animation", "Fantasy"], genreRaw: "Animation|Fantasy" },
    { title: "Farewell My Concubine", year: 1993, platform: "douban", rating: 9.6, votes: 800000, genreList: ["Drama"], genreRaw: "Drama" },
    { title: "Parasite", year: 2019, platform: "imdb", rating: 8.5, votes: 950000, genreList: ["Thriller", "Drama"], genreRaw: "Thriller|Drama" },
    { title: "Dying to Survive", year: 2018, platform: "douban", rating: 9.0, votes: 1200000, genreList: ["Drama"], genreRaw: "Drama" },
  ];
  state.dataLoaded = true;
  state.dataSource = "demo";
  populateGenreSelect(buildGenreUniverse(movies));
  syncYearInputs(inferYearBounds(movies));
  setStatus(`Loaded demo data (${movies.length} movies)`);
  renderAll();
}

function setStatus(msg) {
  // show quick status in state-view top line (without killing JSON)
  qs("#state-view").textContent = msg;
  // re-render state after a short tick to restore JSON
  setTimeout(renderStateView, 200);
}

/** ===========================
 *  Reset + Wiring
 *  =========================== */

function resetFilters() {
  // Platform
  qsa("#platform option").forEach(o => o.selected = true);

  // Year (keep within bounds if data loaded)
  const bounds = inferYearBounds(movies.length ? movies : [{year:1990},{year:2025}]);
  qs("#year-min").value = bounds.min;
  qs("#year-max").value = bounds.max;

  // Genre
  qsa("#genre option").forEach(o => o.selected = false);

  // Min votes / Search
  qs("#min-votes").value = 0;
  qs("#search").value = "";

  // View modes reset
  Object.keys(state.viewMode).forEach(k => state.viewMode[k] = "static");
  qsa(".view-switch").forEach(sw => sw.checked = false);
  Object.keys(state.viewMode).forEach(tab => applyViewMode(tab, "static"));

  renderAll();
}

function wireFilters() {
  const ids = ["platform", "year-min", "year-max", "genre", "min-votes", "search"];
  ids.forEach(id => {
    const el = qs(`#${id}`);
    if (!el) return;
    el.addEventListener("input", renderAll);
    el.addEventListener("change", renderAll);
  });
}

/** ===========================
 *  Init
 *  =========================== */

function init() {
  wireTabs();
  wireViewToggles();
  wireFilters();

  qs("#btn-reset").addEventListener("click", resetFilters);
  qs("#btn-load-csv").addEventListener("click", handleLoadCSV);
  qs("#btn-load-demo").addEventListener("click", handleLoadDemo);

  // Default: load demo so the UI isn't empty
  handleLoadDemo();

  // Apply view modes to all tabs once
  Object.keys(state.viewMode).forEach(tab => applyViewMode(tab, state.viewMode[tab]));
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
