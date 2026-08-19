import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isLoopbackAddress, startStaticServer } from "../scripts/run-local.mjs";

let server;
let origin;

function requestStatus({ path = "/", host }) {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    const clientRequest = request({
      hostname: target.hostname,
      port: target.port,
      path,
      headers: host ? { Host: host } : undefined,
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    clientRequest.once("error", reject);
    clientRequest.end();
  });
}

test.before(async () => {
  server = await startStaticServer({ port: 0 });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("serves the local-only Terminal Tutor application shell", async () => {
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Terminal Tutor · Own your Mac CLI<\/title>/i);
  assert.match(html, /name="description"/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<script[^>]+type="module"[^>]+src="\/assets\/[^"]+\.js"/);
  assert.match(html, /<link[^>]+rel="stylesheet"[^>]+href="\/assets\/[^"]+\.css"/);
  assert.doesNotMatch(html, /vercel|cloudflare|vinext|codex-preview/i);
});

test("sets defense-in-depth headers on the built-in local server", async () => {
  const response = await fetch(origin);
  const policy = response.headers.get("content-security-policy") ?? "";

  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /ws:\/\/127\.0\.0\.1:4318/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-eval'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("serves only built files over GET or HEAD", async () => {
  const head = await fetch(origin, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const missing = await fetch(`${origin}/package.json`);
  assert.equal(missing.status, 404);

  const post = await fetch(origin, { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
});

test("rejects forged hosts, traversal, and non-loopback addresses", async () => {
  const activePort = new URL(origin).port;
  assert.equal(await requestStatus({ host: `localhost:${activePort}` }), 403);

  const traversal = await fetch(`${origin}/..%2Fpackage.json`);
  assert.equal(traversal.status, 404);
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.20"), false);
  assert.equal(isLoopbackAddress(undefined), false);
});

test("does not follow static symlinks outside the build root", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "terminal-tutor-static-"));
  const publicRoot = join(temporaryRoot, "public");
  const secret = join(temporaryRoot, "secret.txt");
  let isolatedServer;
  try {
    await mkdir(publicRoot);
    await writeFile(join(publicRoot, "index.html"), "<!doctype html><title>safe</title>");
    await writeFile(secret, "must not be served");
    await symlink(secret, join(publicRoot, "leak.txt"));
    isolatedServer = await startStaticServer({ root: publicRoot, port: 0 });
    const address = isolatedServer.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/leak.txt`);
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /must not be served/);
  } finally {
    if (isolatedServer) {
      await new Promise((resolve, reject) => {
        isolatedServer.close((error) => error ? reject(error) : resolve());
      });
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("emits a self-contained browser bundle", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
    .map((match) => match[1]);

  assert.ok(assetPaths.some((path) => path.endsWith(".js")));
  assert.ok(assetPaths.some((path) => path.endsWith(".css")));
  for (const path of assetPaths) {
    const asset = new URL(`../dist${path}`, import.meta.url);
    await access(asset);
    assert.ok((await stat(asset)).size > 0);
  }
});

test("emits a Node-ready shell service without a TypeScript runtime", async () => {
  const builtServer = new URL("../dist/server/pty-server.mjs", import.meta.url);
  const serverArtifacts = await readdir(new URL("../dist/server/", import.meta.url));
  const source = await readFile(builtServer, "utf8");

  assert.deepEqual(serverArtifacts, ["pty-server.mjs"]);
  assert.ok((await stat(builtServer)).size > 1_000);
  assert.match(source, /from\s+["']node-pty["']/);
  assert.match(source, /from\s+["']ws["']/);
  assert.doesNotMatch(source, /interface\s+ClientMessage|:\s*IncomingMessage/);
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
