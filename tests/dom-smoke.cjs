/* DOM smoke test for site/assets/plantuml.js — zero deps.
 * Validates:
 *   SUCCESS path: 5 figures get <figure-ready> + inline <svg>.
 *   OFFLINE path: 5 figures get <figure-error> + visible source / hint.
 */
const fs = require("fs");
const zlib = require("zlib");

function makeEl(tag, attrs = {}) {
  const el = {
    tagName: tag,
    children: [],
    parent: null,
    _cls: new Set(),
    _attrs: {},
    dataset: {},
    style: {},
    _listeners: {},
    textContent: "",
  };
  for (const k of Object.keys(attrs)) {
    el._attrs[k] = attrs[k];
    if (k.startsWith("data-")) el.dataset[k.slice(5)] = attrs[k];
    if (k === "class") (attrs[k].split(/\s+/)).forEach((c) => c && el._cls.add(c));
  }
  el.classList = {
    add() { for (const c of arguments) el._cls.add(c); },
    remove() { for (const c of arguments) el._cls.delete(c); },
    contains(c) { return el._cls.has(c); },
  };
  el.setAttribute = (k, v) => { el._attrs[k] = v; if (k.startsWith("data-")) el.dataset[k.slice(5)] = v; };
  el.removeAttribute = (k) => { delete el._attrs[k]; };
  el.getAttribute = (k) => (k in el._attrs ? el._attrs[k] : null);
  el.appendChild = (c) => { el.children.push(c); c.parent = el; return c; };
  el.querySelectorAll = function (sel) {
    const out = [];
    const walk = (n) => {
      for (const c of n.children || []) {
        let match = false;
        if (sel[0] === ".") match = c._cls.has(sel.slice(1));
        else match = c.tagName === sel;
        if (match) out.push(c);
        walk(c);
      }
    };
    walk(el);
    return out;
  };
  el.querySelector = function (sel) {
    return el.querySelectorAll(sel)[0] || null;
  };
  el.closest = () => null;
  el.addEventListener = (t, fn) => { (el._listeners[t] || (el._listeners[t] = [])).push(fn); };
  el.click = () => {};
  el.outerHTML = "<" + tag + " />";
  return el;
}

let svgOk = true;
let fetchCount = 0;
globalThis.fetch = async (url) => {
  fetchCount++;
  if (url.startsWith("https://www.plantuml.com"))
    return svgOk
      ? { ok: true, status: 200, text: async () => "<svg><rect/></svg>" }
      : { ok: false, status: 500, text: async () => "" };
  if (url.startsWith("diagrams/"))
    return { ok: true, status: 200, text: async () => `@startuml ${url.split("/")[1].replace(".puml", "")}\nA-->B\n@enduml` };
  return { ok: false, status: 404, text: async () => "404" };
};

// Node-only shim: CompressionStream + Blob/stream + Response backed by zlib.deflateRawSync
globalThis.Blob = class {
  constructor(parts) {
    this._p = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  }
  stream() {
    const compressed = zlib.deflateRawSync(this._p);
    return { pipeThrough() { return { _payload: compressed }; } };
  }
};
globalThis.Response = class {
  constructor(s) { this._payload = s ? s._payload : null; }
  async arrayBuffer() { return Uint8Array.from(this._payload || Buffer.alloc(0)).buffer; }
  async text() { return (this._payload || Buffer.alloc(0)).toString("utf8"); }
  get ok() { return true; } get status() { return 200; }
};
globalThis.TextEncoder = require("util").TextEncoder;

const root = "F:/in-house project/mcp-tutorial";
const src = fs.readFileSync(root + "/site/assets/plantuml.js", "utf-8");

const docEl = makeEl("html");
const body = makeEl("body");
docEl.appendChild(body);
docEl.querySelectorAll = (sel) => body.querySelectorAll(sel);
docEl.querySelector = (sel) => body.querySelector(sel);
docEl.createElement = makeEl;
docEl.body = body;

const figures = [
  ["architecture", "diagrams/architecture.puml"],
  ["call_sequence", "diagrams/call_sequence.puml"],
  ["process_flow", "diagrams/process_flow.puml"],
  ["transport_comparison", "diagrams/transport_comparison.puml"],
  ["mcp_vs_function_calling", "diagrams/mcp_vs_function_calling.puml"],
];
for (const [name, src2] of figures) {
  const fig = makeEl("figure", { class: "figure-wrap", "data-figure": name, "data-source": src2 });
  const pre = makeEl("pre", { class: "plantuml" });
  pre.textContent = "(inline-fallback if fetch fails)";
  fig.appendChild(pre);
  body.appendChild(fig);
}

const win = { document: docEl, McpSite: null, hljs: null, matchMedia: null };
const fn = new Function("window", "document", src + "\n; return window.McpSite;");
win.McpSite = fn(win, docEl);
console.log("McpSite exports:", Object.keys(win.McpSite || {}));

(async function run() {
  await win.McpSite.renderPlantUml();
  await new Promise((r) => setTimeout(r, 50));

  const figs = body.querySelectorAll(".figure-wrap");
  let ready = 0, err = 0;
  for (const f of figs) { if (f._cls.has("figure-ready")) ready++; if (f._cls.has("figure-error")) err++; }
  const svgCount = body.querySelectorAll("svg").length;
  console.log({ phase: "SUCCESS", figures: figs.length, ready, err, svgCount, fetches: fetchCount });
  if (ready !== 5 || err !== 0) { console.log("FAIL success path"); process.exit(1); }

  // Offline path
  svgOk = false; fetchCount = 0;
  for (const f of body.querySelectorAll(".figure-wrap")) {
    f._cls.delete("figure-ready"); f._cls.delete("figure-error");
    f.children = [];
  }
  await win.McpSite.renderPlantUml();
  await new Promise((r) => setTimeout(r, 50));

  let r2 = 0, e2 = 0;
  for (const f of body.querySelectorAll(".figure-wrap")) { if (f._cls.has("figure-ready")) r2++; if (f._cls.has("figure-error")) e2++; }
  const hints = body.querySelectorAll(".figure-error-hint").length;
  console.log({ phase: "OFFLINE", ready: r2, error: e2, hints });
  if (r2 !== 0 || e2 !== 5) { console.log("FAIL offline path"); process.exit(2); }
  if (hints !== 5) { console.log("WARN offline hint missing"); }
  console.log("ALL PASS");
})();
