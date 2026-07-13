import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../public/", import.meta.url);
const files = ["resources.html", ...readdirSync(new URL("resources/", root)).map((name) => `resources/${name}`)];

test("every editorial URL has complete share metadata and clean public labels", () => {
  for (const file of files) {
    const html = readFileSync(new URL(file, root), "utf8");
    assert.match(html, /property="og:image"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /name="twitter:image"/);
    assert.doesNotMatch(html, /2,?000\+?\s*word|<span>\d[\d,]+ words<\/span>/i);
  }
});

test("editorial layout stays readable on phones", () => {
  const css = readFileSync(new URL("editorial.css", root), "utf8");
  assert.match(css, /@media\(max-width:820px\)/);
  assert.match(css, /overflow-x:auto/);
});
