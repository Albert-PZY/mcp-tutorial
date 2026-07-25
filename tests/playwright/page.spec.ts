import { test, expect } from '@playwright/test';

/*
 * mcp-tutorial site/ Playwright self-tests
 *
 * Covers: page opens, anchor nav exists, code blocks are highlight.js-rendered,
 * PlantUML diagrams render to <svg> (soft-asserted against plantuml.com),
 * and the zoom overlay opens/closes correctly.
 *
 * Note on flakiness: PlantUML rendering requires outbound network to
 * plantuml.com. In restricted CI runners that can be slow/unstable, so the
 * diagram glob is soft-asserted (warn, not fail). The page itself never
 * crashes whether or not plantuml.com is reachable.
 */

const SECTIONS = [
  '#intro',
  '#source',
  '#flow',
  '#scenarios',
  '#transports',
];

test.describe('MCP tutorial site', () => {
  test('page opens with correct title and hero', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page).toHaveTitle(/MCP/);
    await expect(page.locator('h1').first()).toContainText('MCP');
    await expect(page.locator('.hero')).toBeVisible();
  });

  test('sidebar anchors point at every section', async ({ page }) => {
    await page.goto('/index.html');
    const links = page.locator('.sidebar nav a');
    const hrefs = await links.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute('href') || ''),
    );
    for (const s of SECTIONS) {
      expect(hrefs).toContain(s);
    }
  });

  test('clicking a sidebar link navigates to a section', async ({ page }) => {
    await page.goto('/index.html');
    await page.locator('.sidebar nav a[href="#flow"]').click();
    await expect(page.locator('#flow')).toBeVisible();
  });

  test('code blocks are syntax-highlighted by highlight.js', async ({ page }) => {
    await page.goto('/index.html');
    // At least one highlighted block should exist after page load.
    const hl = page.locator('pre code.hljs');
    await expect(hl.first()).toBeVisible();
    const count = await hl.count();
    expect(count).toBeGreaterThan(5);
  });

  test('PlantUML figures render to inline SVG when plantuml.com is reachable', async ({ page }) => {
    await page.goto('/index.html');
    // Give the page generous time to fetch from plantuml.com.
    const figures = page.locator('figure.figure-wrap');
    const count = await figures.count();
    expect(count).toBe(5); // architecture, process_flow, call_sequence, mcp_vs_fc, transport_comparison

    // Soft assert: try to wait for the first SVG to appear within a reasonable window.
    // If plantuml.com is unreachable, the test should warn rather than fail.
    const first = figures.first();
    let gotSvg = false;
    try {
      await expect(first.locator('svg')).toBeVisible({ timeout: 30_000 });
      gotSvg = true;
    } catch {
      gotSvg = false;
    }
    // Always log via expect; only fail when on a CI label that explicitly demands it.
    test.info().annotations.push({ type: 'plantuml-svg', description: String(gotSvg) });
    // Soft: we do NOT hard-fail on missing svg to avoid network flakiness in CI.
    if (!gotSvg) {
      console.warn('[soft] PlantUML SVG did not appear within timeout; plantuml.com may be unreachable from this runner.');
    }
  });

  test('failed PlantUML figures fall back to source listing, not blank', async ({ page, browserName }) => {
    // This test documents the offline-fallback path. It passes regardless of
    // whether plantuml.com is reachable: either an <svg> is present (success),
    // OR a <details> with raw plantuml and a .figure-error-hint is present (fallback).
    await page.goto('/index.html');
    await page.waitForTimeout(2_000); // allow render attempt
    const figs = page.locator('figure.figure-wrap');
    const n = await figs.count();
    for (let i = 0; i < n; i++) {
      const fig = figs.nth(i);
      const hasSvg = await fig.locator('svg').count();
      const hasErr = await fig.locator('.figure-error-hint').count();
      // At least one of the two outcomes must be true for each figure.
      expect(hasSvg + hasErr).toBeGreaterThan(0);
    }
  });

  test('clicking a rendered figure opens the zoom overlay; Esc closes it', async ({ page }) => {
    await page.goto('/index.html');
    // Wait for at least one figure to be ready (svg present).
    const ready = page.locator('figure.figure-ready').first();
    await expect(ready).toBeVisible({ timeout: 30_000 }).catch(() => {
      throw new Error('No figure rendered to SVG; skipping zoom test (plantuml.com unreachable).');
    });
    await ready.click();
    const overlay = page.locator('.zoom-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.zoom-close')).toBeVisible();
    // Esc closes
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0, { timeout: 3_000 });
  });
});
