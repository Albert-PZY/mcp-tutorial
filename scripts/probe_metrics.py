"""Extract layout metrics via Playwright so we can sanity-check the visual
rework without image-in-capable model vision."""
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

def metrics(page):
    return page.evaluate("""() => {
        function box(sel){
            const el = typeof sel==='string'?document.querySelector(sel):sel;
            if(!el) return null;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return { x: Math.round(r.x), y: Math.round(r.y), top:Math.round(r.top),
                     width: Math.round(r.width), height: Math.round(r.height),
                     right: Math.round(r.right), bottom: Math.round(r.bottom) };
        }
        function style(sel, props){
            const el = document.querySelector(sel); if(!el) return null;
            const cs = getComputedStyle(el);
            const out = {};
            props.forEach(p=>out[p]=cs.getPropertyValue(p));
            return out;
        }
        const f = document.querySelector('figure.figure-ready');
        const fBox = f ? box(f) : null;
        const zoom = document.querySelector('.zoom-overlay');
        const tb = box('#topbar');
        return {
            theme: document.documentElement.getAttribute('data-theme'),
            viewportWidth: window.innerWidth,
            topbar: tb,
            topbarZ: style('#topbar',['z-index','backdrop-filter','background-color'])['z-index'],
            topbarStyle: style('#topbar',['z-index']),
            themeToggle: box('#theme-toggle'),
            themeToggleAppearance: style('#theme-toggle',['background-color','color','border-color']),
            backToTopBtn: box('#back-to-top'),
            backToTopHidden: document.getElementById('back-to-top').hidden,
            sidebar: box('.sidebar'),
            contentSection: box('.content > section'),
            hero: box('.hero'),
            firstFigure: { box: fBox },
            zoomOverlay: zoom ? {
                box: box('.zoom-overlay'),
                header: box('.zoom-header'),
                toolbar: box('.zoom-toolbar'),
                toolbarPos: style('.zoom-toolbar',['position','bottom','right']),
                stage: box('.zoom-stage'),
                closeBtn: box('.zoom-close'),
                btnCount: document.querySelectorAll('.zoom-toolbar .zoom-iconbtn').length,
                label: document.querySelector('.zoom-label')?.textContent,
                titleText: document.querySelector('.zoom-title')?.textContent,
            } : null,
            bodyScrollHeight: document.body.scrollHeight,
        };
    }""")

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width":1440,"height":1080})
    page = ctx.new_page()
    page.goto(f"http://127.0.0.1:{PORT}/", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_function("""() => {
        const f = document.querySelectorAll('figure.figure-wrap');
        if (!f.length) return false;
        return Array.from(f).every(x => x.classList.contains('figure-ready') || x.classList.contains('figure-error'));
    }""", timeout=60000)
    time.sleep(1.5)  # let hljs / paints settle (not blocked on)
    report = {}
    report["viewport_light_top"] = metrics(page)
    # scroll a bit and toggle dark
    page.evaluate("() => window.scrollTo({top:700,behavior:'instant'})")
    time.sleep(.3)
    report["scrolled_dark_top"] = metrics(page)  # back-to-top expected to show after scroll
    page.evaluate("() => document.getElementById('theme-toggle').click()")
    time.sleep(.4)
    report["scrolled_dark_after_toggle"] = metrics(page)
    # back to top
    page.evaluate("() => window.scrollTo({top:0,behavior:'instant'})")
    time.sleep(.3)
    report["top_dark"] = metrics(page)
    # open zoom
    page.evaluate("() => document.querySelector('figure.figure-wrap.figure-ready').click()")
    time.sleep(.6)
    report["zoom_open_light"] = metrics(page)
    # try toolbar interactions: zoom 200%, pan a bit
    page.evaluate("""() => {
        const stage = document.querySelector('.zoom-stage');
        const e = new WheelEvent('wheel',{deltaY:-100,clientX:720,clientY:400,bubbles:true,cancelable:true});
        stage.dispatchEvent(e);
    }""")
    time.sleep(.2)
    report["after_wheel_zoom"] = metrics(page)
    page.keyboard.press("Escape")
    time.sleep(.3)
    report["zoom_closed"] = metrics(page)
    b.close()

out = ROOT / "scripts" / "_metrics.json"
out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps(report, indent=2, ensure_ascii=False))
srv.shutdown()
