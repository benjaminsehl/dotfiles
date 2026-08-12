import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://127.0.0.1:4317/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the complete Terminal Wizard shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Terminal Wizard · Own your Mac CLI<\/title>/i);
  assert.match(html, /Own your terminal\./);
  assert.match(html, /Know what is actually running/);
  assert.match(html, /Practice/);
  assert.match(html, /Live Mac/);
  assert.match(html, /Real files, safe shell/);
  assert.match(html, /Powered by wterm/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
  assert.doesNotMatch(html, /fonts\.googleapis|googletagmanager|segment\.com/i);
});

test("sets defense-in-depth document headers", async () => {
  const response = await render();
  const policy = response.headers.get("content-security-policy") ?? "";

  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /ws:\/\/127\.0\.0\.1:4318/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-eval'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("ships terminal parsers locally", async () => {
  const ghostty = new URL("../public/ghostty-vt.wasm", import.meta.url);
  const wterm = new URL("../public/wterm.wasm", import.meta.url);
  const installedGhostty = new URL("../node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm", import.meta.url);
  const installedWterm = new URL("../node_modules/@wterm/core/wasm/wterm.wasm", import.meta.url);
  await Promise.all([access(ghostty), access(wterm)]);
  assert.ok((await stat(ghostty)).size > 400_000);
  assert.ok((await stat(wterm)).size > 10_000);
  assert.deepEqual(await readFile(ghostty), await readFile(installedGhostty));
  assert.deepEqual(await readFile(wterm), await readFile(installedWterm));
});
