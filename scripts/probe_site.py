"""Smoke-test the site with Playwright: take screenshots and emit DOM diagnostics.

Run:  python scripts/probe_site.py
It starts a tiny static HTTP server on http://127.0.0.1:8765/ pointing at
./site, opens it with chromium, waits for PlantUML render attempts, then dumps
screenshots + a JSON report so we can verify fixes without a human in the loop.
"""
from __future__ import annotations

import http.server
import json
import socketserver
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
PORT = 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(SITE), **kw)

    def log_message(self, *a, **kw):  # silence noisy stdout
        pass


def serve():
    srv = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


def probe(page, label: str) -> dict:
    res = page.evaluate(
        """() => {
      const figures = Array.from(document.querySelectorAll('figure.figure-wrap'));
      const topbar = document.getElementById('topbar');
      const tb = topbar ? topbar.getBoundingClientRect() : null;
      return {
        title: document.title,
        dataTheme: document.documentElement.getAttribute('data-theme'),
        figures: figures.map(f => ({
          source: f.dataset.source,
          ready: f.classList.contains('figure-ready'),
          error: f.classList.contains('figure-error'),
          hasSvg: !!f.querySelector('svg'),
          svgIsError: !!f.querySelector('g.legend')?.querySelector('text')?.textContent?.includes('bad URL'),
          firstText: (f.textContent || '').slice(0, 120),
        })),
        toggleBtn: (() => {
          const b = document.getElementById('theme-toggle');
          if (!b) return null;
          const r = b.getBoundingClientRect();
          return { visible: r.width > 0, x: r.x, y: r.y, top: r.top,
                   text: b.textContent.trim() };
        })(),
        topbarInView: tb ? { x: tb.x, y: tb.y, top: tb.top, width: tb.width } : null,
        zoomOverlayActive: !!document.querySelector('.zoom-overlay'),
        zoomToolbarBtns: Array.from(document.querySelectorAll('.zoom-toolbar .zoom-iconbtn')).map(b => b.getAttribute('aria-label')),
        bodyHeight: document.body.scrollHeight,
      };
    }"""
    )
    res["label"] = label
    return res


def main():
    srv = serve()
    url = f"http://127.0.0.1:{PORT}/"
    report = {"url": url, "captures": []}
    shot_dir = ROOT / "scripts" / "_shots"
    shot_dir.mkdir(exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 1080})
        page = ctx.new_page()
        errs: list[str] = []
        page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
        # Capture network failures so we can see what the PlantUML 400 response said.
        failed_responses: list[str] = []

        def on_response(resp):
            if resp.status >= 400 and "plantuml" in resp.url:
                try:
                    # body() may throw if response is consumed; guard with try.
                    body = resp.text()
                except Exception as ex:  # pragma: no cover - probe only
                    body = f"<body threw: {ex}>"
                failed_responses.append(
                    f"HTTP {resp.status} {resp.url[:80]}... -> {body[:300]}"
                )

        page.on("response", on_response)
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        # PlantUML fetches happen async — wait for either svg or figure-error.
        page.wait_for_function(
            """() => {
              const fs = document.querySelectorAll('figure.figure-wrap');
              if (!fs.length) return false;
              return Array.from(fs).every(f =>
                f.classList.contains('figure-ready') || f.classList.contains('figure-error'));
            }""",
            timeout=60000,
        )
        time.sleep(1.0)  # let hljs finish
        report["captures"].append(probe(page, "initial-light"))
        page.screenshot(path=str(shot_dir / "01-initial-light-full.png"), full_page=True)
        # theme toggle visibility + position
        page.screenshot(path=str(shot_dir / "02-sidebar.png"), clip={"x": 0, "y": 0, "width": 256, "height": 1080})
        # Switch to dark
        page.evaluate("""() => {
          const b = document.getElementById('theme-toggle');
          if (b) b.click();
        }""")
        time.sleep(0.4)
        report["captures"].append(probe(page, "after-toggle-dark"))
        page.screenshot(path=str(shot_dir / "03-dark-full.png"), full_page=True)
        # Try to open zoom modal of the first ready figure
        page.evaluate("""() => {
          const f = document.querySelector('figure.figure-wrap.figure-ready');
          if (f) f.click();
        }""")
        time.sleep(0.5)
        report["captures"].append(probe(page, "zoom-modal-open"))
        page.screenshot(path=str(shot_dir / "04-zoom-modal.png"))
        report["console"] = errs
        report["failedPlantuml"] = failed_responses

        # Close zoom & finish
        page.keyboard.press("Escape")
        browser.close()

    out = ROOT / "scripts" / "_probe-report.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print("report ->", out)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    srv.shutdown()


if __name__ == "__main__":
    main()
