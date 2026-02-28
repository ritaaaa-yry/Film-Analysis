// task2.js - Platform Explorer Task2
// Requirements:
// 1) Douban line uses Data_merged_cleaned.csv mean_rating (aggregated by year+genre)
// 2) Year range fixed to 2010-2020
// 3) Chart centered + smaller height so it fits the page (avoid being cut off)

const TASK2_YEAR_MIN = 2010;
const TASK2_YEAR_MAX = 2020;

// -------------------------
// Fetch helpers
// -------------------------
async function fetchFirstAvailableText(paths) {
  let lastErr = null;
  for (const p of paths) {
    try {
      const res = await fetch(p, { cache: "no-store" });
      if (!res.ok) continue;
      return await res.text();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("No source available.");
}

// Robust CSV parser (quotes supported)
function parseCsvRecords(text) {
  const src = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (ch === '"') {
      if (inQuotes && src[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) { row.push(field); field = ""; continue; }
    if (ch === "\n" && !inQuotes) {
      row.push(field); field = "";
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

function rowsToObjects(records) {
  if (!records || records.length < 2) return [];
  const header = records[0].map(h => String(h || "").replace(/^\uFEFF/, "").trim());
  const out = [];
  for (let i = 1; i < records.length; i++) {
    const r = records[i];
    const obj = {};
    header.forEach((h, j) => obj[h] = r[j] ?? "");
    out.push(obj);
  }
  return out;
}

function toFloatLoose(x) {
  const s = String(x ?? "").trim();
  if (!s) return NaN;
  const n = Number.parseFloat(s);
  if (Number.isFinite(n)) return n;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number.parseFloat(m[0]) : NaN;
}

function toIntLoose(x) {
  const s = String(x ?? "").trim();
  if (!s) return NaN;
  const n = Number.parseInt(s, 10);
  if (Number.isFinite(n)) return n;
  const m = s.match(/-?\d+/);
  return m ? Number.parseInt(m[0], 10) : NaN;
}

function yearFromReleaseDate(releaseDate) {
  const s = String(releaseDate ?? "").trim();
  const m = s.match(/^(\d{4})/); // YYYY or YYYY-MM-DD
  if (!m) return NaN;
  const y = Number(m[1]);
  return (y >= 1870 && y <= 2100) ? y : NaN;
}

// -------------------------
// Douban from Data_merged_cleaned.csv (mean_rating)
// -------------------------
function splitGenresSlash(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  // Data_merged_cleaned.csv uses: "Drama / Action / Adventure"
  return s.split("/").map(x => x.trim()).filter(Boolean);
}

function buildDoubanLookupFromDataMerged(objs) {
  // key = `${year}||${genre}` -> avg(mean_rating)
  const acc = new Map();

  for (const o of objs) {
    const year = toIntLoose(o.year);
    if (!Number.isFinite(year)) continue;
    if (year < TASK2_YEAR_MIN || year > TASK2_YEAR_MAX) continue;

    const meanRating = toFloatLoose(o.mean_rating);
    if (!Number.isFinite(meanRating)) continue;

    const genres = splitGenresSlash(o.genres);
    if (!genres.length) continue;

    for (const g of genres) {
      const key = `${year}||${g}`;
      if (!acc.has(key)) acc.set(key, { sum: 0, n: 0 });
      const a = acc.get(key);
      a.sum += meanRating;
      a.n += 1;
    }
  }

  const lookup = new Map();
  for (const [k, v] of acc.entries()) {
    if (v.n > 0) lookup.set(k, v.sum / v.n);
  }
  return lookup;
}

// -------------------------
// IMDb from TMDB  IMDB Movies Dataset.csv (averageRating)
// -------------------------
function splitGenresComma(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  // TMDB  IMDB Movies Dataset.csv uses: "Action, Science Fiction, Adventure"
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

function buildImdbLookupFromTmdbImdbCsv(objs) {
  // key = `${year}||${genre}` -> avg(averageRating)
  const acc = new Map();

  for (const o of objs) {
    const year = yearFromReleaseDate(o.release_date);
    if (!Number.isFinite(year)) continue;
    if (year < TASK2_YEAR_MIN || year > TASK2_YEAR_MAX) continue;

    const imdb = toFloatLoose(o.averageRating); // ✅ IMDb rating
    if (!Number.isFinite(imdb)) continue;

    const genres = splitGenresComma(o.genres);
    if (!genres.length) continue;

    for (const g of genres) {
      const key = `${year}||${g}`;
      if (!acc.has(key)) acc.set(key, { sum: 0, n: 0 });
      const a = acc.get(key);
      a.sum += imdb;
      a.n += 1;
    }
  }

  const lookup = new Map();
  for (const [k, v] of acc.entries()) {
    if (v.n > 0) lookup.set(k, v.sum / v.n);
  }
  return lookup;
}

// -------------------------
// Load + merge into Task2 rows
// -------------------------
async function loadTask2Data() {
  // Douban from Data_merged_cleaned.csv
  const doubanCsvCandidates = [
    "Data_merged_cleaned.csv",
    "data_merged_cleaned.csv"
  ];
  const doubanText = await fetchFirstAvailableText(doubanCsvCandidates);
  const doubanObjs = rowsToObjects(parseCsvRecords(doubanText));
  const doubanLookup = buildDoubanLookupFromDataMerged(doubanObjs);

  // IMDb from TMDB  IMDB Movies Dataset.csv
  const imdbCsvCandidates = [
    "TMDB  IMDB Movies Dataset.csv",
    "TMDB%20%20IMDB%20Movies%20Dataset.csv",
    "TMDB_IMDB_Movies_Dataset.csv"
  ];
  const imdbText = await fetchFirstAvailableText(imdbCsvCandidates);
  const imdbObjs = rowsToObjects(parseCsvRecords(imdbText));
  const imdbLookup = buildImdbLookupFromTmdbImdbCsv(imdbObjs);

  // Merge by (year, genre)
  const out = [];
  for (let y = TASK2_YEAR_MIN; y <= TASK2_YEAR_MAX; y++) {
    // We only include genres that exist in BOTH lookups for this year
    // Build the union of keys for this year from doubanLookup, then check imdbLookup
    // (simple scan over doubanLookup keys)
  }

  for (const [key, dval] of doubanLookup.entries()) {
    const [ys, genre] = key.split("||");
    const year = Number(ys);
    if (!Number.isFinite(year)) continue;
    if (year < TASK2_YEAR_MIN || year > TASK2_YEAR_MAX) continue;

    const ival = imdbLookup.get(key);
    if (!Number.isFinite(ival)) continue;

    const diff = dval - ival;
    out.push({
      year,
      genre,
      douban: dval,
      imdb: ival,
      diff,
      abs_diff: Math.abs(diff),
      n: null
    });
  }

  return out;
}

// -------------------------
// Existing chart logic (mostly unchanged)
// -------------------------
function byYear(data) {
  const m = new Map();
  for (const r of data) {
    const yr = Number(r.year);
    if (!Number.isFinite(yr)) continue;
    if (yr < TASK2_YEAR_MIN || yr > TASK2_YEAR_MAX) continue;

    const row = {
      year: yr,
      genre: String(r.genre),
      douban: Number(r.douban),
      imdb: Number(r.imdb),
      diff: Number(r.diff),
      abs_diff: Number(r.abs_diff),
      n: r.n === null || r.n === undefined ? null : Number(r.n)
    };

    if (!row.genre) continue;
    if (!Number.isFinite(row.douban) || !Number.isFinite(row.imdb)) continue;
    if (!Number.isFinite(row.abs_diff)) continue;

    if (!m.has(yr)) m.set(yr, []);
    m.get(yr).push(row);
  }
  return m;
}

function pickTopAndBottom(rows, k = 5) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const sorted = [...safeRows].sort((a, b) => b.abs_diff - a.abs_diff);

  if (sorted.length <= k * 2) return sorted;

  const top = sorted.slice(0, k);
  const bottom = sorted.slice(-k).sort((a, b) => a.abs_diff - b.abs_diff);
  return [...top, ...bottom];
}

function makeFigure(year, rows) {
  const picked = pickTopAndBottom(rows, 5);

  const genres = picked.map((r) => r.genre);
  const doubanY = picked.map((r) => r.douban);
  const imdbY = picked.map((r) => r.imdb);

  const doubanCustom = picked.map((r) => [r.imdb, r.diff, r.n, r.year, r.genre, r.abs_diff]);
  const imdbCustom = picked.map((r) => [r.douban, r.diff, r.n, r.year, r.genre, r.abs_diff]);

  const traceDouban = {
    type: "scatter",
    mode: "lines+markers",
    name: "Douban",
    x: genres,
    y: doubanY,
    line: { width: 3 },
    marker: { size: 9 },
    customdata: doubanCustom,
    hovertemplate:
      "Year: %{customdata[3]}<br>" +
      "Genre: %{customdata[4]}<br>" +
      "Douban: %{y:.2f}<br>" +
      "IMDb: %{customdata[0]:.2f}<br>" +
      "Difference (Douban-IMDb): %{customdata[1]:+.2f}<br>" +
      "Abs diff: %{customdata[5]:.2f}<br>" +
      "n: %{customdata[2]}<extra></extra>"
  };

  const traceIMDb = {
    type: "scatter",
    mode: "lines+markers",
    name: "IMDb",
    x: genres,
    y: imdbY,
    line: { width: 3 },
    marker: { size: 9 },
    customdata: imdbCustom,
    hovertemplate:
      "Year: %{customdata[3]}<br>" +
      "Genre: %{customdata[4]}<br>" +
      "Douban: %{customdata[0]:.2f}<br>" +
      "IMDb: %{y:.2f}<br>" +
      "Difference (Douban-IMDb): %{customdata[1]:+.2f}<br>" +
      "Abs diff: %{customdata[5]:.2f}<br>" +
      "n: %{customdata[2]}<extra></extra>"
  };

  // --- Center + smaller chart to fit viewport ---
  const CHART_HEIGHT = 520;

  const layout = {
    title: {
      text:
        "Average Genre Rating Over Time: Douban vs IMDb<br>" +
        "<span style='font-size:12px;color:#666'>(Top 5 Largest | Bottom 5 Smallest Abs Difference Genres)</span>",
      x: 0.5,
      xanchor: "center"
    },
    autosize: true,
    xaxis: {
      title: "Genre",
      tickangle: 0,
      automargin: true
    },
    yaxis: {
      title: "Average Rating",
      // keep your range, but you can also make it auto if you want
      range: [5.5, 9.0],
      gridcolor: "#efefef",
      zeroline: false
    },
    margin: { l: 70, r: 30, t: 80, b: 85 },
    height: CHART_HEIGHT,
    legend: { orientation: "h", x: 1, xanchor: "right", y: 1.06, yanchor: "bottom" },
    paper_bgcolor: "#fff",
    plot_bgcolor: "#fff"
  };

  return { data: [traceDouban, traceIMDb], layout, chartHeight: CHART_HEIGHT };
}

async function initTask2Embedded() {
  const raw = await loadTask2Data();
  const map = byYear(raw);

  const years = [...map.keys()]
    .filter(y => y >= TASK2_YEAR_MIN && y <= TASK2_YEAR_MAX)
    .sort((a, b) => a - b);

  const yearLabel = document.getElementById("task2-year-label");

  if (years.length === 0) {
    if (yearLabel) yearLabel.textContent = "No data";
    return;
  }

  // Default to latest year available within 2010-2020
  const y0 = years[years.length - 1];
  const fig0 = makeFigure(y0, map.get(y0));

  // Make sure container height matches layout height (prevents being cut off)
  const chartDiv = document.getElementById("task2-chart");
  try {
    if (chartDiv && fig0.chartHeight) {
      chartDiv.style.height = String(fig0.chartHeight) + "px";
      chartDiv.style.minHeight = String(fig0.chartHeight) + "px";
    }
  } catch (e) {}

  fig0.layout.sliders = [{
    active: years.indexOf(y0),
    currentvalue: { prefix: "Year: " },
    pad: { t: 18 },
    steps: years.map((yr) => ({
      label: String(yr),
      method: "animate",
      args: [[String(yr)], {
        mode: "immediate",
        transition: { duration: 0 },
        frame: { duration: 0, redraw: true }
      }]
    }))
  }];

  const frames = years.map((yr) => {
    const fig = makeFigure(yr, map.get(yr));
    return { name: String(yr), data: fig.data };
  });

  if (yearLabel) yearLabel.textContent = String(y0);

  await Plotly.newPlot("task2-chart", fig0.data, fig0.layout, {
    responsive: true,
    displayModeBar: true
  });

  Plotly.addFrames("task2-chart", frames);

  if (chartDiv && chartDiv.on) {
    chartDiv.on("plotly_animated", (e) => {
      if (e && e.name && yearLabel) yearLabel.textContent = e.name;
    });
  }
}

function bootTask2Safely() {
  // 1) 必须有容器
  if (!document.getElementById("task2-chart")) return;

  // 2) Plotly 可能还没加载好（或加载慢），等一下再试
  if (!window.Plotly || !Plotly.newPlot) {
    setTimeout(bootTask2Safely, 80);
    return;
  }

  // 3) 真正初始化
  initTask2Embedded().catch(err => {
    console.error("[task2] init failed:", err);
  });
}

// ✅ 延后执行：让词云先渲染，避免主线程被 Plotly+CSV 卡住
function scheduleBootTask2() {
  if ("requestIdleCallback" in window) {
    requestIdleCallback(bootTask2Safely, { timeout: 1500 });
  } else {
    setTimeout(bootTask2Safely, 400);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scheduleBootTask2);
} else {
  scheduleBootTask2();
}