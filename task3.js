// task3.js
// Movie Deep Dive: Director-Actor collaboration network
// Data source: "TMDB  IMDB Movies Dataset.csv" (fixed, auto-loaded)
// Requirements:
// - use columns: directors, cast, vote_average
// - each cell has multiple names separated by "," -> take first TWO names
// - connect director <-> actor if in same movie; thicker edge = more collaborations
// - shape: director = circle, actor = square
// - node color: average vote_average tier of that person:
//     < 6.5 (low), 6.5-7.5 (mid), > 8 (high); (7.5-8 treated as mid)
// Uses vis-network (loaded in HTML).

(function () {
  'use strict';

  const CSV_PATH = "TMDB  IMDB Movies Dataset.csv"; // keep the double space, matches your filename
  const MAX_NODES = 500; // keep network readable; increase if you want
  const MIN_EDGE_WEIGHT = 1;

  function $(id) { return document.getElementById(id); }

  function setStatus(msg) {
    const el = $("task3-status");
    if (el) el.textContent = msg;
  }

  // Robust CSV parser that handles quoted commas.
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

  function parseCsvText(text) {
    const records = parseCsvRecords(text);
    if (!records || records.length < 2) return [];

    const header = records[0].map(h => String(h || "").replace(/^\uFEFF/, "").trim());
    const idx = new Map(header.map((h, i) => [h.toLowerCase(), i]));

    function getCell(cols, key) {
      const i = idx.get(String(key).toLowerCase());
      return (i == null) ? "" : (cols[i] ?? "");
    }

    const out = [];
    for (let r = 1; r < records.length; r++) {
      const cols = records[r];
      if (!cols || !cols.length) continue;
      out.push({
        title: String(getCell(cols, "title") || "").trim(),
        directors: String(getCell(cols, "directors") || "").trim(),
        cast: String(getCell(cols, "cast") || "").trim(),
        vote_average: Number.parseFloat(String(getCell(cols, "vote_average") || "").trim())
      });
    }
    return out;
  }

  function splitTop2(raw) {
    return String(raw || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 2);
  }

  function tierColor(avg) {
    if (!Number.isFinite(avg)) return "#999999";
    if (avg < 6.0) return "#e74c3c";       // low
    if (avg <= 7.0) return "#f39c12";      // mid
    if (avg > 7.0) return "#2ecc71";       // high
    // between (7.5, 8] => mid (you didn't define a tier)
    return "#f39c12";
  }

  function buildGraph(rows) {
    // stats[name] = { role, n, sum }
    const stats = new Map();
    // edges key "director||actor" -> weight
    const edgeMap = new Map();

    function addPerson(name, role, rating) {
      if (!name) return;
      if (!stats.has(name)) stats.set(name, { role, n: 0, sum: 0 });
      const s = stats.get(name);
      // If someone appears as both, keep the first role seen (usually director/actor distinct)
      s.n += 1;
      if (Number.isFinite(rating)) s.sum += rating;
    }

    rows.forEach(r => {
      const rating = r.vote_average;
      if (!Number.isFinite(rating)) return;

      const dirs = splitTop2(r.directors);
      const acts = splitTop2(r.cast);

      dirs.forEach(d => addPerson(d, "director", rating));
      acts.forEach(a => addPerson(a, "actor", rating));

      dirs.forEach(d => {
        acts.forEach(a => {
          const key = d + "||" + a;
          edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
        });
      });
    });

    // Limit nodes to keep it readable (top by appearances)
    const sortedPeople = [...stats.entries()]
      .map(([name, s]) => ({ name, ...s, avg: s.n ? (s.sum / s.n) : NaN }))
      .sort((a, b) => (b.n - a.n) || (b.avg - a.avg) || a.name.localeCompare(b.name))
      .slice(0, MAX_NODES);

    const keep = new Set(sortedPeople.map(p => p.name));

    const nodes = sortedPeople.map(p => ({
      id: p.name,
      label: p.name,
      shape: (p.role === "director") ? "circle" : "square",
      color: {
        background: tierColor(p.avg),
        border: "#ffffff",
        highlight: { background: tierColor(p.avg), border: "#ffffff" }
      },
      font: { color: "#ffffff", size: 12, face: "Arial" },
      value: p.n,
      title: `${p.name}<br>Role: ${p.role}<br>Avg vote_average: ${Number.isFinite(p.avg) ? p.avg.toFixed(2) : "-"}<br>Movies counted: ${p.n}`
    }));

    const edges = [];
    edgeMap.forEach((w, key) => {
      if (w < MIN_EDGE_WEIGHT) return;
      const parts = key.split("||");
      const from = parts[0], to = parts[1];
      if (!keep.has(from) || !keep.has(to)) return;
      edges.push({
        from,
        to,
        value: w,
        width: 1 + Math.log2(1 + w) * 2.2,
        title: `Collaborations: ${w}`,
        color: { color: "rgba(120, 200, 210, 0.55)", highlight: "rgba(120, 200, 210, 0.9)" },
        smooth: { type: "dynamic" }
      });
    });

    return { nodes, edges, totalPeople: stats.size, totalEdges: edgeMap.size };
  }

  function renderNetwork(graph) {
    const container = $("task3-network");
    if (!container) return;

    container.innerHTML = "";

    // vis libs must exist
    if (!window.vis || !window.vis.Network || !window.vis.DataSet) {
      container.innerHTML = "<div style='padding:12px; color:#b91c1c; font-weight:600;'>vis-network is not loaded. Please add its CDN scripts in &lt;head&gt;.</div>";
      return;
    }

    const data = {
      nodes: new vis.DataSet(graph.nodes),
      edges: new vis.DataSet(graph.edges)
    };

    const options = {
      autoResize: true,
      interaction: {
        hover: true,
        multiselect: true,
        navigationButtons: true,
        zoomView: true,
        dragView: true
      },
      physics: {
        enabled: true,
        stabilization: { iterations: 180 },
        solver: "forceAtlas2Based",
        forceAtlas2Based: {
          gravitationalConstant: -55,
          centralGravity: 0.01,
          springLength: 120,
          springConstant: 0.08,
          damping: 0.4,
          avoidOverlap: 1.0
        }
      },
      nodes: {
        borderWidth: 1,
        size: 16,
        scaling: { min: 10, max: 38 }
      },
      edges: {
        scaling: { min: 1, max: 10 },
        selectionWidth: 2
      }
    };

    const network = new vis.Network(container, data, options);

    // After stable, stop physics so it stays readable like your screenshot
    network.once("stabilizationIterationsDone", () => {
      try { network.setOptions({ physics: { enabled: false } }); } catch (e) {}
    });
  }

  async function loadAndDraw() {
    const container = $("task3-network");
    if (!container) return;

    setStatus(`Loading ${CSV_PATH} ...`);

    try {
      const res = await fetch(CSV_PATH, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} when fetching ${CSV_PATH}`);
      const text = await res.text();
      const rows = parseCsvText(text);
      if (!rows.length) throw new Error("Parsed 0 rows. Check CSV headers: directors, cast, vote_average.");

      const graph = buildGraph(rows);

      setStatus(
        `Loaded: ${rows.length.toLocaleString()} movies | ` +
        `People: ${graph.totalPeople.toLocaleString()} (showing top ${graph.nodes.length}) | ` +
        `Edges: ${graph.edges.length.toLocaleString()}`
      );

      renderNetwork(graph);
    } catch (err) {
      console.error(err);
      setStatus(`Failed to load ${CSV_PATH}`);
      container.innerHTML =
        `<div style="padding:12px; color:#b91c1c; font-weight:600;">` +
        `Task3 failed: ${String(err.message || err)}<br>` +
        `<span style="font-weight:400; color:#555;">If you opened the HTML via <code>file://</code>, use a local server (VSCode Live Server / python -m http.server).</span>` +
        `</div>`;
    }
  }

  // load when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadAndDraw);
  } else {
    loadAndDraw();
  }
})();
