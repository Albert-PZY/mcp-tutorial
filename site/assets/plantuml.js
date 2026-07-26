/* plantuml.js — in-browser PlantUML rendering for mcp-tutorial site
 *
 * DOM contract:
 *   <figure class="figure-wrap" data-source="diagrams/xxx.puml">
 *     <pre class="plantuml"></pre>      <!-- source container, hidden by CSS -->
 *   </figure>
 *
 * The outer <figure> is the HOST where the result is shown.
 * The inner <pre class="plantuml"> is only a source container; CSS hides it.
 *
 * Flow per figure:
 *   1. Read source: fetch the file at data-source; fall back to pre.textContent on fetch fail.
 *   2. Encode source with PlantUML's deflate-raw + custom base64 alphabet (zero deps;
 *      uses browser-native CompressionStream).
 *   3. Fetch SVG from https://www.plantuml.com/plantuml/svg/<encoded>
 *      -> success: inline <svg> into <figure>, enable "click to zoom".
 *      -> failure (offline / plantuml.com blocked): render a visible source listing
 *         inside the <figure> so the page never goes blank.
 *
 * Alphabet & padding convention comes straight from plantuml.com/text-encoding:
 * digits first, then uppercase, lowercase, '-' '_'; padding char is '_', not '='.
 *
 * Needs outbound network to plantuml.com at view time. See site/README.md.
 */

// Official PlantUML server (GET + custom deflate/base64 encoding).
const PLANTUML_SVG_BASE = "https://www.plantuml.com/plantuml/svg/";
// Kroki accepts raw PlantUML via POST — used only when plantuml.com fails.
// Encoding schemes differ, so we never reuse the plantuml.com URL payload here.
const KROKI_PLANTUML_SVG = "https://kroki.io/plantuml/svg";
// IMPORTANT: this order must match plantuml.com's text-encoding page exactly.
// A previous version had letters-then-digits here, which made the server return
// the "looks like HUFFMAN encoding / bad URL" error image instead of a diagram.
const PLANTUML_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const PAD = "_";
const FETCH_TIMEOUT_MS = 18000;

function encode64(data) {
  let out = "";
  const len = data.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = data[i];
    const b2 = i + 1 < len ? data[i + 1] : 0;
    const b3 = i + 2 < len ? data[i + 2] : 0;
    out += PLANTUML_ALPHABET[b1 >> 2];
    out += PLANTUML_ALPHABET[((b1 & 0x3) << 4) | (b2 >> 4)];
    out += i + 1 < len ? PLANTUML_ALPHABET[((b2 & 0xf) << 2) | (b3 >> 6)] : PAD;
    out += i + 2 < len ? PLANTUML_ALPHABET[b3 & 0x3f] : PAD;
  }
  return out;
}

async function encodePlantUml(source) {
  // PlantUML expects a raw-deflate stream (no zlib header / adler32).
  // CompressionStream("deflate-raw") is exactly that, available in all modern browsers.
  const stream = new Blob([new TextEncoder().encode(source)]).stream().pipeThrough(
    new CompressionStream("deflate-raw"),
  );
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  return encode64(buf);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


async function fetchText(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}));
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("请求超时 (" + FETCH_TIMEOUT_MS + "ms)");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try plantuml.com first (GET + custom encoding). On network/timeout/error-SVG,
 * fall back to Kroki POST with the raw source so offline-ish networks still work.
 */
async function fetchPlantUmlSvg(encoded, source) {
  try {
    const svg = await fetchText(PLANTUML_SVG_BASE + encoded);
    if (!svg || !svg.includes("<svg")) throw new Error("响应非 SVG");
    if (isServerErrorSvg(svg)) throw new Error("plantuml.com 返回错误图（编码不匹配）");
    return svg;
  } catch (primaryErr) {
    try {
      const svg = await fetchText(KROKI_PLANTUML_SVG, {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: source,
      });
      if (!svg || !svg.includes("<svg")) throw new Error("Kroki 响应非 SVG");
      if (isServerErrorSvg(svg)) throw new Error("Kroki 返回错误图");
      return svg;
    } catch (fallbackErr) {
      const a = primaryErr && primaryErr.message ? primaryErr.message : String(primaryErr);
      const b = fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr);
      throw new Error("plantuml.com: " + a + " · kroki: " + b);
    }
  }
}

function caption(figure) {
  const src = figure.dataset.source || "";
  if (!src) return "";
  return '<figcaption>源: <code>' + escapeHtml(src) + '</code> · 点击图放大</figcaption>';
}

/* PlantUML server returns a 200 SVG even when the encoded URL is wrong — it
 * draws an alert box with this legend text. Detect it so we can fall back to
 * the offline source listing instead of proudly showing an error image.
 */
function isServerErrorSvg(svgText) {
  if (!svgText) return true;
  // PlantUML error legend text fragments — both stable across versions.
  return svgText.includes("generated a bad URL") ||
         svgText.includes("does not look like DEFLATE data") ||
         svgText.includes("looks like your plugin is using HUFFMAN");
}

function setLoading(figure) {
  figure.classList.remove("figure-ready", "figure-error");
  figure.classList.add("figure-loading");
  figure.innerHTML = '<span class="figure-loading-text">正在渲染 PlantUML 图…</span>';
}

function attachSuccess(figure, svgText) {
  if (isServerErrorSvg(svgText)) {
    // Show the failure through the offline branch so the user sees the source
    // rather than an opaque error image. This state should be unreachable now
    // that the encoding is fixed, but keep the safety net.
    showOfflineSource(figure, figure.dataset.__source || "", "PlantUML 返回错误图（编码不匹配）");
    return;
  }
  figure.classList.remove("figure-loading", "figure-error");
  figure.classList.add("figure-ready");
  // Keep SVG intact; sanitize only the outer wrapper attributes that force
  // fixed pixel sizes and fight our responsive CSS.
  figure.innerHTML = svgText + caption(figure);
  const svg = figure.querySelector("svg");
  if (svg) {
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.maxWidth = "100%";
    svg.style.height = "auto";
    svg.style.display = "block";
    // If the server omitted viewBox, rebuild one from declared width/height
    // so the diagram can scale without clipping.
    if (!svg.getAttribute("viewBox")) {
      const vb = svg.getAttribute("viewbox");
      if (vb) svg.setAttribute("viewBox", vb);
    }
  }
  bindZoom(figure);
}

function showOfflineSource(figure, source, msg) {
  figure.classList.remove("figure-ready", "figure-loading");
  figure.classList.add("figure-error");
  // Stash the raw source on the figure so a later "open zoom" hand-off (or
  // retry) still has it even after innerHTML is replaced.
  figure.dataset.__source = source || "";
  figure.dataset.__errorMsg = msg || "";
  figure.innerHTML =
    '<details class="figure-source" open><summary>⚠️ 图表未能在线渲染（点击收起/展开原始 PlantUML 源码）</summary>' +
    '<pre class="figure-source-pre"><code class="language-plantuml">' + escapeHtml(source || "") + '</code></pre></details>' +
    '<p class="figure-error-hint">原因: ' + escapeHtml(msg || "无外网或 PlantUML 服务不可达") +
    " · 源文件: <code>" + escapeHtml(figure.dataset.source || "") + "</code>" +
    " · 可本地用任意 PlantUML 工具打开该 .puml</p>" +
    caption(figure);
  if (window.hljs) {
    const c = figure.querySelector("details pre code");
    if (c) {
      try { window.hljs.highlightElement(c); } catch (e) { /* ignore */ }
    }
  }
}

const zoomBound = new WeakSet();
function bindZoom(figure) {
  if (zoomBound.has(figure)) return;
  zoomBound.add(figure);
  figure.addEventListener("click", (e) => {
    // Don't zoom when the user clicks something inside the offline details block.
    if (e.target.closest("details, summary, pre, code, figcaption")) return;
    openZoom(figure);
  });
  figure.style.cursor = "zoom-in";
}

/* ===== Image lightbox — modeled on viewerjs / medium-zoom patterns =====
 * Header bar with title + close; floating toolbar with zoom/fit/download;
 * wheel-zoom anchored to cursor; drag to pan; double-click toggles; Esc/close
 * backdrop to dismiss. Single shared overlay, recreated per open.
 */
const ZOOM_TITLE = "MCP 教学站点 · 图表放大";

function svgIcon(name) {
  // 18px stroke icons (Heroicons-like) inline so no extra CDN dependency.
  const paths = {
    plus:  '<line x1="9" y1="3" x2="9" y2="15"/><line x1="3" y1="9" x2="15" y2="9"/>',
    minus: '<line x1="3" y1="9" x2="15" y2="9"/>',
    fit:   '<path d="M3 6V3h3M15 6V3h-3M3 12v3h3M15 12v3h-3"/>',
    reset: '<path d="M4 4v5h5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9a6 6 0 1 1 1.5 4.1"/>',
    download: '<path d="M9 3v9M5 8l4 4 4-4M3 14h12v2H3z"/>',
    close: '<line x1="4" y1="4" x2="14" y2="14"/><line x1="14" y1="4" x2="4" y2="14"/>',
  };
  return '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" ' +
    'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + (paths[name] || "") + '</svg>';
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function openZoom(host) {
  const svg = host.querySelector("svg");
  if (!svg) return;
  // Avoid stacking two overlays (e.g. double click racing).
  const existing = document.querySelector(".zoom-overlay");
  if (existing) existing.remove();

  const source = host.dataset.source || "";
  const figureTitle = source
    ? (source.split("/").pop() + " · 点击图放大")
    : "图表放大";

  // ---- Build DOM skeleton ----
  const overlay = document.createElement("div");
  overlay.className = "zoom-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", figureTitle);

  const header = document.createElement("div");
  header.className = "zoom-header";
  const title = document.createElement("div");
  title.className = "zoom-title";
  title.textContent = figureTitle;
  const closeBtn = document.createElement("button");
  closeBtn.className = "zoom-iconbtn zoom-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "关闭 (Esc)");
  closeBtn.innerHTML = svgIcon("close");
  closeBtn.addEventListener("click", dismiss);
  header.appendChild(title);
  header.appendChild(closeBtn);

  const stage = document.createElement("div");
  stage.className = "zoom-stage";
  const stageInner = document.createElement("div");
  stageInner.className = "zoom-stage-inner";
  const innerSvg = svg.cloneNode(true);
  innerSvg.removeAttribute("style");
  innerSvg.removeAttribute("width");
  innerSvg.removeAttribute("height");
  // Stop browsers from treating SVG labels as draggable / selectable text
  // while the user pans — the main source of "blue selection flash".
  innerSvg.setAttribute("draggable", "false");
  innerSvg.style.userSelect = "none";
  innerSvg.style.webkitUserSelect = "none";
  try {
    innerSvg.querySelectorAll("text, tspan").forEach((n) => {
      n.style.userSelect = "none";
      n.style.webkitUserSelect = "none";
      n.style.pointerEvents = "none";
    });
  } catch (e) { /* ignore */ }
  stageInner.appendChild(innerSvg);
  stage.appendChild(stageInner);

  const toolbar = document.createElement("div");
  toolbar.className = "zoom-toolbar";
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "zoom-label";
  zoomLabel.textContent = "100%";
  const addBtn = (name, label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "zoom-iconbtn";
    b.setAttribute("aria-label", label);
    b.setAttribute("title", label);
    b.innerHTML = svgIcon(name);
    b.addEventListener("click", fn);
    return b;
  };

  // ---- Transform state ----
  const MIN = 0.2, MAX = 8;
  const state = { scale: 1, x: 0, y: 0, fitting: true };

  const apply = () => {
    stageInner.style.transform =
      "translate(" + state.x + "px," + state.y + "px) scale(" + state.scale + ")";
    zoomLabel.textContent = Math.round(state.scale * 100) + "%";
  };
  const fit = () => { state.scale = 1; state.x = 0; state.y = 0; state.fitting = true; apply(); };

  const zoomAbout = (factor, cx, cy) => {
    const ns = clamp(state.scale * factor, MIN, MAX);
    // Keep the point under the cursor stationary while scaling.
    state.x = cx - (cx - state.x) * (ns / state.scale);
    state.y = cy - (cy - state.y) * (ns / state.scale);
    state.scale = ns;
    state.fitting = false;
    apply();
  };

  toolbar.appendChild(addBtn("plus", "放大", () => {
    const r = stage.getBoundingClientRect();
    zoomAbout(1.25, r.width / 2, r.height / 2);
  }));
  toolbar.appendChild(addBtn("minus", "缩小", () => {
    const r = stage.getBoundingClientRect();
    zoomAbout(1 / 1.25, r.width / 2, r.height / 2);
  }));
  toolbar.appendChild(addBtn("fit", "适应窗口", fit));
  toolbar.appendChild(addBtn("reset", "复位 100%", () => {
    state.scale = 1; state.x = 0; state.y = 0; state.fitting = false; apply();
  }));
  toolbar.appendChild(addBtn("download", "下载此 SVG", (e) => {
    e.stopPropagation();
    const blob = new Blob([innerSvg.outerHTML], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (source.split("/").pop() || "diagram").replace(/\.puml$/, "") + ".svg";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  toolbar.appendChild(zoomLabel);

  // ---- Pan via pointer drag ----
  // Always preventDefault on pointerdown/move so the browser never starts a
  // native text-selection drag over SVG <text> nodes.
  let dragging = false;
  let start = { x: 0, y: 0, ox: 0, oy: 0 };
  const clearSelection = () => {
    try {
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (e) { /* ignore */ }
  };
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    clearSelection();
    dragging = true;
    start = { x: e.clientX, y: e.clientY, ox: state.x, oy: state.y };
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    stage.classList.add("dragging");
    document.body.classList.add("zoom-dragging");
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    e.preventDefault();
    clearSelection();
    state.x = start.ox + (e.clientX - start.x);
    state.y = start.oy + (e.clientY - start.y);
    state.fitting = false;
    apply();
  });
  const endDrag = () => {
    dragging = false;
    stage.classList.remove("dragging");
    document.body.classList.remove("zoom-dragging");
    clearSelection();
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  // Belt-and-suspenders: kill selectstart / dragstart inside the stage.
  stage.addEventListener("selectstart", (e) => { e.preventDefault(); });
  stage.addEventListener("dragstart", (e) => { e.preventDefault(); });

  // ---- Wheel zoom anchored at cursor ----
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const cx = e.clientX - r.left - r.width / 2;
    const cy = e.clientY - r.top - r.height / 2;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAbout(factor, cx, cy);
  }, { passive: false });

  // Double-click toggles between fit and 200%.
  stage.addEventListener("dblclick", () => {
    if (state.scale > 1.5) fit();
    else {
      const r = stage.getBoundingClientRect();
      zoomAbout(2 / state.scale, 0, 0);
    }
  });

  // ---- Dismiss wiring ----
  function dismiss() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    document.body.classList.remove("zoom-lock", "zoom-dragging");
  }
  function onKey(e) {
    if (e.key === "Escape") { dismiss(); }
    else if (e.key === "+" || e.key === "=") { stage.getBoundingClientRect(); const r = stage.getBoundingClientRect(); zoomAbout(1.25, r.width/2, r.height/2); }
    else if (e.key === "-" || e.key === "_") { const r = stage.getBoundingClientRect(); zoomAbout(1/1.25, r.width/2, r.height/2); }
    else if (e.key === "0") { fit(); }
  }
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismiss();
  });

  overlay.appendChild(header);
  overlay.appendChild(stage);
  overlay.appendChild(toolbar);
  document.body.appendChild(overlay);
  document.body.classList.add("zoom-lock");
  closeBtn.focus();
  fit();
}

async function renderOne(figure) {
  // data-source lives on the figure; pre.plantuml is just a hidden fallback container.
  const pre = figure.querySelector("pre.plantuml");
  let source = (pre && pre.textContent.trim()) || "";
  setLoading(figure);

  if (figure.dataset.source) {
    try {
      source = await fetchText(figure.dataset.source);
    } catch (e) {
      // keep whatever inline source we had; if also empty, offline branch shows a hint.
    }
  }
  // Normalize line endings — Windows CRLF can confuse some PlantUML parsers
  // when the deflate payload is built from mixed endings across machines.
  source = String(source || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  figure.dataset.__source = source;

  if (!source) {
    showOfflineSource(figure, "(空源码)", "未取到图源（检查 data-source 路径是否可访问）");
    return;
  }
  if (typeof CompressionStream === "undefined") {
    showOfflineSource(figure, source, "当前浏览器不支持 CompressionStream，无法在线编码 PlantUML");
    return;
  }
  try {
    const encoded = await encodePlantUml(source);
    const svg = await fetchPlantUmlSvg(encoded, source);
    attachSuccess(figure, svg);
  } catch (err) {
    showOfflineSource(figure, source, err.message || String(err));
  }
}

async function renderAll() {
  const figures = Array.from(document.querySelectorAll(".figure-wrap"));
  // Render in parallel but cap concurrency so we don't stampede plantuml.com
  // (5 figures is fine all-at-once; keep the helper for future growth).
  const concurrency = 3;
  let idx = 0;
  async function worker() {
    while (idx < figures.length) {
      const i = idx++;
      await renderOne(figures[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, figures.length) }, worker));
  // re-run code highlighter for any newly injected code (offline branch etc.)
  if (window.hljs) {
    try { window.hljs.highlightAll(); } catch (e) { /* ignore */ }
  }
}

window.McpSite = window.McpSite || {};
window.McpSite.renderPlantUml = renderAll;
window.McpSite.openZoom = openZoom;
