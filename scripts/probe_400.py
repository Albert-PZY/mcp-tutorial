"""Re-fetch the exact failing-URL strings from the page, from inside the page
context, so we can read the 400 response body without losing it on browser close.

Strategy:
 1. navigate to the site,
 2. once PlantUML has rendered/failed, look at figures and remember which are
    still in figure-error (the 400 ones),
 3. ask the page to field one of those exact URLs again with fetch(), capture
    the body, and print it.
"""
from __future__ import annotations
import http.server, socketserver, threading, time, json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
PORT = 8765

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw): super().__init__(*a,directory=str(SITE),**kw)
    def log_message(self,*a,**kw): pass
srv = socketserver.TCPServer(("127.0.0.1",PORT),H)
threading.Thread(target=srv.serve_forever,daemon=True).start()

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_context(viewport={"width":1440,"height":1080}).new_page()

    # Track the URLs each figure tries to load, by patching fetch().
    pg.goto(f"http://127.0.0.1:{PORT}/", wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_function("""() => {
        const f = document.querySelectorAll('figure.figure-wrap');
        if (!f.length) return false;
        return Array.from(f).every(x => x.classList.contains('figure-ready') || x.classList.contains('figure-error'));
    }""", timeout=60000)

    # Re-run encode for the failed ones, then fetch them in-page (same UA,
    # same Referer → identical to the original request), but synchronously.
    result = pg.evaluate("""async () => {
        const OFFICIAL = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
        const PAD = "_";
        function encode64(data) {
            let out=""; const L=data.length;
            for (let i=0;i<L;i+=3) {
                const b1=data[i], b2=i+1<L?data[i+1]:0, b3=i+2<L?data[i+2]:0;
                out+=OFFICIAL[b1>>2];
                out+=OFFICIAL[((b1&0x3)<<4)|(b2>>4)];
                out+=i+1<L?OFFICIAL[((b2&0xf)<<2)|(b3>>6)]:PAD;
                out+=i+2<L?OFFICIAL[b3&0x3f]:PAD;
            }
            return out;
        }
        async function encsrc(src) {
            const s = new Blob([new TextEncoder().encode(src)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
            const buf = new Uint8Array(await new Response(s).arrayBuffer());
            return encode64(buf);
        }
        const failed = Array.from(document.querySelectorAll('figure.figure-wrap.figure-error'));
        const out = [];
        for (const f of failed) {
            const src = f.dataset.__source || "";
            if (!src) { out.push({source: f.dataset.source, err: "no source"}); continue; }
            const encoded = await encsrc(src);
            const url = "https://www.plantuml.com/plantuml/svg/" + encoded;
            try {
                const r = await fetch(url);
                const body = await r.text();
                out.push({source: f.dataset.source, status: r.status, urlHead: url.slice(0,140), bodyHead: body.slice(0,3000)});
            } catch (e) {
                out.push({source: f.dataset.source, err: String(e)});
            }
        }
        return out;
    }""")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    b.close()
srv.shutdown()
