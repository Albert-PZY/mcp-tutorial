/* plantuml.js — in-browser PlantUML rendering via the official public server
 *
 * Strategy:
 *   1. Read the diagram source from a `<pre class="plantuml">` (inline) OR fetch it
 *      from `src/data-source` if set (preferred, keeps the .puml as single source).
 *   2. Encode the source with PlantUML's deflate+base64 algorithm
 *      (`https://www.plantuml.com/plantuml/svg/<encoded>`), using the browser's
 *      built-in `CompressionStream("deflate-raw")` — zero npm deps.
 *   3. Fetch the SVG and inline it into the host element; if fetch fails
 *      (offline / network blocked), fall back to showing the raw source so
 *      the page never goes blank.
 *
 * Transparency note: this requires outbound network to plantuml.com at view
 * time. See site/README.md.
 */

const PLANTUML_BASE =
  "https://www.plantuml.com/plantuml/svg/";

// PlantUML's own base64 alphabet (different from the standard one).
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
  // PlantUML expects a "0x00 0x01 / deflate-raw" stream.
  // Browsers ship `CompressionStream("deflate-raw")`; we transform a stream.
  const enc = new TextEncoder();
  const stream = new Blob([enc.encode(source)]).stream().pipeThrough(
    new CompressionStream("deflate-raw"),
  );
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  return encode64(buf);
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function attachZoom(host, svgText) {
  // Build a clickable wrapper so users can pan/zoom the diagram ("无损放大").
  host.classList.add("figure-ready");
  host.innerHTML = svgText;
  const svg = host.querySelector("svg");
  if (svg) {
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.maxWidth = "100%";
    svg.style.height = "auto";
  }
  // Zoom indicator
  if (!host.dataset.zoomBound) {
    host.addEventListener("click", () => openZoom(host));
    host.dataset.zoomBound = "1";
  }
}

function showError(host, source, msg) {
  host.classList.add("figure-error");
  const path = host.dataset.source || "";
  const hint =
    `图表源文件: <code>${escapeHtml(path)}</code><br>` +
    `原因: ${escapeHtml(msg || "无外网或 plantuml.com 不可达")}<br>` +
    "可手动把源文件用本地 PlantUML 渲染，或在外网环境打开本页。";
  host.innerHTML =
    `<details><summary>⚠️ 图表未能在线渲染（点击查看原始 PlantUML 源码）</summary>` +
    `<pre><code class="language-plantuml">${escapeHtml(source)}</code></pre></details>` +
    `<p class="figure-error-hint">${hint}</p>`;
  if (host.dataset.source) {
    // Pull the actual .puml content into the <pre> so the details block shows real source.
    fetch(host.dataset.source)
      .then((r) => r.ok ? r.text() : Promise.reject(r.status))
      .then((text) => {
        const code = host.querySelector("details pre code");
        if (code) code.textContent = text;
        if (window.hljs) window.hljs.highlightElement(code);
      })
      .catch(() => {
        /* already showing the hint; nothing more to do */
      });
  }
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

  const wrap = document.createElement("div");
  wrap.className = "zoom-stage";
  wrap.innerHTML = svg.outerHTML;
  const innerSvg = wrap.querySelector("svg");
  innerSvg.removeAttribute("style");

  const controls = document.createElement("div");
  controls.className = "zoom-controls";
  const scale = { v: 1.0 };
  const pos = { x: 0, y: 0 };
  const render = () => {
    innerSvg.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${scale.v})`;
  };
  const addBtn = (label, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", fn);
    controls.appendChild(b);
  };
  addBtn("＋ 放大", () => { scale.v = Math.min(8, scale.v * 1.25); render(); });
  addBtn("－ 缩小", () => { scale.v = Math.max(0.2, scale.v / 1.25); render(); });
  addBtn("复位", () => { scale.v = 1; pos.x = 0; pos.y = 0; render(); });

  // Drag to pan
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
    render();
  });
  wrap.addEventListener("pointerup", () => { dragging = false; });
  wrap.addEventListener("pointercancel", () => { dragging = false; });

  // Wheel zoom (without consuming page scroll inside the overlay)
  wrap.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      scale.v = Math.min(8, Math.max(0.2, scale.v * factor));
      render();
    },
    { passive: false },
  );

  overlay.addEventListener("keydown", () => {}); // keep focus
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

async function renderOne(host) {
  // Prefer the external file (single source of truth) when present.
  let source = "";
  if (host.dataset.remote) source = host.textContent.trim();
  if (host.dataset.source) {
    try {
      source = await fetchText(host.dataset.source);
      host.dataset.remote = "ok";
    } catch {
      // Fall back to inline (set when fetched-from-cluster also fails later)
      source = host.textContent.trim();
      host.dataset.remote = "offline";
    }
  } else {
    source = host.textContent.trim();
  }
  try {
    const encoded = await encodePlantUml(source);
    const url = PLANTUML_BASE + encoded;
    const svg = await fetchText(url);
    if (!svg || !svg.includes("<svg")) throw new Error("empty svg");
    host.dataset.rendered = "1";
    attachZoom(host, svg);
  } catch (err) {
    showError(host, source, err.message || String(err));
  }
}

async function renderAll() {
  const hosts = Array.from(document.querySelectorAll("pre.plantuml, .plantuml-host"));
  // Render in parallel; each is independent.
  await Promise.all(hosts.map(renderOne));
  // Re-run code highlighter for any error <pre><code> we just injected.
  if (window.hljs) window.hljs.highlightAll();
}

window.McpSite = window.McpSite || {};
window.McpSite.renderPlantUml = renderAll;
