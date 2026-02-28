// app_v2.js
// Global filter state + tabs + per-page view toggle + CSV loading (default fetch OR file picker).

const els = {
  platform: document.getElementById("platform"),
  yearMin: document.getElementById("year-min"),
  yearMax: document.getElementById("year-max"),
  genre: document.getElementById("genre"),
  minVotes: document.getElementById("min-votes"),
  search: document.getElementById("search"),
  stateView: document.getElementById("state-view"),
  btnReset: document.getElementById("btn-reset"),
  btnLoadDouban: document.getElementById("btn-load-douban"),
  btnLoadIMDB: document.getElementById("btn-load-imdb"),
  btnLoadDemo: document.getElementById("btn-load-demo"),
  fileCsv: document.getElementById("file-csv"),
  kpi: document.getElementById("kpi"),
  overviewTable: document.querySelector("#overview-table tbody"),
  genreTable: document.querySelector("#genre-table tbody"),
  platformTable: document.querySelector("#platform-table tbody"),
  deepdiveTable: document.querySelector("#deepdive-table tbody"),
  dataCount: document.getElementById("data-count"),
};

// --- Global state ---
const state = {
  data: [],
  filters: {
    platforms: new Set(["douban", "imdb"]), // fallback if CSV missing platform values
    yearMin: 1990,
    yearMax: 2025,
    genres: new Set(), // empty = no filter
    minVotes: 0,
    search: "",
  },
  overviewFilters: {
    platforms: new Set(["douban", "imdb"]),
    genres: new Set(),
    search: "",
  },
  overviewSelectedMovieKey: "",
  viewMode: {
    overview: "static",
    genre: "static",
    platform: "static",
    deepdive: "static",
  },
};

// --- Helpers ---
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function toInt(x, fallback = 0) {
  const n = Number.parseInt(String(x), 10);
  return Number.isFinite(n) ? n : fallback;
}
function toFloat(x, fallback = 0) {
  const n = Number.parseFloat(String(x));
  return Number.isFinite(n) ? n : fallback;
}
function toFloatLoose(x, fallback = 0) {
  const s = String(x ?? "").trim();
  if (!s) return fallback;
  const n = Number.parseFloat(s);
  if (Number.isFinite(n)) return n;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const n2 = Number.parseFloat(m[0]);
  return Number.isFinite(n2) ? n2 : fallback;
}
function normStr(x) { return (x ?? "").toString().trim(); }
function normalizePlatform(p) {
  const s = normStr(p).toLowerCase();
  if (!s) return "imdb";
  if (s.includes("douban")) return "douban";
  if (s.includes("imdb")) return "imdb";
  if (s === "unknown") return "imdb";
  return s;
}

function platformLabel(p) {
  const s = normalizePlatform(p);
  if (s === "douban") return "Douban";
  if (s === "imdb") return "IMDb";
  return normStr(p) || "IMDb";
}

function parseGenres(raw) {
  const s = normStr(raw);
  if (!s) return [];
  // 鏀寔锛?"Action|Drama" 鎴?"['Drama', 'Romance']"
  if (s.startsWith("[") && s.endsWith("]")) {
    return s
      .slice(1, -1)
      .split(",")
      .map(x => x.replaceAll("'", "").replaceAll('"', "").trim())
      .filter(Boolean);
  }
  return s
    .split(/[|,\/;]/g)
    .map(d => d.trim())
    .filter(Boolean)
    .filter(d => {
      const x = d.toLowerCase();
      return x !== "nan" && x !== "none" && x !== "null" && x !== "n/a";
    });
}

function selectedOptions(selectEl) {
  return Array.from(selectEl.selectedOptions).map(o => o.value);
}

function setMultiSelectValues(selectEl, valuesSet) {
  Array.from(selectEl.options).forEach(opt => {
    opt.selected = valuesSet.has(opt.value);
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderStateView() {
  els.stateView.textContent = JSON.stringify({
    filters: {
      platforms: [...state.filters.platforms],
      yearMin: state.filters.yearMin,
      yearMax: state.filters.yearMax,
      genres: [...state.filters.genres],
      minVotes: state.filters.minVotes,
      search: state.filters.search,
    },
    data_rows: state.data.length,
    viewMode: state.viewMode,
  }, null, 2);
}

// --- Tabs ---
function initTabs() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      btn.classList.add("active");

      const key = btn.dataset.tab;
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      document.getElementById(`tab-${key}`).classList.add("active");
    });
  });
}

// --- View toggles ---
function initViewToggles() {
  document.querySelectorAll(".toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const scope = btn.dataset.scope;
      const view = btn.dataset.view;
      state.viewMode[scope] = view;

      const group = btn.closest(".view-toggle");
      group.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const tabPane = document.getElementById(`tab-${scope}`);
      tabPane.querySelectorAll("[data-viewpane]").forEach(pane => {
        pane.style.display = (pane.dataset.viewpane === `${scope}-${view}`) ? "" : "none";
      });

      // If Platform Interactive pane became visible, trigger Plotly resize
      if (scope === 'platform' && view === 'interactive') {
        setTimeout(() => {
          const plotDiv = document.getElementById('task1-plot');
          if (plotDiv && window.Plotly && Plotly.Plots && typeof Plotly.Plots.resize === 'function') {
            try { Plotly.Plots.resize(plotDiv); } catch (e) { /* ignore */ }
          }
        }, 150);
      }

      renderStateView();
    });
  });
}

// --- CSV parsing ---
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function pickFieldCI(obj, keys) {
  if (!obj) return "";
  const map = new Map(Object.keys(obj).map(k => [String(k || "").toLowerCase(), k]));
  for (const key of keys) {
    const hit = map.get(String(key || "").toLowerCase());
    if (hit) return obj[hit];
  }
  return "";
}

function movieRowKey(r) {
  return [normStr(r.title), r.year || "", normalizePlatform(r.platform || "")].join("||");
}

function buildOverviewDetailText(r) {
  if (!r) return "Select a movie to view details.";
  const raw = r._raw || {};
  const p = normalizePlatform(r.platform || "");
  const rating = Number.isFinite(r._rating) ? r._rating : (Number.isFinite(r.rating) ? r.rating : 0);
  const lines = [
    `Title: ${normStr(r.title) || "-"}`,
    `Year: ${r.year || "-"}`,
    `Platform: ${platformLabel(p)}`,
    `Rating: ${rating ? rating.toFixed(1) : "-"}`,
    `Genres: ${parseGenres(r.genres).join(", ") || "-"}`
  ];

  if (p === "douban") {
    lines.push(`Rating count: ${pickFieldCI(raw, ["rating_count"]) || "-"}`);
    lines.push(`Reviews count: ${pickFieldCI(raw, ["reviews_count"]) || "-"}`);
    lines.push(`URL: ${pickFieldCI(raw, ["url"]) || "-"}`);
  } else if (p === "imdb") {
    lines.push(`Votes: ${pickFieldCI(raw, ["num_voted_users"]) || "-"}`);
    lines.push(`Director: ${pickFieldCI(raw, ["director_name"]) || "-"}`);
    lines.push(`Country: ${pickFieldCI(raw, ["country"]) || "-"}`);
    lines.push(`Language: ${pickFieldCI(raw, ["language"]) || "-"}`);
    lines.push(`IMDb link: ${pickFieldCI(raw, ["movie_imdb_link"]) || "-"}`);
  }
  return lines.join("\n");
}

function getOverviewMoviePool() {
  const q = normStr(state.overviewFilters.search).toLowerCase();
  const pool = state.data
    .filter(r => normStr(r.title))
    .map(r => {
      const p = normalizePlatform(r.platform || "");
      const strictRawRating = p === "douban"
        ? toFloatLoose(pickFieldCI(r._raw, ["mean_rating"]), NaN)
        : p === "imdb"
          ? toFloatLoose(pickFieldCI(r._raw, ["imdb_score"]), NaN)
          : NaN;
      const rr = Number.isFinite(strictRawRating) && strictRawRating > 0
        ? strictRawRating
        : (Number.isFinite(r.rating) ? r.rating : 0);
      return { ...r, _rating: rr };
    })
    .filter(r => Number.isFinite(r._rating) && r._rating > 0);

  const filtered = q ? pool.filter(r => normStr(r.title).toLowerCase().includes(q)) : pool;
  filtered.sort((a, b) => (b._rating - a._rating) || normStr(a.title).localeCompare(normStr(b.title)));
  return filtered;
}

function renderOverviewDetails() {
  const sel = document.getElementById("overview-movie");
  const panel = document.getElementById("overview-detail");
  if (!sel || !panel) return;
  const rows = getOverviewMoviePool();

  sel.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = rows.length ? "Select a movie to view details" : "No movies found";
  sel.appendChild(placeholder);

  rows.slice(0, 1200).forEach(r => {
    const key = movieRowKey(r);
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${normStr(r.title)} (${r.year || "-"}) [${platformLabel(r.platform)}]`;
    sel.appendChild(opt);
  });

  const hasSelected = rows.some(r => movieRowKey(r) === state.overviewSelectedMovieKey);
  if (!hasSelected) state.overviewSelectedMovieKey = "";
  sel.value = state.overviewSelectedMovieKey;

  const selectedRow = rows.find(r => movieRowKey(r) === state.overviewSelectedMovieKey) || null;
  panel.textContent = buildOverviewDetailText(selectedRow);
}

function parseCsvRecords(text) {
  const src = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (ch === '"') {
      if (inQuotes && src[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n" && !inQuotes) {
      row.push(field);
      field = "";
      if (row.some(v => String(v || "").trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  row.push(field);
  if (row.some(v => String(v || "").trim() !== "")) rows.push(row);
  return rows;
}

function parseCsvText(text, source = null) {
  const records = parseCsvRecords(text);
  if (records.length < 2) return [];

  const header = records[0].map(h => String(h || "").replace(/^\uFEFF/, "").trim());
  const headerLower = new Set(header.map(h => String(h || "").toLowerCase()));
  const inferredSource = source || (
    headerLower.has("mean_rating") ? "douban" :
    headerLower.has("imdb_score") ? "imdb" :
    null
  );
  const rows = [];

  for (let i = 1; i < records.length; i++) {
    const cols = records[i];
    if (!cols || cols.length === 0) continue;
    const obj = {};
    header.forEach((h, idx) => obj[h] = cols[idx] ?? "");

    const src = (inferredSource === "douban" || inferredSource === "imdb") ? inferredSource : null;
    const title = src === "douban"
      ? pickFieldCI(obj, ["title", "name"])
      : src === "imdb"
        ? pickFieldCI(obj, ["movie_title", "title", "name"])
        : pickFieldCI(obj, ["title", "name", "movie_title", "movie_name"]);
    const year = src === "douban"
      ? pickFieldCI(obj, ["year", "release_year"])
      : src === "imdb"
        ? pickFieldCI(obj, ["title_year", "year", "release_year"])
        : pickFieldCI(obj, ["year", "release_year", "title_year"]);

    let platform = "";
    if (src) {
      platform = src;
    } else {
      platform = String(pickFieldCI(obj, ["platform", "source"]) || "");
      if (!platform) {
        const hasIMDbKeys = !!pickFieldCI(obj, ["imdb_score", "num_voted_users", "movie_imdb_link", "director_name"]);
        const hasDoubanKeys = !!pickFieldCI(obj, ["mean_rating", "rating_count", "movie_id", "reviews_count"]);
        if (hasIMDbKeys && !hasDoubanKeys) platform = "imdb";
        else if (hasDoubanKeys && !hasIMDbKeys) platform = "douban";
        else if (pickFieldCI(obj, ["country"])) platform = "imdb";
        else platform = "imdb";
      }
    }

    const rating = src === "douban"
      ? pickFieldCI(obj, ["mean_rating"])
      : src === "imdb"
        ? pickFieldCI(obj, ["imdb_score"])
        : pickFieldCI(obj, ["mean_rating", "imdb_score", "rating", "score", "avg_rating", "average_rating"]);
    const votes = src === "douban"
      ? pickFieldCI(obj, ["rating_count", "votes", "vote_count"])
      : src === "imdb"
        ? pickFieldCI(obj, ["num_voted_users", "votes", "vote_count", "num_votes"])
        : pickFieldCI(obj, ["rating_count", "votes", "vote_count", "num_voted_users", "num_votes"]);
    const genres = pickFieldCI(obj, ["genres", "genre"]);
    const yearNumParsed = toInt(year, 0);
    const yearNum = (yearNumParsed >= 1870 && yearNumParsed <= 2100) ? yearNumParsed : fallbackYearFromRaw(obj);
    const ratingNumParsed = toFloatLoose(rating, NaN);
    const ratingNum = (Number.isFinite(ratingNumParsed) && ratingNumParsed > 0)
      ? ratingNumParsed
      : (src ? 0 : fallbackRatingFromRaw(obj));
    const votesNumParsed = toInt(votes, NaN);
    const votesNum = (Number.isFinite(votesNumParsed) && votesNumParsed >= 0) ? votesNumParsed : fallbackVotesFromRaw(obj);

    const cleanTitle = normStr(title).replace(/\u00A0/g, " ");
    if (!cleanTitle) continue;
    if (!(Number.isFinite(ratingNum) && ratingNum > 0)) continue;

    rows.push({
      title: cleanTitle,
      year: yearNum,
      platform: normalizePlatform(platform),
      genres: normStr(genres),
      rating: ratingNum,
      votes: votesNum,
      _raw: obj,
    });
  }
  return rows;
}

async function fetchCsv(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${path} (HTTP ${res.status})`);
  return await res.text();
}

async function fetchFirstAvailableCsv(paths) {
  let lastErr = null;
  for (const p of paths) {
    try {
      return await fetchCsv(p);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("No CSV source available.");
}

// --- Data + filter options ---
function setData(rows) {
  state.data = rows;
  window.__APP_DATA__ = rows;
  state.overviewFilters = {
    platforms: new Set(["douban", "imdb"]),
    genres: new Set(),
    search: "",
  };
  // Update data count display
  if (els.dataCount) {
    els.dataCount.textContent = rows.length.toLocaleString();
  }
  hydrateFilterOptionsFromData(rows);
  renderAll();
}

function hydrateFilterOptionsFromData(rows) {
  const genreSet = new Set();
  const platformSet = new Set(["douban", "imdb"]);
  let minYear = Infinity, maxYear = -Infinity;

  rows.forEach(r => {
    parseGenres(r.genres).forEach(g => genreSet.add(g));
    if (r.platform) platformSet.add(normalizePlatform(r.platform));
    if (r.year) {
      minYear = Math.min(minYear, r.year);
      maxYear = Math.max(maxYear, r.year);
    }
  });

  // Genres select
  const selected = new Set(state.filters.genres);
  els.genre.innerHTML = "";
  [...genreSet].sort((a,b) => a.localeCompare(b)).forEach(g => {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    opt.selected = selected.has(g);
    els.genre.appendChild(opt);
  });

  // Also populate any other genre selects on the page (genreSelect for wordcloud, task1-genre-select, overview-genre)
  try {
    const populatePlain = (selId, includeAll = false) => {
      const sel = document.getElementById(selId);
      if (!sel) return;
      // clear
      sel.innerHTML = "";
      if (includeAll) {
        const allOpt = document.createElement('option');
        allOpt.value = 'All';
        allOpt.textContent = 'All Genres';
        sel.appendChild(allOpt);
      }
      [...genreSet].sort((a,b) => a.localeCompare(b)).forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        sel.appendChild(opt);
      });
    };

    populatePlain('genreSelect', true);
    populatePlain('task1-genre-select', true);
    populatePlain('overview-genre', false);
    // Populate overview platform select
    const popPlat = () => {
      const sel = document.getElementById('overview-platform');
      if (!sel) return;
      sel.innerHTML = "";
      [...platformSet].sort().forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = platformLabel(p);
        sel.appendChild(opt);
      });
      // restore selected platforms for overview local filters
      try { setMultiSelectValues(sel, state.overviewFilters.platforms); } catch (e) { /* ignore */ }
    };
    popPlat();

    // restore selected genres for overview-genre (multi-select)
    try {
      const ovg = document.getElementById('overview-genre');
      if (ovg) setMultiSelectValues(ovg, state.overviewFilters.genres || new Set());
    } catch (e) { /* ignore */ }
  } catch (e) {
    // ignore if DOM elements aren't present yet
  }

  // Platforms select
  if (platformSet.size) {
    const current = state.filters.platforms.size
      ? new Set(Array.from(state.filters.platforms).map(normalizePlatform))
      : new Set(platformSet);
    els.platform.innerHTML = "";
    [...platformSet].sort().forEach(p => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = platformLabel(p);
      opt.selected = current.has(p);
      els.platform.appendChild(opt);
    });
    state.filters.platforms = current;
  }

  // Year bounds
  if (minYear !== Infinity && maxYear !== -Infinity) {
    state.filters.yearMin = minYear;
    state.filters.yearMax = maxYear;
    els.yearMin.value = String(minYear);
    els.yearMax.value = String(maxYear);
  }

  renderStateView();
}

// --- Overview local controls ---
function initOverviewControls() {
  const plat = document.getElementById("overview-platform");
  const gen = document.getElementById("overview-genre");
  const searchEl = document.getElementById("overview-search");
  const sortEl = document.getElementById("overview-sort");
  const limitEl = document.getElementById("overview-limit");
  const movieEl = document.getElementById("overview-movie");

  // Ensure selects show fallback values before data loads
  try {
    if (plat && plat.options.length === 0) {
      const plats = Array.from(state.overviewFilters.platforms || new Set(["douban", "imdb"]));
      plats.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = platformLabel(p);
        opt.selected = state.overviewFilters.platforms.has(p);
        plat.appendChild(opt);
      });
    }
    if (gen && gen.options.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Loading genres...";
      opt.disabled = true;
      gen.appendChild(opt);
    }
  } catch (e) {
    // ignore
  }

  const syncAndRender = () => {
    if (plat) state.overviewFilters.platforms = new Set(selectedOptions(plat).map(normalizePlatform));
    if (gen) state.overviewFilters.genres = new Set(selectedOptions(gen));
    if (searchEl) state.overviewFilters.search = normStr(searchEl.value);
    renderOverviewTable(getOverviewFilteredData());
    renderOverviewDetails();
  };

  if (plat) plat.addEventListener("change", syncAndRender);
  if (gen) gen.addEventListener("change", syncAndRender);
  if (searchEl) searchEl.addEventListener("input", syncAndRender);
  if (sortEl) sortEl.addEventListener("change", () => renderOverviewTable(getOverviewFilteredData()));
  if (limitEl) {
    limitEl.addEventListener("change", () => renderOverviewTable(getOverviewFilteredData()));
    limitEl.addEventListener("input", () => renderOverviewTable(getOverviewFilteredData()));
  }
  if (movieEl) {
    movieEl.addEventListener("change", () => {
      state.overviewSelectedMovieKey = movieEl.value || "";
      renderOverviewDetails();
    });
  }

  // Reset button for overview filters
  const resetBtn = document.getElementById("overview-reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      state.overviewFilters.platforms = new Set(Array.from(plat?.options || []).map(o => o.value));
      state.overviewFilters.genres = new Set();
      state.overviewFilters.search = "";
      if (plat) setMultiSelectValues(plat, state.overviewFilters.platforms);
      if (gen) setMultiSelectValues(gen, new Set());
      if (searchEl) searchEl.value = "";
      syncAndRender();
    });
  }
}

function getFilteredData() {
  const f = state.filters;
  return state.data.filter(r => {
    if (f.platforms.size && r.platform && !f.platforms.has(r.platform)) return false;
    if (r.year && (r.year < f.yearMin || r.year > f.yearMax)) return false;
    if (r.votes < f.minVotes) return false;

    if (f.genres.size) {
      const gs = parseGenres(r.genres);
      if (!gs.some(g => f.genres.has(g))) return false;
    }

    if (f.search) {
      if (!r.title.toLowerCase().includes(f.search.toLowerCase())) return false;
    }
    return true;
  });
}

function getOverviewFilteredData() {
  const f = state.overviewFilters;
  return state.data.filter(r => {
    if (!normStr(r.title)) return false;
    if (f.platforms.size && r.platform && !f.platforms.has(normalizePlatform(r.platform))) return false;
    if (f.genres.size) {
      const gs = parseGenres(r.genres);
      if (!gs.some(g => f.genres.has(g))) return false;
    }
    if (f.search) {
      if (!String(r.title || "").toLowerCase().includes(f.search.toLowerCase())) return false;
    }
    return true;
  });
}

// --- Render ---
function median(arr) {
  const a = arr.filter(Number.isFinite).slice().sort((x,y) => x-y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
}

function firstNumericField(raw, preferredKeys, validator) {
  if (!raw || typeof raw !== "object") return null;
  for (const k of preferredKeys) {
    if (!(k in raw)) continue;
    const n = toFloat(raw[k], NaN);
    if (Number.isFinite(n) && (!validator || validator(n))) return n;
  }
  return null;
}

function fallbackYearFromRaw(raw) {
  const exact = firstNumericField(
    raw,
    ["year", "title_year", "release_year", "movie_year", "year_released"],
    (n) => n >= 1870 && n <= 2100
  );
  if (Number.isFinite(exact)) return Math.round(exact);
  if (!raw || typeof raw !== "object") return 0;
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k || "").toLowerCase();
    if (!/year|release|date/.test(key)) continue;
    const n = toFloat(v, NaN);
    if (Number.isFinite(n) && n >= 1870 && n <= 2100) return Math.round(n);
  }
  return 0;
}

function fallbackRatingFromRaw(raw) {
  const exact = firstNumericField(
    raw,
    ["mean_rating", "imdb_score", "rating", "score", "avg_rating", "average_rating"],
    (n) => n >= 0 && n <= 10
  );
  if (Number.isFinite(exact)) return exact;
  if (!raw || typeof raw !== "object") return 0;
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k || "").toLowerCase();
    if (!/(rating|score)/.test(key)) continue;
    if (/(count|distribution|votes|review)/.test(key)) continue;
    const n = toFloat(v, NaN);
    if (Number.isFinite(n) && n >= 0 && n <= 10) return n;
  }
  return 0;
}

function fallbackVotesFromRaw(raw) {
  const exact = firstNumericField(
    raw,
    ["num_voted_users", "rating_count", "votes", "vote_count", "useful_vote", "num_votes"],
    (n) => n >= 0
  );
  if (Number.isFinite(exact)) return Math.round(exact);
  if (!raw || typeof raw !== "object") return 0;
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k || "").toLowerCase();
    if (!/(vote|voted|user)/.test(key)) continue;
    const n = toFloat(v, NaN);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return 0;
}

function renderKpis(rows) {
  els.kpi.innerHTML = "";
  const n = rows.length;
  const ratings = rows
    .map(r => (r.rating > 0 ? r.rating : fallbackRatingFromRaw(r._raw)))
    .filter(x => Number.isFinite(x) && x > 0);
  const votesArr = rows
    .map(r => (r.votes > 0 ? r.votes : fallbackVotesFromRaw(r._raw)))
    .filter(x => Number.isFinite(x) && x > 0);
  const avg = ratings.length ? ratings.reduce((s, x) => s + x, 0) / ratings.length : 0;
  const med = ratings.length ? median(ratings) : 0;
  const maxVotes = votesArr.length ? Math.max(...votesArr) : 0;
  const totalVotes = votesArr.length ? votesArr.reduce((s, x) => s + x, 0) : 0;
  const years = rows.map(r => r.year).filter(y => Number.isFinite(y) && y > 0);
  if (!years.length) {
    rows.forEach(r => {
      const y = fallbackYearFromRaw(r._raw);
      if (y > 0) years.push(y);
    });
  }
  const minYear = years.length ? Math.min(...years) : 0;
  const maxYear = years.length ? Math.max(...years) : 0;
  const platforms = new Map();
  rows.forEach(r => {
    const p = normalizePlatform(r.platform || "imdb");
    platforms.set(p, (platforms.get(p) || 0) + 1);
  });
  const platformSummary = [...platforms.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, c]) => `${p.toUpperCase()}:${c.toLocaleString()}`)
    .join(" | ");

  const items = [
    { k: "Data Sources", v: "Douban: Data_merged_cleaned.csv | TMDB IMDB Movies Dataset.csv" },
    { k: "Platforms", v: platformSummary || "DOUBAN / IMDB" },
    { k: "This site can do", v: "Overview stats, review word cloud + translation, platform comparison, collaboration network" },
  ];

  items.forEach(it => {
    const div = document.createElement("div");
    div.className = "kpi";
    div.innerHTML = `<div class="v">${it.v}</div><div class="k">${it.k}</div>`;
    els.kpi.appendChild(div);
  });
}

function renderOverviewTable(rows) {
  // Read overview-specific sort / limit controls if present
  const sortEl = document.getElementById('overview-sort');
  const limitEl = document.getElementById('overview-limit');
  const sortMode = sortEl ? sortEl.value : 'rating_desc';
  const limit = limitEl ? clamp(toInt(limitEl.value, 20), 1, 1000) : 20;

  const enriched = rows.map(r => {
    const p = normalizePlatform(r.platform || "");
    const strictRawRating = p === "douban"
      ? toFloatLoose(pickFieldCI(r._raw, ["mean_rating"]), NaN)
      : p === "imdb"
        ? toFloatLoose(pickFieldCI(r._raw, ["imdb_score"]), NaN)
        : NaN;
    const derivedRating = Number.isFinite(strictRawRating) && strictRawRating > 0
      ? strictRawRating
      : (Number.isFinite(r.rating) && r.rating > 0 ? r.rating : fallbackRatingFromRaw(r._raw));
    return { ...r, _rating: Number.isFinite(derivedRating) ? derivedRating : 0 };
  });

  // Hard constraints for table quality.
  const copy = enriched.filter(r => normStr(r.title) && r._rating > 0);

  if (sortMode === 'rating_desc') copy.sort((a,b) => (b._rating - a._rating) || (b.votes - a.votes));
  else if (sortMode === 'rating_asc') copy.sort((a,b) => (a._rating - b._rating) || (b.votes - a.votes));

  const top = copy.slice(0, limit);
  if (els.overviewTable) {
    if (!top.length) {
      els.overviewTable.innerHTML = `<tr><td colspan="5">No matched movies with valid ratings.</td></tr>`;
      return;
    }
    els.overviewTable.innerHTML = top.map(r => `
      <tr data-movie-key="${escapeHtml(movieRowKey(r))}" style="cursor:pointer;">
        <td>${escapeHtml(r.title)}</td>
        <td>${r.year || ""}</td>
        <td>${platformLabel(r.platform)}</td>
        <td>${escapeHtml(parseGenres(r.genres).join(", "))}</td>
        <td>${(r._rating ?? 0).toFixed(1)}</td>
      </tr>
    `).join("");
    els.overviewTable.querySelectorAll("tr[data-movie-key]").forEach(tr => {
      tr.addEventListener("click", () => {
        const key = tr.getAttribute("data-movie-key") || "";
        state.overviewSelectedMovieKey = key;
        renderOverviewDetails();
      });
    });
  }
}

function renderGenreTable(rows) {
  const counts = new Map();
  rows.forEach(r => parseGenres(r.genres).forEach(g => counts.set(g, (counts.get(g) || 0) + 1)));
  const items = [...counts.entries()].sort((a,b) => b[1] - a[1]);
  els.genreTable.innerHTML = items.map(([g,c]) => `<tr><td>${escapeHtml(g)}</td><td>${c.toLocaleString()}</td></tr>`).join("");
}

function renderMovieTables(rows) {
  const top = rows.slice().sort((a,b) => (b.votes - a.votes) || (b.rating - a.rating)).slice(0, 50);
  const html = top.map(r => `
    <tr>
      <td>${escapeHtml(r.title)}</td>
      <td>${r.year || ""}</td>
      <td>${escapeHtml(r.platform || "")}</td>
      <td>${(r.rating ?? 0).toFixed(1)}</td>
      <td>${(r.votes || 0).toLocaleString()}</td>
      <td>${escapeHtml(parseGenres(r.genres).join(", "))}</td>
    </tr>
  `).join("");
  if (els.platformTable) els.platformTable.innerHTML = html;
  if (els.deepdiveTable) els.deepdiveTable.innerHTML = html;
}

function renderAll() {
  const filtered = getFilteredData();
  renderKpis(state.data);
  renderOverviewTable(getOverviewFilteredData());
  renderOverviewDetails();
  renderGenreTable(filtered);
  renderMovieTables(filtered);
  renderStateView();
}

// --- Filters binding ---
function initFilters() {
  els.platform.addEventListener("change", () => {
    state.filters.platforms = new Set(selectedOptions(els.platform).map(normalizePlatform));
    renderAll();
  });

  const syncYears = () => {
    const min = toInt(els.yearMin.value, state.filters.yearMin);
    const max = toInt(els.yearMax.value, state.filters.yearMax);
    state.filters.yearMin = Math.min(min, max);
    state.filters.yearMax = Math.max(min, max);
    els.yearMin.value = String(state.filters.yearMin);
    els.yearMax.value = String(state.filters.yearMax);
    renderAll();
  };
  els.yearMin.addEventListener("change", syncYears);
  els.yearMax.addEventListener("change", syncYears);

  els.genre.addEventListener("change", () => {
    state.filters.genres = new Set(selectedOptions(els.genre));
    renderAll();
  });

  els.minVotes.addEventListener("input", () => {
    state.filters.minVotes = clamp(toInt(els.minVotes.value, 0), 0, 10_000_000_000);
    renderAll();
  });

  els.search.addEventListener("input", () => {
    state.filters.search = normStr(els.search.value);
    renderAll();
  });

  if (els.btnReset) {
    els.btnReset.addEventListener("click", () => {
      const allPlatforms = new Set(Array.from(els.platform.options).map(o => o.value));
      state.filters.platforms = allPlatforms.size ? allPlatforms : new Set(["douban","imdb"]);
      setMultiSelectValues(els.platform, state.filters.platforms);

      state.filters.genres = new Set();
      Array.from(els.genre.options).forEach(o => o.selected = false);

      state.filters.minVotes = 0;
      els.minVotes.value = "0";
      state.filters.search = "";
      els.search.value = "";

      if (state.data.length) {
        let minY = Infinity, maxY = -Infinity;
        state.data.forEach(r => {
          if (r.year) { minY = Math.min(minY, r.year); maxY = Math.max(maxY, r.year); }
        });
        if (minY !== Infinity) {
          state.filters.yearMin = minY; state.filters.yearMax = maxY;
          els.yearMin.value = String(minY);
          els.yearMax.value = String(maxY);
        }
      }
      renderAll();
    });
  }
}

// --- Data loading ---
function demoData() {
  return [
    { title: "Inception", year: 2010, genres: "Action|Sci-Fi", platform: "imdb", rating: 8.8, votes: 2400000 },
    { title: "Interstellar", year: 2014, genres: "Adventure|Drama|Sci-Fi", platform: "imdb", rating: 8.7, votes: 1900000 },
    { title: "Farewell My Concubine", year: 1993, genres: "Drama|Romance", platform: "douban", rating: 9.6, votes: 900000 },
    { title: "Dune", year: 2021, genres: "Sci-Fi|Adventure", platform: "imdb", rating: 8.0, votes: 900000 },
  ];
}

function initDataButtons() {
  els.btnLoadDemo.addEventListener("click", () => setData(demoData()));

  // Load Douban CSV
  els.btnLoadDouban.addEventListener("click", async () => {
    try {
      const text = await fetchFirstAvailableCsv(["EData_merged_cleaned.csv", "Data_merged_cleaned.csv"]);
      const rows = parseCsvText(text, 'douban');
      if (!rows.length) return alert("Douban CSV loaded, but no rows parsed. Check the file.");
      setData(rows);
      console.log(`鉁?Loaded Douban data: ${rows.length} movies`);
    } catch (e) {
      console.error(e);
      alert("Failed to load Douban CSV. Make sure 'Data_merged_cleaned.csv' exists.\n\nIf using file:// protocol, use file picker instead.");
    }
  });

  // Load IMDB CSV
  els.btnLoadIMDB.addEventListener("click", async () => {
    try {
      const text = await fetchCsv("IMDB-movie_metadata.csv");
      const rows = parseCsvText(text, 'imdb');
      if (!rows.length) return alert("IMDB CSV loaded, but no rows parsed. Check the file.");
      setData(rows);
      console.log(`鉁?Loaded IMDB data: ${rows.length} movies`);
    } catch (e) {
      console.error(e);
      alert("Failed to load IMDB CSV. Make sure 'IMDB-movie_metadata.csv' exists.\n\nIf using file:// protocol, use file picker instead.");
    }
  });

  // CSV file picker (works with file://)
  els.fileCsv.addEventListener("change", async () => {
    const file = els.fileCsv.files?.[0];
    if (!file) return;
    const text = await file.text();
    
    // Auto-detect source from filename
    let source = null;
    const filename = file.name.toLowerCase();
    if (filename.includes('douban') || filename.includes('data_merged_cleaned')) source = 'douban';
    else if (filename.includes('imdb')) source = 'imdb';
    
    const rows = parseCsvText(text, source);
    if (!rows.length) return alert("No rows parsed from the selected CSV. Check headers/format.");
    setData(rows);
  });
};

// --- Init ---
async function init() {
  initTabs();
  initViewToggles();
  initFilters();
  initOverviewControls();
  initDataButtons();
  
  // Try to load and merge both CSVs
  const allRows = [];
  
  // Load Douban data
  try {
    const text = await fetchFirstAvailableCsv(["EData_merged_cleaned.csv", "Data_merged_cleaned.csv"]);
    const rows = parseCsvText(text, 'douban');
    if (rows.length) {
      allRows.push(...rows);
      console.log(`鉁?Loaded Douban data: ${rows.length} movies`);
    }
  } catch (e) {
    console.log("Douban CSV auto-load failed (expected with file:// protocol).");
  }
  
  // Load IMDB data
  try {
    const text = await fetchCsv("IMDB-movie_metadata.csv");
    const rows = parseCsvText(text, 'imdb');
    if (rows.length) {
      allRows.push(...rows);
      console.log(`鉁?Loaded IMDB data: ${rows.length} movies`);
    }
  } catch (e) {
    console.log("IMDB CSV auto-load failed (expected with file:// protocol).");
  }
  
  // If we loaded any data from either source, use it
  if (allRows.length) {
    setData(allRows);
    console.log(`鉁?Total movies loaded: ${allRows.length}`);
    return;
  }
  
  // Fallback to demo data
  console.log("CSV auto-load failed for both sources. Using demo data. Click 'Load Douban' or 'Load IMDB' buttons to load real data.");
  setData(demoData());
}
init();

