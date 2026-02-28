/*
  Revenue Explorer (Bubble chart, animated) — TMDB/IMDB CSV version
  - x: avg budget (per year, per genre)  [log scale]
  - y: avg revenue (per year, per genre) [from "revenue" column]
  - bubble size: avg imdb_score (per year, per genre) — contrast-enhanced (monotonic)
  - bubble color: genre (top 10 genres by film count, within 2001–2024)
  - slider/play: year (2001–2024), with large grey year watermark

  Data loading:
  1) Tries globals: window.__MOVIES_FOR_REVENUE / window.movies / window.allMovies / window.APP.movies
  2) If not found, fetch+parse CSV: "TMDB  IMDB Movies Dataset.csv" (no external libs required)

  Notes:
  - Multi-genre films contribute to each listed genre.
  - If your dataset uses different column names, adjust FIELD_MAP below.
*/

(function () {
  'use strict';

  // ------------------------
  // Field mapping (edit if needed)
  // ------------------------
  const FIELD_MAP = {
    year: ['title_year', 'year', 'release_year', 'release_date', 'Year', 'YEAR'],
    genres: ['genres', 'genre', 'Genre', 'Genres'],
    revenue: ['revenue', 'Revenue', 'box_office', 'BoxOffice', 'gross', 'Gross'], // prioritize revenue if present
    budget: ['budget', 'Budget'],
    imdb_score: ['averageRating', 'imdb_score', 'IMDb_score', 'imdbRating', 'rating', 'score', 'vote_average']
  };

  const CSV_URL = 'TMDB  IMDB Movies Dataset.csv';

  const YEAR_MIN = 2001;
  const YEAR_MAX = 2023;
  const TOP_N_GENRES = 10;

  // x-axis log range: ~1M to 120M
  const X_RANGE = [0, 100000000];

  // ------------------------
  // Helpers
  // ------------------------
  function firstExistingKey(obj, candidates) {
    if (!obj) return null;
    for (const k of candidates) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) return k;
    }
    // case-insensitive fallback
    const lower = Object.keys(obj).reduce((m, k) => (m[k.toLowerCase()] = k, m), {});
    for (const k of candidates) {
      const hit = lower[String(k).toLowerCase()];
      if (hit) return hit;
    }
    return null;
  }

  function toNumber(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    const s = String(v).trim();
    if (!s) return NaN;
    const cleaned = s.replace(/[$,]/g, '').replace(/\s+/g, '');
    const n = Number(cleaned);
    return isFinite(n) ? n : NaN;
  }

  function toYear(v) {
    if (v === null || v === undefined) return NaN;
    // allow YYYY-MM-DD
    if (typeof v === 'string') {
      const m = v.match(/(\d{4})/);
      if (m) {
        const y = Number(m[1]);
        return (isFinite(y) && y >= 1870 && y <= 2100) ? y : NaN;
      }
    }
    const n = toNumber(v);
    const y = Math.trunc(n);
    if (!isFinite(y)) return NaN;
    if (y < 1870 || y > 2100) return NaN;
    return y;
  }

  function splitGenres(v) {
    if (v === null || v === undefined) return [];
    if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
    const s = String(v).trim();
    if (!s) return [];
    return s
      .split(/\||,|\/|;|\uFF0C|\u3001/g)
      .map(t => t.trim())
      .filter(Boolean);
  }

  function formatCompact(n) {
    if (!isFinite(n)) return 'NA';
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return String(Math.round(n));
  }

  function showWarning(msg) {
    const el = document.getElementById('revenue-warning');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }

  function hideWarning() {
    const el = document.getElementById('revenue-warning');
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
  }

  function yearWatermark(yearText) {
    return {
      text: String(yearText),
      xref: 'paper',
      yref: 'paper',
      x: 0.5,
      y: 0.5,
      showarrow: false,
      font: { size: 140, color: 'rgba(120,120,120,0.20)' }
    };
  }

  // ------------------------
  // CSV parsing (handles quoted fields with commas)
  // ------------------------
  function parseCSV(text) {
    const rows = [];
    let i = 0, field = '', row = [];
    let inQuotes = false;

    function pushField() {
      row.push(field);
      field = '';
    }
    function pushRow() {
      // ignore completely empty trailing line
      if (row.length === 1 && row[0] === '') { row = []; return; }
      rows.push(row);
      row = [];
    }

    while (i < text.length) {
      const c = text[i];

      if (inQuotes) {
        if (c === '"') {
          // escaped quote
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          } else {
            inQuotes = false;
            i += 1;
            continue;
          }
        } else {
          field += c;
          i += 1;
          continue;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
          i += 1;
          continue;
        }
        if (c === ',') {
          pushField();
          i += 1;
          continue;
        }
        if (c === '\n') {
          pushField();
          pushRow();
          i += 1;
          continue;
        }
        if (c === '\r') {
          // handle CRLF
          if (text[i + 1] === '\n') i += 2;
          else i += 1;
          pushField();
          pushRow();
          continue;
        }
        field += c;
        i += 1;
      }
    }
    // last field/row
    pushField();
    pushRow();

    if (!rows.length) return [];

    const header = rows[0].map(h => String(h || '').trim());
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const arr = rows[r];
      if (!arr || !arr.length) continue;
      const obj = {};
      for (let c = 0; c < header.length; c++) {
        const key = header[c] || `col_${c}`;
        obj[key] = (c < arr.length) ? arr[c] : null;
      }
      out.push(obj);
    }
    return out;
  }

  // ------------------------
  // Data acquisition (best-effort)
  // ------------------------
  function getMoviesFromGlobal() {
    return (
      window.__MOVIES_FOR_REVENUE ||
      window.__MOVIES ||
      window.movies ||
      window.allMovies ||
      (window.APP && window.APP.movies) ||
      null
    );
  }

  async function loadCsvViaFetch(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch ' + url);
    const text = await res.text();
    return parseCSV(text);
  }

  // ------------------------
  // Aggregation (per year, per genre)
  // ------------------------
  function buildAggregates(movies) {
    if (!Array.isArray(movies) || movies.length === 0) {
      return { years: [], topGenres: [], byYearGenre: new Map(), meta: { missing: true } };
    }

    const sample = movies.find(r => r && typeof r === 'object') || {};
    const kYear = firstExistingKey(sample, FIELD_MAP.year);
    const kGenres = firstExistingKey(sample, FIELD_MAP.genres);
    const kRevenue = firstExistingKey(sample, FIELD_MAP.revenue);
    const kBudget = firstExistingKey(sample, FIELD_MAP.budget);
    const kScore = firstExistingKey(sample, FIELD_MAP.imdb_score);

    const missing = [];
    if (!kYear) missing.push('year');
    if (!kGenres) missing.push('genres');
    if (!kRevenue) missing.push('revenue');
    if (!kBudget) missing.push('budget');
    if (!kScore) missing.push('imdb_score');

    if (missing.length) {
      return {
        years: [],
        topGenres: [],
        byYearGenre: new Map(),
        meta: {
          missing: true,
          missingFields: missing,
          detected: { kYear, kGenres, kRevenue, kBudget, kScore }
        }
      };
    }

    const genreCounts = new Map();
    const byYearGenre = new Map();
    const yearsSet = new Set();

    for (const row of movies) {
      if (!row || typeof row !== 'object') continue;
      const year = toYear(row[kYear]);
      if (!isFinite(year) || year < YEAR_MIN || year > YEAR_MAX) continue;

      const gList = splitGenres(row[kGenres]);
      if (!gList.length) continue;

      const revenue = toNumber(row[kRevenue]);
      const budget = toNumber(row[kBudget]);
      const score = toNumber(row[kScore]);

      let yMap = byYearGenre.get(year);
      if (!yMap) { yMap = new Map(); byYearGenre.set(year, yMap); }
      yearsSet.add(year);

      for (const genre of gList) {
        genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);

        let a = yMap.get(genre);
        if (!a) {
          a = { sumRevenue: 0, nRevenue: 0, sumBudget: 0, nBudget: 0, sumScore: 0, nScore: 0, nMovies: 0 };
          yMap.set(genre, a);
        }

        a.nMovies += 1;

        if (isFinite(revenue)) { a.sumRevenue += revenue; a.nRevenue += 1; }
        if (isFinite(budget)) { a.sumBudget += budget; a.nBudget += 1; }
        if (isFinite(score)) { a.sumScore += score; a.nScore += 1; }
      }
    }

    const years = Array.from(yearsSet).sort((a, b) => a - b);
    const topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N_GENRES)
      .map(([g]) => g);

    return { years, topGenres, byYearGenre, meta: { missing: false } };
  }

  // ------------------------
  // Size mapping (contrast enhanced, monotonic)
  // ------------------------
  function buildSizeMapper(byYearGenre, years, topGenres) {
    const scores = [];
    for (const y of years) {
      const yMap = byYearGenre.get(y);
      if (!yMap) continue;
      for (const g of topGenres) {
        const a = yMap.get(g);
        if (!a || !a.nScore) continue;
        const avgScore = a.sumScore / a.nScore;
        if (isFinite(avgScore)) scores.push(avgScore);
      }
    }
    const minS = scores.length ? Math.min(...scores) : 0;
    const maxS = scores.length ? Math.max(...scores) : 10;
    const eps = 1e-9;

    return function scoreToDiameter(score) {
      if (!isFinite(score)) return 10;
      const denom = Math.max(maxS - minS, eps);
      let norm = (score - minS) / denom;
      norm = Math.min(1, Math.max(0, norm));

      // >1 stretches differences (without making all circles uniformly bigger)
      const emph = Math.pow(norm, 2.2);
      return 16 + emph * 104; // keep same overall diameter range
    };
  }

  // ------------------------
  // Plotly rendering (10 traces = 10 genres, with legend on right)
  // ------------------------
  function renderBubble(agg) {
    const target = document.getElementById('revenue-bubble');
    if (!target) return;

    const { years, topGenres, byYearGenre } = agg;

    if (!years.length || !topGenres.length) {
      showWarning('No usable rows for Revenue Explorer (need year 2001–2024, genres, revenue, budget, imdb_score).');
      return;
    }
    hideWarning();

    if (typeof Plotly === 'undefined') {
      showWarning('Plotly is not loaded. Please include Plotly on the page (plotly.min.js).');
      return;
    }

    const scoreToDiameter = buildSizeMapper(byYearGenre, years, topGenres);

    function pointFor(year, genre) {
      const yMap = byYearGenre.get(year);
      const a = yMap ? yMap.get(genre) : null;
      if (!a) return null;

      const avgRevenue = a.nRevenue ? a.sumRevenue / a.nRevenue : NaN;
      const avgBudget = a.nBudget ? a.sumBudget / a.nBudget : NaN;
      const avgScore = a.nScore ? a.sumScore / a.nScore : NaN;

      if (!isFinite(avgRevenue) || !isFinite(avgBudget) || avgBudget <= 0) return null;

      const size = scoreToDiameter(avgScore);
      const hover =
        `<b>${genre}</b><br>` +
        `Year: ${year}<br>` +
        `Avg Budget: ${formatCompact(avgBudget)}<br>` +
        `Avg Revenue: ${formatCompact(avgRevenue)}<br>` +
        `Avg IMDb score: ${isFinite(avgScore) ? avgScore.toFixed(2) : 'NA'}<br>` +
        `Movies (genre contributions): ${a.nMovies}`;

      return { x: avgBudget, y: avgRevenue, size, hover };
    }

    function frameData(year) {
      return topGenres.map((genre) => {
        const p = pointFor(year, genre);
        if (!p) return { x: [], y: [], size: [], text: [] };
        return { x: [p.x], y: [p.y], size: [p.size], text: [p.hover] };
      });
    }

    const y0 = years[0];
    const d0 = frameData(y0);

    const traces = topGenres.map((genre, i) => ({
      type: 'scatter',
      mode: 'markers',
      name: genre,
      x: d0[i].x,
      y: d0[i].y,
      text: d0[i].text,
      hovertemplate: '%{text}<extra></extra>',
      marker: {
        size: d0[i].size,
        sizemode: 'diameter',
        sizemin: 6,
        opacity: 0.85,
        line: { width: 0.6, color: 'rgba(0,0,0,0.25)' }
      }
    }));

    const frames = years.map((yy) => {
      const dd = frameData(yy);
      return {
        name: String(yy),
        data: topGenres.map((_, i) => ({
          x: dd[i].x,
          y: dd[i].y,
          text: dd[i].text,
          marker: { size: dd[i].size }
        })),
        layout: { annotations: [yearWatermark(String(yy))] }
      };
    });

    const sliderSteps = years.map((yy) => ({
      label: String(yy),
      method: 'animate',
      args: [[String(yy)], { mode: 'immediate', transition: { duration: 250 }, frame: { duration: 650, redraw: true } }]
    }));

    const layout = {
      title: { text: 'Revenue Explorer: Avg Revenue vs Avg Budget (Top 10 Genres)', x: 0.02 },
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      margin: { l: 80, r: 220, t: 70, b: 95 },
      xaxis: {
        title: 'Average Budget',
        tickformat: '~s',
        autorange: false,
        range: X_RANGE,
        range: [0, 80000000],
        gridcolor: 'rgba(0,0,0,0.08)',
        zerolinecolor: 'rgba(0,0,0,0.15)'
      },
      yaxis: {
        title: 'Average Revenue',
        tickformat: '~s',
        autorange: false,
        range: [0, 250000000],
        gridcolor: 'rgba(0,0,0,0.08)',
        zerolinecolor: 'rgba(0,0,0,0.15)'
      },
      hovermode: 'closest',
      legend: {
        title: { text: 'Genre (Top 10)' },
        x: 1.02,
        y: 1,
        xanchor: 'left',
        yanchor: 'top',
        bgcolor: 'rgba(255,255,255,0.85)',
        bordercolor: 'rgba(0,0,0,0.08)',
        borderwidth: 1
      },
      annotations: [yearWatermark(String(y0))],
      updatemenus: [
        {
          type: 'buttons',
          direction: 'left',
          x: 0.02,
          y: -0.18,
          xanchor: 'left',
          yanchor: 'top',
          pad: { r: 10, t: 10 },
          showactive: false,
          buttons: [
            {
              label: '▶ Play',
              method: 'animate',
              args: [null, { fromcurrent: true, transition: { duration: 250 }, frame: { duration: 700, redraw: true } }]
            },
            {
              label: '⏸ Pause',
              method: 'animate',
              args: [[null], { mode: 'immediate', transition: { duration: 0 }, frame: { duration: 0, redraw: false } }]
            }
          ]
        }
      ],
      sliders: [
        {
          active: 0,
          x: 0.12,
          y: -0.18,
          xanchor: 'left',
          yanchor: 'top',
          len: 0.86,
          pad: { t: 10, b: 10 },
          currentvalue: { prefix: 'Year: ', visible: true, xanchor: 'right' },
          steps: sliderSteps
        }
      ]
    };

    const config = { responsive: true, displayModeBar: true, displaylogo: false };

    Plotly.newPlot(target, traces, layout, config).then(() => {
      Plotly.addFrames(target, frames);
    });
  }

  // ------------------------
  // Init when tab is opened
  // ------------------------
  let initialized = false;
  let lastDataHash = '';

  function hashDataShape(movies) {
    if (!Array.isArray(movies)) return 'null';
    const n = movies.length;
    const keys = movies[0] && typeof movies[0] === 'object'
      ? Object.keys(movies[0]).slice(0, 20).join('|')
      : 'nokeys';
    return `${n}:${keys}`;
  }

  async function ensureInit() {
    const container = document.getElementById('revenue-bubble');
    if (!container) return;
    if (container.dataset.loading === '1') return;

    let movies = getMoviesFromGlobal();

    if (!movies) {
      try {
        container.dataset.loading = '1';
        movies = await loadCsvViaFetch(CSV_URL);
      } catch (e) {
        showWarning(
          'Revenue Explorer could not find loaded data. ' +
          'Either (1) load your CSV in the main app and call window.initRevenueExplorer(rows), ' +
          'or (2) place "' + CSV_URL + '" next to your HTML. ' +
          'Details: ' + (e && e.message ? e.message : String(e))
        );
        return;
      } finally {
        container.dataset.loading = '0';
      }
    }

    const h = hashDataShape(movies);
    if (initialized && h === lastDataHash) return;
    lastDataHash = h;
    initialized = true;

    const agg = buildAggregates(movies);
    if (agg.meta && agg.meta.missing) {
      const miss = agg.meta.missingFields || [];
      const detected = agg.meta.detected || {};
      showWarning(
        `Revenue Explorer needs fields: year, genres, revenue, budget, imdb_score. Missing: ${miss.join(', ')}. ` +
        `Detected keys (if any): year=${detected.kYear || '-'}, genres=${detected.kGenres || '-'}, revenue=${detected.kRevenue || '-'}, budget=${detected.kBudget || '-'}, imdb_score=${detected.kScore || '-'}.`
      );
      return;
    }

    renderBubble(agg);
  }

  function hookTabClicks() {
    const btn = document.querySelector('button.tab[data-tab="revenue"]');
    if (!btn) {
      setTimeout(() => ensureInit(), 80);
      return;
    }
    btn.addEventListener('click', () => {
      setTimeout(() => ensureInit(), 50);
    });
  }

  // Allow main app to push data updates
  window.initRevenueExplorer = function (movies) {
    window.__MOVIES_FOR_REVENUE = movies;
    const pane = document.getElementById('tab-revenue');
    if (pane && pane.classList.contains('active')) {
      ensureInit();
    }
  };

  window.addEventListener('moviesDataLoaded', (e) => {
    if (e && e.detail && Array.isArray(e.detail.movies)) {
      window.__MOVIES_FOR_REVENUE = e.detail.movies;
      const pane = document.getElementById('tab-revenue');
      if (pane && pane.classList.contains('active')) ensureInit();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookTabClicks);
  } else {
    hookTabClicks();
  }
})();