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
 * Needs outbound network to plantuml.com at view time. See site/README.md.
 */

const PLANTUML_BASE = "https://www.plantuml.com/plantuml/svg/";
const PLANTUML_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encode64(data) {
  let out = "";
  for (let i = 0; i < data.length; i += 3) {
    const b1 = data[i];
    const b2 = i + 1 < data.length ? data[i + 1] : 0;
    const b3 = i + 2 < data.length ? data[i + 2] : 0;
    out += PLANTUML_ALPHABET[b1 >> 2];
    out += PLANTUML_ALPHABET[((b1 & 0x3) << 4) | (b2 >> 4)];
    out += i + 1 < data.length ? PLANTUML_ALPHABET[((b2 & 0xf) << 2) | (b3 >> 6)] : "_";
    out += i + 2 < data.length ? PLANTUML_ALPHABET[b3 & 0x3f] : "_";
  }
  return out;
}

async function encodePlantUml(source) {
  // PlantUML expects a raw-deflate stream (no zlib header / adler32).
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


async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.text();
}

function caption(figure) {
  const src = figure.dataset.source || "";
  if (!src) return "";
  return '<figcaption>源: <code>' + escapeHtml(src) + '</code> · 点击图放大</figcaption>';
}

function attachSuccess(figure, svgText) {
  figure.classList.add("figure-ready");
  figure.classList.remove("figure-error");
  figure.innerHTML = svgText + caption(figure);
  const svg = figure.querySelector("svg");
  if (svg) {
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.maxWidth = "100%";
    svg.style.height = "auto";
  }
  bindZoom(figure);
}

function showOfflineSource(figure, source, msg) {
  figure.classList.remove("figure-ready");
  figure.classList.add("figure-error");
  figure.innerHTML =
    '<details class="figure-source"><summary>⚠️ 图表未能在线渲染（plantuml.com 不可达，点击展开原始 PlantUML 源码）</summary>' +
    '<pre class="figure-source-pre"><code class="language-plantuml">' + escapeHtml(source) + '</code></pre></details>' +
    '<p class="figure-error-hint">原因: ' + escapeHtml(msg || "无外网或 plantuml.com 不可达") +
    " · 源文件: <code>" + escapeHtml(figure.dataset.source || "") + "</code></p>" +
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

// Full-screen pan/zoom overlay.
function openZoom(host) {
  const svg = host.querySelector("svg");
  if (!svg) return;
  const overlay = document.createElement("div");
  overlay.className = "zoom-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const close = document.createElement("button");
  close.className = "zoom-close";
  close.textContent = "✕ 关闭 (Esc)";
  close.addEventListener("click", () => overlay.remove());

  const controls = document.createElement("div");
  controls.className = "zoom-controls";
  const scale = { v: 1 };
  const pos = { x: 0, y: 0 };

  const wrap = document.createElement("div");
  wrap.className = "zoom-stage";
  wrap.innerHTML = svg.outerHTML;
  const inner = wrap.querySelector("svg");
  inner.removeAttribute("style");
  const apply = () => {
    inner.style.transform = "translate(" + pos.x + "px," + pos.y + "px) scale(" + scale.v + ")";
  };

  const addBtn = (label, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", fn);
    controls.appendChild(b);
  };
  addBtn("＋ 放大", () => { scale.v = Math.min(8, scale.v * 1.25); apply(); });
  addBtn("－ 缩小", () => { scale.v = Math.max(0.2, scale.v / 1.25); apply(); });
  addBtn("复位", () => { scale.v = 1; pos.x = 0; pos.y = 0; apply(); });

  let dragging = false;
  let start = { x: 0, y: 0, ox: 0, oy: 0 };
  wrap.addEventListener("pointerdown", (e) => {
    dragging = true;
    start = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    pos.x = start.ox + (e.clientX - start.x);
    pos.y = start.oy + (e.clientY - start.y);
    apply();
  });
  wrap.addEventListener("pointerup", () => { dragging = false; });
  wrap.addEventListener("pointercancel", () => { dragging = false; });
  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    scale.v = Math.min(8, Math.max(0.2, scale.v * factor));
    apply();
  }, { passive: false });

  const onKey = (e) => {
    if (e.key === "Escape") {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
  });

  overlay.appendChild(close);
  overlay.appendChild(controls);
  overlay.appendChild(wrap);
  document.body.appendChild(overlay);
  close.focus();
}

async function renderOne(figure) {
  // data-source lives on the figure; pre.plantuml is just a hidden fallback container.
  const pre = figure.querySelector("pre.plantuml");
  let source = (pre && pre.textContent.trim()) || "";
  if (figure.dataset.source) {
    try {
      source = await fetchText(figure.dataset.source);
    } catch (e) {
      // keep whatever inline source we had; if also empty, offline branch shows a hint.
    }
  }
  if (!source) {
    showOfflineSource(figure, "(无源码)", "未取到图源");
    return;
  }
  try {
    const encoded = await encodePlantUml(source);
    const svg = await fetchText(PLANTUML_BASE + encoded);
    if (!svg || !svg.includes("<svg")) throw new Error("响应非 SVG");
    attachSuccess(figure, svg);
  } catch (err) {
    showOfflineSource(figure, source, err.message || String(err));
  }
}

async function renderAll() {
  const figures = Array.from(document.querySelectorAll(".figure-wrap"));
  await Promise.all(figures.map(renderOne));
  // re-run code highlighter for any newly injected code (offline branch etc.)
  if (window.hljs) window.hljs.highlightAll();
}

window.McpSite = window.McpSite || {};
window.McpSite.renderPlantUml = renderAll;
window.McpSite.openZoom = openZoom;
