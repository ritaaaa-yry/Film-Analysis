// task1.js - Interactive Dumbbell Chart for Douban vs IMDb Ratings

let allData = [];
let filteredData = [];
let userDisplayLimit = null; // null = use defaults (120 for All, 30 for genre)

async function loadTask1Data() {
  try {
    console.log("task1: loading data.json...");
    const res = await fetch("data.json");
    allData = await res.json();
    filteredData = [...allData];
    initTask1UI();
    renderDumbbell();
  } catch (e) {
    console.error("Failed to load Task 1 data:", e);
    // Fallback: when opening via file:// many browsers block fetch().
    // Provide a small demo dataset so the UI still shows something.
    allData = demoTask1Data();
    filteredData = [...allData];
    initTask1UI();
    renderDumbbell();
  }
}

function demoTask1Data() {
  return [
    { genre: "Action", title: "Fast Action", year: 2010, douban: 7.8, imdb: 6.2, diff: 1.6 },
    { genre: "Action", title: "Heroic Tale", year: 2012, douban: 8.4, imdb: 7.1, diff: 1.3 },
    { genre: "Drama", title: "Tearjerker", year: 2015, douban: 9.0, imdb: 8.5, diff: 0.5 },
    { genre: "Comedy", title: "Laugh Riot", year: 2011, douban: 6.5, imdb: 7.2, diff: -0.7 },
    { genre: "Romance", title: "Love Story", year: 2009, douban: 7.2, imdb: 6.9, diff: 0.3 },
    { genre: "Sci-Fi", title: "Future World", year: 2018, douban: 8.1, imdb: 7.8, diff: 0.3 }
  ];
}

function uniqueSorted(arr) {
  return [...new Set(arr)].sort((a, b) => String(a).localeCompare(String(b)));
}

function fmt2(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function fmtYear(y) {
  if (y === null || y === undefined) return "—";
  const s = String(y).trim();
  if (s === "" || s.toLowerCase() === "null") return "—";
  return s;
}

function computeStats(rows) {
  const diffs = rows.map(r => Number(r.diff)).filter(x => Number.isFinite(x));
  const absDiffs = diffs.map(x => Math.abs(x));
  const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN;

  return {
    count: rows.length,
    meanDiff: mean(diffs),
    meanAbsDiff: mean(absDiffs),
  };
}

function sortRows(rows, mode) {
  const copy = [...rows];
  if (mode === "absdiff_desc") copy.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  if (mode === "absdiff_asc")  copy.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
  if (mode === "douban_desc")  copy.sort((a, b) => b.douban - a.douban);
  if (mode === "imdb_desc")    copy.sort((a, b) => b.imdb - a.imdb);
  if (mode === "title_asc")    copy.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  return copy;
}

function buildDumbbellTraces(rows) {
  const y = rows.map(r => r.title.length > 56 ? r.title.slice(0, 53) + "…" : r.title);

  const xLine = [];
  const yLine = [];
  for (let i = 0; i < rows.length; i++) {
    xLine.push(rows[i].douban, rows[i].imdb, null);
    yLine.push(y[i], y[i], null);
  }

  const link = {
    type: "scatter",
    mode: "lines",
    x: xLine,
    y: yLine,
    hoverinfo: "skip",
    line: { width: 3, color: "#9a9a9a" },
    name: "Link",
    showlegend: false
  };

  const douban = {
    type: "scatter",
    mode: "markers",
    x: rows.map(r => r.douban),
    y,
    name: "Douban",
    marker: { size: 10, color: "#e74c3c", line: { width: 1, color: "white" } },
    customdata: rows.map(r => [r.imdb, r.diff, fmtYear(r.year)]),
    hovertemplate:
      "<b>%{y}</b><br>" +
      "Douban: %{x:.2f}<br>" +
      "IMDb: %{customdata[0]:.2f}<br>" +
      "Δ (Douban-IMDb): %{customdata[1]:+.2f}<br>" +
      "Year: %{customdata[2]}<extra></extra>"
  };

  const imdb = {
    type: "scatter",
    mode: "markers",
    x: rows.map(r => r.imdb),
    y,
    name: "IMDb",
    marker: { size: 10, color: "#2e6bdc", line: { width: 1, color: "white" } },
    customdata: rows.map(r => [r.douban, r.diff, fmtYear(r.year)]),
    hovertemplate:
      "<b>%{y}</b><br>" +
      "IMDb: %{x:.2f}<br>" +
      "Douban: %{customdata[0]:.2f}<br>" +
      "Δ (Douban-IMDb): %{customdata[1]:+.2f}<br>" +
      "Year: %{customdata[2]}<extra></extra>"
  };

  return [link, douban, imdb];
}

function renderDumbbell() {
  const genreSelect = document.getElementById("task1-genre-select");
  const sortSelect = document.getElementById("task1-sort-select");
  const plotDiv = document.getElementById("task1-plot");

  if (!plotDiv) {
    console.warn("Task 1 plot container not found");
    return;
  }

  const selectedGenre = genreSelect ? genreSelect.value : "All";
  const sortMode = sortSelect ? sortSelect.value : "absdiff_desc";

  // Filter by genre
  let rows = allData;
  if (selectedGenre !== "All") {
    rows = rows.filter(r => r.genre === selectedGenre);
  }

  // Sort
  rows = sortRows(rows, sortMode);

  // Determine display limit: prefer user override, otherwise defaults
  const defaultLimit = (selectedGenre === "All") ? 120 : 30;
  const displayLimit = (userDisplayLimit && Number.isFinite(Number(userDisplayLimit))) ? Number(userDisplayLimit) : defaultLimit;
  const totalRows = rows.length;
  // Apply slice for performance
  if (rows.length > displayLimit) {
    rows = rows.slice(0, displayLimit);
  }

  const stats = computeStats(rows);
  const traces = buildDumbbellTraces(rows);

  // Dynamic layout sizing based on number of rows and title length
  const yLabels = rows.map(r => r.title.length > 56 ? r.title.slice(0, 53) + "…" : r.title);
  const maxTitleLen = yLabels.reduce((m, s) => Math.max(m, s.length), 0);
  const marginLeft = Math.max(180, Math.min(700, 40 + maxTitleLen * 7));
  const height = Math.min(2200, Math.max(400, 120 + rows.length * 18));
  const markerSize = rows.length > 120 ? 6 : rows.length > 60 ? 8 : 10;
  const yTickFontSize = Math.max(8, Math.min(14, Math.round(14 * Math.min(1, 40 / Math.max(1, rows.length)))));

  const layout = {
    title: {
      text: `Douban vs IMDb Ratings (showing ${rows.length} of ${totalRows} movies)`,
      font: { size: 16 }
    },
    xaxis: {
      title: "Rating",
      range: [0, 10],
      zeroline: false
    },
    yaxis: {
      autorange: "reversed",
      showgrid: false,
      zeroline: false
    },
    height,
    margin: { l: marginLeft, r: 50, t: 80, b: 60 },
    hovermode: "closest",
    showlegend: true,
    legend: { x: 1.05, y: 1 }
  };

  const config = {
    responsive: true,
    displayModeBar: false
  };

  // adjust marker sizes in traces
  try {
    if (traces && traces.length >= 3) {
      traces[1].marker.size = markerSize;
      traces[2].marker.size = markerSize;
      traces[0].line.width = Math.max(1, Math.round(markerSize / 3));
    }
  } catch (e) { /* ignore */ }

  // apply y tick font size
  layout.yaxis = layout.yaxis || {};
  layout.yaxis.tickfont = { size: yTickFontSize };

  // Ensure the plot container height matches the layout height so the parent card expands
  try {
    plotDiv.style.height = String(layout.height) + 'px';
    plotDiv.style.minHeight = String(layout.height) + 'px';
    if (plotDiv.parentElement) {
      plotDiv.parentElement.style.minHeight = (layout.height + 80) + 'px';
    }
  } catch (e) { /* ignore */ }

  Plotly.newPlot(plotDiv, traces, layout, config);
}

function initTask1UI() {
  const genreSelect = document.getElementById("task1-genre-select");
  const sortSelect = document.getElementById("task1-sort-select");
  const resetBtn = document.getElementById("task1-reset-btn");
  const limitRange = document.getElementById("task1-limit-range");
  const limitValue = document.getElementById("task1-limit-value");

  if (!genreSelect || !sortSelect) {
    console.warn("Task 1 UI elements not found");
    return;
  }

  // Populate genres
  const genres = uniqueSorted(allData.map(r => r.genre));
  genreSelect.innerHTML = '<option value="All">All Genres</option>';
  genres.forEach(g => {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    genreSelect.appendChild(opt);
  });

  // Event listeners
  genreSelect.addEventListener("change", renderDumbbell);
  sortSelect.addEventListener("change", renderDumbbell);
  if (limitRange && limitValue) {
    // initialize
    limitValue.textContent = limitRange.value;
    limitRange.addEventListener("input", (e) => {
      userDisplayLimit = e.target.value ? Number(e.target.value) : null;
      limitValue.textContent = e.target.value;
      renderDumbbell();
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      genreSelect.value = "All";
      sortSelect.value = "absdiff_desc";
      if (limitRange && limitValue) {
        limitRange.value = "120";
        limitValue.textContent = "120";
        userDisplayLimit = 120;
      } else {
        userDisplayLimit = null;
      }
      renderDumbbell();
    });
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadTask1Data);
} else {
  loadTask1Data();
}

// If view toggles are used to show/hide the platform interactive pane,
// ensure the chart is re-rendered and resized when the pane becomes visible.
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest && ev.target.closest('.toggle-btn');
  if (!btn) return;
  const scope = btn.dataset && btn.dataset.scope;
  const view = btn.dataset && btn.dataset.view;
  if (scope === 'platform' && view === 'interactive') {
    // small delay to allow pane to become visible
    setTimeout(() => {
      try { renderDumbbell(); } catch (e) { console.warn('task1: render error', e); }
      const plotDiv = document.getElementById('task1-plot');
      if (plotDiv && window.Plotly && Plotly.Plots && typeof Plotly.Plots.resize === 'function') {
        try { Plotly.Plots.resize(plotDiv); } catch (e) { /* ignore */ }
      }
    }, 120);
  }
});
