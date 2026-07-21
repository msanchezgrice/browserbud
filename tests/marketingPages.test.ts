import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const pages = [
  ["vs/screenhelp.html", "https://browserbud.com/vs/screenhelp"],
  ["workflows/research-session-recap.html", "https://browserbud.com/workflows/research-session-recap"],
  ["workflows/screen-aware-notes.html", "https://browserbud.com/workflows/screen-aware-notes"],
  ["workflows/ask-questions-about-current-page.html", "https://browserbud.com/workflows/ask-questions-about-current-page"],
] as const;

test("comparison and workflow pages are canonical, crawlable, and action-oriented", async () => {
  const sitemap = await readFile(path.join(root, "public/sitemap.xml"), "utf8");
  for (const [file, canonical] of pages) {
    const html = await readFile(path.join(root, "public", file), "utf8");
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}">`));
    assert.match(html, /Direct answer/i);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /href="\/app\?utm_source=/);
    assert.ok(sitemap.includes(`<loc>${canonical}</loc>`));
  }
});

test("ScreenHelp comparison stays neutral and cites current official surfaces", async () => {
  const html = await readFile(path.join(root, "public/vs/screenhelp.html"), "utf8");
  assert.match(html, /not a performance ranking/i);
  assert.match(html, /https:\/\/screenhelp\.ai\//);
  assert.match(html, /chromewebstore\.google\.com\/detail\/screenhelp/);
  assert.doesNotMatch(html, /beats|superior|guaranteed/i);
});
