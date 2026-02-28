/**
 * wordcloud_page.js
 * Changes requested:
 * - Color: high frequency -> deep blue, low frequency -> light blue
 * - Size: make high vs low more visually distinct (nonlinear scaling + wider range)
 * Also includes robust asset path resolution to avoid 404.
 */

const $ = (id) => document.getElementById(id);
const els = {
  genreSelect: $("genreSelect"),
  cnCanvas: $("cloudCanvas"),
  enCanvas: $("cloudCanvasEn"),
  reviewList: $("review-list"),
  metaText: $("metaText"),
  cnStatus: $("cnStatus"),
  enStatus: $("enStatus"),
  enProgress: $("enProgress"),
  enProgressText: $("enProgressText"),
  enProgressBar: $("enProgressBar"),
  reviewHint: $("reviewHint"),
  translateReviewsBtn: $("translateReviewsBtn"),
  reviewEnStatus: $("reviewEnStatus"),
  reviewProgress: $("reviewProgress"),
  reviewProgressText: $("reviewProgressText"),
  reviewProgressBar: $("reviewProgressBar"),
};

if (!els.genreSelect || !els.cnCanvas || !els.enCanvas) {
  console.warn("[wordcloud] Missing key DOM nodes; abort.");
} else {
  init().catch((err) => {
    console.error("[wordcloud] init failed:", err);
    if (els.metaText) els.metaText.textContent = "Init failed: " + (err?.message || String(err));
  });
}

// ---------------- Utils ----------------
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function setMeta(msg) {
  if (els.metaText) els.metaText.textContent = msg || "";
}
function setPill(el, text) { if (el) el.textContent = text; }

function htmlEscape(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function splitGenresSlash(s) {
  return String(s ?? "")
    .split("/")
    .map(x => x.trim())
    .filter(Boolean);
}

function normEnToken(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------- Progress UI ----------------
function setKwProgress(done, total, text) {
  if (!els.enProgress || !els.enProgressText || !els.enProgressBar) return;
  const pct = total ? Math.round((done / total) * 100) : 0;
  els.enProgress.style.display = "block";
  els.enProgressText.textContent = text || "Translating keywords…";
  els.enProgressBar.style.width = `${pct}%`;
}
function hideKwProgress() {
  if (!els.enProgress) return;
  els.enProgress.style.display = "none";
  if (els.enProgressBar) els.enProgressBar.style.width = "0%";
}

function setReviewProgress(done, total, text) {
  if (!els.reviewProgress || !els.reviewProgressText || !els.reviewProgressBar) return;
  const pct = total ? Math.round((done / total) * 100) : 0;
  els.reviewProgress.style.display = "block";
  els.reviewProgressText.textContent = text || "Translating reviews…";
  els.reviewProgressBar.style.width = `${pct}%`;
}
function hideReviewProgress() {
  if (!els.reviewProgress) return;
  els.reviewProgress.style.display = "none";
  if (els.reviewProgressBar) els.reviewProgressBar.style.width = "0%";
}

// ---------------- Robust asset resolution ----------------
function candidateBases() {
  const jsDir = new URL("./", import.meta.url);
  const htmlDir = new URL("./", window.location.href);
  const root = new URL("/", window.location.href);

  const bases = [
    jsDir,
    new URL("data/", jsDir),
    htmlDir,
    new URL("data/", htmlDir),
    root,
    new URL("data/", root),
  ];

  const uniq = [];
  const seen = new Set();
  for (const b of bases) {
    const k = b.toString();
    if (!seen.has(k)) { seen.add(k); uniq.push(b); }
  }
  return uniq;
}

async function tryFetchFirst(filename, acceptContentHint = null) {
  const bases = candidateBases();
  const tried = [];

  for (const base of bases) {
    const url = new URL(filename, base).toString();
    tried.push(url);

    try {
      const res = await fetch(url, { cache: "default" });
      if (!res.ok) continue;

      if (acceptContentHint) {
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        const looksHtml = ct.includes("text/html");
        if (looksHtml) continue;

        // allow json even if server returns text/plain
        if (acceptContentHint === "application/json") {
          if (!(ct.includes("application/json") || ct.includes("text/plain"))) continue;
        }
      }

      return { url, tried };
    } catch {
      // ignore
    }
  }
  return { url: null, tried };
}

async function resolveAssets() {
  setMeta("Resolving data file paths…");

  const wf = await tryFetchFirst("genre_wordfreq.json", "application/json");
  if (!wf.url) {
    setMeta("Init failed: Cannot find genre_wordfreq.json. Tried:\n" + wf.tried.join("\n"));
    throw new Error("Cannot find genre_wordfreq.json (check your file location / data folder).");
  }

  const mv = await tryFetchFirst("Data_merged_cleaned.csv", "text/csv");
  if (!mv.url) {
    setMeta("Init failed: Cannot find Data_merged_cleaned.csv. Tried:\n" + mv.tried.join("\n"));
    throw new Error("Cannot find Data_merged_cleaned.csv.");
  }

  // XLSX content-type varies; do a fallback attempt without type hint.
  const rv = await tryFetchFirst("F1_with_genres.xlsx", "application/vnd");
  if (!rv.url) {
    const rv2 = await tryFetchFirst("F1_with_genres.xlsx", null);
    if (!rv2.url) {
      setMeta("Init failed: Cannot find F1_with_genres.xlsx. Tried:\n" + rv.tried.join("\n"));
      throw new Error("Cannot find F1_with_genres.xlsx.");
    }
    return { PATH_WORDFREQ: wf.url, PATH_MOVIES: mv.url, PATH_REVIEWS: rv2.url };
  }

  return { PATH_WORDFREQ: wf.url, PATH_MOVIES: mv.url, PATH_REVIEWS: rv.url };
}

// ---------------- CSV helpers ----------------
async function fetchText(url) {
  const res = await fetch(url, { cache: "default" });
  if (!res.ok) throw new Error(`Failed to load ${url} (HTTP ${res.status})`);
  return await res.text();
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
      if (inQuotes && src[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === ",") {
      row.push(field); field = ""; continue;
    }
    if (!inQuotes && ch === "\n") {
      row.push(field); rows.push(row);
      row = []; field = ""; continue;
    }
    field += ch;
  }
  row.push(field);
  rows.push(row);

  return rows.filter(r => r.some(x => String(x ?? "").trim() !== ""));
}

function rowsToObjects(rows) {
  if (!rows?.length) return [];
  const header = rows[0].map(h => String(h ?? "").trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const o = {};
    for (let j = 0; j < header.length; j++) o[header[j]] = r[j] ?? "";
    out.push(o);
  }
  return out;
}

// ---------------- XLSX loader ----------------
let xlsxReady = null;
async function ensureXlsx() {
  if (xlsxReady) return xlsxReady;
  xlsxReady = (async () => {
    if (window.XLSX) return;
    const mod = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
    window.XLSX = mod.default || mod;
  })();
  return xlsxReady;
}

async function loadReviewsXlsx(url) {
  await ensureXlsx();
  const res = await fetch(url, { cache: "default" });
  if (!res.ok) throw new Error(`Failed to load ${url} (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return window.XLSX.utils.sheet_to_json(ws, { defval: "" });
}

// ---------------- WordCloud draw (COLOR + SIZE UPDATED) ----------------
function renderWordCloud(canvas, pairs, statusPill) {
  const parent = canvas.parentElement;
  const w = parent?.clientWidth || 600;
  const h = parent?.clientHeight || 380;
  canvas.width = w;
  canvas.height = h;

  const list = (pairs || [])
    .map(([w0, f0]) => [String(w0), Number(f0) || 0])
    .filter(x => x[0] && Number.isFinite(x[1]));

  if (!list.length) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.fillText("No data", 10, 20);
    setPill(statusPill, "empty");
    return;
  }

  // Compute min/max weight for normalization (per render call)
  let minW = Infinity, maxW = -Infinity;
  for (const [, wt] of list) {
    if (wt < minW) minW = wt;
    if (wt > maxW) maxW = wt;
  }
  if (!Number.isFinite(minW) || !Number.isFinite(maxW)) { minW = 0; maxW = 1; }
  if (maxW === minW) maxW = minW + 1;

  const norm = (wt) => (wt - minW) / (maxW - minW); // 0..1

  // Make size contrast stronger: apply gamma > 1 (e.g., 1.7)
  // Then map to a wider font-size range.
  const MIN_FONT = 20;   // low-frequency smaller
  const MAX_FONT = 90;  // high-frequency much larger
  const GAMMA = 1.7;     // >1 amplifies differences at the high end

  // Color: low freq light blue (higher lightness), high freq deep blue (lower lightness)
  // Use fixed hue/saturation, map lightness 85% -> 28%
  const HUE = 220;       // blue
  const SAT = 85;        // saturated blue
  const L_LIGHT = 85;    // low freq
  const L_DARK = 28;     // high freq

  window.WordCloud(canvas, {
    list,

    // SIZE: more contrast than before
    weightFactor: (wt) => {
      const t = clamp(norm(Number(wt) || 0), 0, 1);
      const tt = Math.pow(t, GAMMA);
      return MIN_FONT + tt * (MAX_FONT - MIN_FONT);
    },

    // COLOR: deep blue for high, light blue for low
    color: (word, wt) => {
      const t = clamp(norm(Number(wt) || 0), 0, 1);
      const lightness = L_LIGHT - t * (L_LIGHT - L_DARK);
      return `hsl(${HUE}, ${SAT}%, ${lightness}%)`;
    },

    rotateRatio: 0.08,
    minRotation: -Math.PI / 10,
    maxRotation: Math.PI / 10,
    gridSize: Math.round(16 * (w / 1024)),
    backgroundColor: "#fafafa",
    drawOutOfBound: false,
    shrinkToFit: true,
  });

  setPill(statusPill, "ok");
}

// ---------------- Translation ----------------
function hashString(s) {
  const str = String(s ?? "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
function cacheKeySentence(s) { return `t_zh2en_${hashString(s)}`; }
function cacheKeyKwMap(genre) { return `kwmap_zh2en_${genre}`; }

async function translateOne_zh2en(text) {
  const s = String(text ?? "").trim();
  if (!s) return "";

  const k = cacheKeySentence(s);
  const cached = localStorage.getItem(k);
  if (cached) return cached;

  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=" + encodeURIComponent(s);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("translate failed " + res.status);
  const data = await res.json();
  const out = (data?.[0] || []).map(seg => seg?.[0] || "").join("").trim();
  if (out) localStorage.setItem(k, out);
  return out;
}

async function renderEnglishCloudFromKeywords(genre, cnPairs) {
  setPill(els.enStatus, "translating…");
  setKwProgress(0, cnPairs.length, "Translating keywords…");

  let mapping = null;
  const ck = cacheKeyKwMap(genre);
  const cached = localStorage.getItem(ck);
  if (cached) {
    try { mapping = JSON.parse(cached); } catch { mapping = null; }
  }

  if (!mapping) {
    const out = [];
    let done = 0;
    const concurrency = 4;
    let idx = 0;

    async function worker() {
      while (idx < cnPairs.length) {
        const i = idx++;
        const cn = String(cnPairs[i][0]);
        let en = "";
        try { en = await translateOne_zh2en(cn); } catch { en = ""; }
        out.push({ cn, en });
        done++;
        setKwProgress(done, cnPairs.length, "Translating keywords…");
        if (done % 4 === 0) await sleep(0);
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    mapping = out;
    try { localStorage.setItem(ck, JSON.stringify(mapping)); } catch {}
  }

  const map = new Map(mapping.map(x => [x.cn, x.en]));
  // ✅ 生成“当前 genre 的英文关键词”，用于英文评论标红
  currentKeywordsEN = cnPairs
  .map(([w]) => map.get(String(w)) || String(w))
  .map(normEnToken)
  .filter(Boolean);
  const enPairs = cnPairs.map(([w, f]) => {
    const en = map.get(String(w)) || String(w);
    return [normEnToken(en) || String(w), Number(f) || 0];
  });

  renderWordCloud(els.enCanvas, enPairs, els.enStatus);
  hideKwProgress();
  setPill(els.enStatus, "ok");
}

// ---------------- Reviews ----------------
function highlightKeywords(text, keywords) {
  const s = String(text ?? "");
  if (!s || !keywords?.length) return htmlEscape(s);

  let escaped = htmlEscape(s);
  const kw = keywords
    .map(k => String(k ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .slice(0, 50);

  if (!kw.length) return escaped;

  const re = new RegExp("(" + kw.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "g");
  return escaped.replace(re, `<mark class="kw">$1</mark>`);
}

let wordfreq = null;      // json
let movieMetaById = null; // Map
let reviews = null;       // xlsx rows

let currentKeywordsCN = [];
let currentTopReviews = [];
let currentKeywordsEN = [];

function pickTop20ReviewsForGenre(genre) {
  if (!reviews || !movieMetaById) return [];

  const rows = [];
  for (const r of reviews) {
    const mid = String(r.movie_id ?? r.movieId ?? r.id ?? "").trim();
    if (!mid) continue;

    const meta = movieMetaById.get(mid);
    if (!meta) continue;
    if (!meta.genres.includes(genre)) continue;

    const cn = String(r.content ?? r.review ?? r.review_text ?? r.text ?? "").trim();
    if (!cn) continue;

    rows.push({
      cn,
      useful_vote: Number(r.useful_vote ?? r.useful ?? r.votes ?? 0) || 0,
      user: String(r.user ?? r.username ?? "").trim(),
      title: meta.title || "",
      url: meta.url || "",
      year: meta.year || "",
    });
  }

  rows.sort((a, b) => (b.useful_vote || 0) - (a.useful_vote || 0));
  return rows.slice(0, 20);
}

function renderReviewsListCN(rows, keywords) {
  if (!els.reviewList) return;

  if (!rows.length) {
    els.reviewList.innerHTML = `<div class="meta">No reviews found for genre: ${htmlEscape(els.genreSelect.value)}</div>`;
    return;
  }

  els.reviewList.innerHTML = rows.map((r, i) => {
    const cnHtml = highlightKeywords(r.cn, keywords);
    return `
      <div class="review-item" data-review-idx="${i}">
        <div class="review-head">
          <span class="badge">#${i + 1}</span>
          <span class="badge">Useful: ${Number(r.useful_vote || 0)}</span>
          ${r.user ? `<span class="badge">${htmlEscape(r.user)}</span>` : ""}
          ${r.title ? `<span class="badge">${htmlEscape(r.title)}</span>` : ""}
          ${r.year ? `<span class="badge">Year: ${htmlEscape(r.year)}</span>` : ""}
          ${r.url ? `<span class="badge"><a href="${htmlEscape(r.url)}" target="_blank" rel="noreferrer">link</a></span>` : ""}
        </div>
        <div class="cn">${cnHtml}</div>
        <div class="en" style="color:#9ca3af">(click “Translate reviews to English” to generate)</div>
      </div>
    `;
  }).join("");
}

function updateReviewEN(i, enText, keywordsCN) {
  const item = els.reviewList?.querySelector(`.review-item[data-review-idx="${i}"]`);
  if (!item) return;
  const enDiv = item.querySelector(".en");
  if (!enDiv) return;

  const kwEN = (keywordsCN || []).map(k => normEnToken(k)).filter(Boolean);
  const enHtml = highlightKeywords(enText, kwEN);

  enDiv.style.color = "#374151";
  enDiv.innerHTML = enText ? enHtml : `<span style="color:#9ca3af">(translation failed)</span>`;
}

function prepareReviewsCN(genre, keywords) {
  const top = pickTop20ReviewsForGenre(genre);
  currentKeywordsCN = Array.isArray(keywords) ? keywords.slice() : [];
  currentTopReviews = top;

  renderReviewsListCN(top, currentKeywordsCN);

  if (els.reviewHint) {
    els.reviewHint.textContent = top.length
      ? "Reviews are shown in Chinese first. Click the button to translate to English."
      : "No reviews matched this genre (or review file columns differ).";
  }

  setPill(els.reviewEnStatus, "idle");
  hideReviewProgress();

  if (els.translateReviewsBtn) {
    els.translateReviewsBtn.disabled = top.length === 0;
    els.translateReviewsBtn.textContent = "Translate reviews to English";
  }
}

async function translateCurrentReviewsToEN() {
  const top = currentTopReviews || [];
  if (!top.length) return;

  if (els.translateReviewsBtn) {
    els.translateReviewsBtn.disabled = true;
    els.translateReviewsBtn.textContent = "Translating…";
  }
  setPill(els.reviewEnStatus, "translating…");

  setReviewProgress(0, top.length, "Translating reviews…");

  let done = 0;
  const concurrency = 3;
  let idx = 0;

  async function worker() {
    while (idx < top.length) {
      const i = idx++;
      const cn = top[i].cn;

      let en = "";
      try { en = await translateOne_zh2en(cn); } catch { en = ""; }

      done++;
      setReviewProgress(done, top.length, "Translating reviews…");
      updateReviewEN(i, en, currentKeywordsEN.length ? currentKeywordsEN : currentKeywordsCN);

      if (done % 2 === 0) await sleep(0);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  hideReviewProgress();
  setPill(els.reviewEnStatus, "ok");

  if (els.translateReviewsBtn) {
    els.translateReviewsBtn.disabled = false;
    els.translateReviewsBtn.textContent = "Re-translate reviews";
  }
}

// ---------------- Render ----------------
async function renderGenre(genre) {
  const topK = Number(wordfreq?._meta?.top_k_per_genre || 30);
  const cnPairs = (wordfreq?.data?.[genre] || []).slice(0, topK);
  const keywords = cnPairs.map(([w]) => String(w)).filter(Boolean);

  setPill(els.cnStatus, "drawing…");
  renderWordCloud(els.cnCanvas, cnPairs, els.cnStatus);

  renderEnglishCloudFromKeywords(genre, cnPairs).catch(console.error);

  prepareReviewsCN(genre, keywords);
}

async function renderCloudsOnly(genre) {
  const topK = Number(wordfreq?._meta?.top_k_per_genre || 30);
  const cnPairs = (wordfreq?.data?.[genre] || []).slice(0, topK);
  renderWordCloud(els.cnCanvas, cnPairs, els.cnStatus);
  renderEnglishCloudFromKeywords(genre, cnPairs).catch(console.error);
}

// ---------------- Init ----------------
async function init() {
  setMeta("Resolving assets…");
  const { PATH_WORDFREQ, PATH_MOVIES, PATH_REVIEWS } = await resolveAssets();

  setMeta("Loading keyword data…");
  wordfreq = JSON.parse(await fetchText(PATH_WORDFREQ));

  setMeta("Loading movie metadata…");
  const movieText = await fetchText(PATH_MOVIES);
  const movieObjs = rowsToObjects(parseCsvRecords(movieText));
  movieMetaById = new Map();
  for (const o of movieObjs) {
    const id = String(o.movie_id ?? "").trim();
    if (!id) continue;
    movieMetaById.set(id, {
      genres: splitGenresSlash(o.genres),
      title: String(o.title ?? "").trim(),
      url: String(o.url ?? "").trim(),
      year: String(o.year ?? "").trim(),
    });
  }

  setMeta("Loading reviews (xlsx)…");
  reviews = await loadReviewsXlsx(PATH_REVIEWS);

  const genres = Object.keys(wordfreq?.data || {}).sort((a, b) => a.localeCompare(b));
  els.genreSelect.innerHTML = genres.map(g => `<option value="${htmlEscape(g)}">${htmlEscape(g)}</option>`).join("");
  els.genreSelect.value = genres[0] || "";

  els.genreSelect.addEventListener("change", () => {
    renderGenre(els.genreSelect.value).catch(console.error);
  });

  if (els.translateReviewsBtn) {
    els.translateReviewsBtn.addEventListener("click", () => {
      translateCurrentReviewsToEN().catch(console.error);
    });
  }

  setPill(els.cnStatus, "idle");
  setPill(els.enStatus, "idle");
  setMeta("Ready.");

  await renderGenre(els.genreSelect.value);

  let t = null;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      renderCloudsOnly(els.genreSelect.value).catch(console.error);
    }, 180);
  });
}