import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const WEB_PORT = 4317;
export const PTY_PORT = 4318;
export const LOCAL_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
export const WEB_HEALTH_URL = `${LOCAL_ORIGIN}/`;
export const PTY_HEALTH_URL = `http://127.0.0.1:${PTY_PORT}/health`;

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(projectRoot, "../..");
const distRoot = join(projectRoot, "dist");
const runLocalScript = fileURLToPath(import.meta.url);
const ptyServerEntry = join(distRoot, "server", "pty-server.mjs");

export const DOCUMENT_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data:",
    "connect-src 'self' ws://127.0.0.1:4317 ws://127.0.0.1:4318 http://127.0.0.1:4318",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".woff2", "font/woff2"],
]);
const inheritedKeys = [
  "HOME",
  "USER",
  "LOGNAME",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "CI",
  "FORCE_COLOR",
  "NO_COLOR",
  "CODEX_SANDBOX",
];

function requireSessionToken(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("session token must be 64 lowercase hexadecimal characters");
  }
  return value;
}

export function buildLocalEnvironments(
  parentEnvironment,
  sessionToken,
  localWorkspaceRoot = workspaceRoot,
) {
  const inheritedEnvironment = Object.fromEntries(
    inheritedKeys.flatMap((key) => parentEnvironment[key] ? [[key, parentEnvironment[key]]] : []),
  );
  const web = {
    ...inheritedEnvironment,
    WIZARD_PTY_PORT: String(PTY_PORT),
  };
  const pty = {
    ...web,
    WIZARD_ALLOWED_ORIGIN: LOCAL_ORIGIN,
    WIZARD_SESSION_TOKEN: requireSessionToken(sessionToken),
    WIZARD_WORKSPACE_ROOT: resolve(localWorkspaceRoot),
  };
  return { web, pty };
}

export function browserOpenArguments(url, fileExists = existsSync) {
  const chromePath = "/Applications/Google Chrome.app";
  return fileExists(chromePath) ? ["-a", "Google Chrome", url] : [url];
}

export function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function sendStaticError(response, status, message, method = "GET") {
  const body = `${message}\n`;
  response.writeHead(status, {
    ...DOCUMENT_HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(method === "HEAD" ? undefined : body);
}

async function resolveStaticFile(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.includes("\0") || decoded.includes("\\")) return null;
  const relativePath = decoded === "/" ? "index.html" : decoded.slice(1);
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
  try {
    const [canonicalRoot, canonicalFile, metadata] = await Promise.all([
      realpath(root),
      realpath(candidate),
      stat(candidate),
    ]);
    if (!metadata.isFile()) return null;
    if (canonicalFile !== canonicalRoot && !canonicalFile.startsWith(`${canonicalRoot}${sep}`)) return null;
    return { path: canonicalFile, size: metadata.size };
  } catch {
    return null;
  }
}

export function createStaticServer(options = {}) {
  const root = resolve(options.root ?? distRoot);
  const server = createServer((request, response) => {
    void (async () => {
      const address = server.address();
      const activePort = address && typeof address === "object" ? address.port : (options.port ?? WEB_PORT);
      const expectedHost = `127.0.0.1:${activePort}`;
      const method = request.method ?? "GET";

      if (!isLoopbackAddress(request.socket.remoteAddress) || request.headers.host !== expectedHost) {
        sendStaticError(response, 403, "Forbidden", method);
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        sendStaticError(response, 405, "Method Not Allowed", method);
        return;
      }
      if (!request.url?.startsWith("/") || request.url.startsWith("//")) {
        sendStaticError(response, 400, "Bad Request", method);
        return;
      }

      let requestUrl;
      try {
        requestUrl = new URL(request.url, `http://${expectedHost}`);
      } catch {
        sendStaticError(response, 400, "Bad Request", method);
        return;
      }
      const file = await resolveStaticFile(root, requestUrl.pathname);
      const contentType = file ? contentTypes.get(extname(file.path).toLowerCase()) : undefined;
      if (!file || !contentType) {
        sendStaticError(response, 404, "Not Found", method);
        return;
      }

      response.writeHead(200, {
        ...DOCUMENT_HEADERS,
        "Content-Type": contentType,
        "Content-Length": file.size,
      });
      if (method === "HEAD") {
        response.end();
        return;
      }
      const stream = createReadStream(file.path);
      stream.once("error", () => response.destroy());
      stream.pipe(response);
    })().catch(() => {
      if (!response.headersSent) sendStaticError(response, 500, "Internal Server Error");
      else response.destroy();
    });
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}

export async function startStaticServer(options = {}) {
  const server = createStaticServer(options);
  const port = options.port ?? WEB_PORT;
  await new Promise((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolveReady();
    });
  });
  return server;
}

async function serveStaticUntilStopped() {
  const server = await startStaticServer();
  process.stdout.write(`Terminal Tutor UI ready at ${LOCAL_ORIGIN} (loopback only)\n`);
  await new Promise((resolveStopped) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.close(resolveStopped);
      setTimeout(() => resolveStopped(), 2_000).unref();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function childOutcome(child, name = "process") {
  return new Promise((resolveOutcome) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      resolveOutcome({ ...outcome, name });
    };
    child.once("error", (error) => finish({ kind: "error", error }));
    child.once("exit", (code, signal) => finish({ kind: "exit", code, signal }));
  });
}

export async function openBrowser(url, options = {}) {
  const spawnProcess = options.spawnProcess ?? spawn;
  const args = browserOpenArguments(url, options.fileExists ?? existsSync);
  const opener = spawnProcess("/usr/bin/open", args, { stdio: "ignore" });
  const outcome = await childOutcome(opener, "browser opener");
  if (outcome.kind === "error") throw outcome.error;
  if (outcome.code !== 0) {
    throw new Error(`Browser opener exited with code ${outcome.code ?? "unknown"}`);
  }
}

export async function waitForLocalServices(options = {}) {
  const fetchHealth = options.fetchHealth ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => pause(milliseconds));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const deadline = now() + timeoutMs;
  let webReady = false;
  let ptyReady = false;

  while (now() < deadline) {
    if (!webReady) {
      try {
        const response = await fetchHealth(WEB_HEALTH_URL, {
          cache: "no-store",
          headers: { Accept: "text/html" },
          signal: AbortSignal.timeout(Math.min(750, Math.max(50, deadline - now()))),
        });
        webReady = response.ok && /^text\/html\b/i.test(response.headers.get("content-type") ?? "");
      } catch {
        // Vite may still be binding its loopback port.
      }
    }
    if (!ptyReady) {
      try {
        const response = await fetchHealth(PTY_HEALTH_URL, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(Math.min(750, Math.max(50, deadline - now()))),
        });
        if (response.ok) {
          const body = await response.json();
          ptyReady = body?.ready === true && body?.mode === "local";
        }
      } catch {
        // The PTY service may still be binding its loopback port.
      }
    }
    if (webReady && ptyReady) return;
    await sleep(pollIntervalMs);
  }

  throw new Error("the local web and shell services did not become ready in time");
}

export function defaultSpawnServices(environment, mode, spawnProcess = spawn) {
  const bin = (name) => join(projectRoot, "node_modules", ".bin", name);
  const webCommand = mode === "dev" ? bin("vite") : process.execPath;
  const webArguments = mode === "dev"
    ? ["dev", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"]
    : [runLocalScript, "serve"];
  const ptyCommand = mode === "dev" ? bin("tsx") : process.execPath;
  const ptyArguments = mode === "dev" ? ["watch", "server/pty-server.ts"] : [ptyServerEntry];
  return {
    web: spawnProcess(webCommand, webArguments, {
      cwd: projectRoot,
      env: environment.web,
      stdio: ["ignore", "inherit", "inherit"],
    }),
    pty: spawnProcess(ptyCommand, ptyArguments, {
      cwd: projectRoot,
      env: environment.pty,
      stdio: ["ignore", "inherit", "inherit"],
    }),
  };
}

export async function runLocal(options = {}) {
  const mode = options.mode === "dev" ? "dev" : "start";
  const sessionToken = (options.random ?? randomBytes)(32).toString("hex");
  const environment = buildLocalEnvironments(
    options.parentEnvironment ?? process.env,
    sessionToken,
    options.workspaceRoot ?? workspaceRoot,
  );
  const spawnServices = options.spawnServices ?? defaultSpawnServices;
  const openLocalBrowser = options.openLocalBrowser ?? ((url) => openBrowser(url));
  const output = options.output ?? ((message) => process.stdout.write(message));
  const signalTarget = options.signalTarget ?? process;
  const services = spawnServices(environment, mode);
  const outcomes = [
    childOutcome(services.web, "web server"),
    childOutcome(services.pty, "shell service"),
  ];
  let stopping = false;
  let stopSignal = null;
  let forceTimer;

  const stop = (signal = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    stopSignal = signal;
    services.web.kill(signal);
    services.pty.kill(signal);
    forceTimer = setTimeout(() => {
      services.web.kill("SIGKILL");
      services.pty.kill("SIGKILL");
    }, 2_000);
    forceTimer.unref?.();
  };
  const stopForInterrupt = () => stop("SIGINT");
  const stopForTermination = () => stop("SIGTERM");
  signalTarget.on("SIGINT", stopForInterrupt);
  signalTarget.on("SIGTERM", stopForTermination);

  try {
    const initial = await Promise.race([
      waitForLocalServices(options.healthOptions).then(() => ({ kind: "ready" })),
      ...outcomes,
    ]);
    if (initial.kind === "error") throw initial.error;
    if (initial.kind === "exit") {
      throw new Error(`${initial.name} exited before Terminal Tutor was ready (${initial.code ?? initial.signal ?? "unknown"})`);
    }

    if (!options.noOpen) await openLocalBrowser(LOCAL_ORIGIN);
    output(`Terminal Tutor is ready at ${LOCAL_ORIGIN}. Keep this terminal window open while you use it.\n`);

    const firstExit = await Promise.race(outcomes);
    if (firstExit.kind === "error") throw firstExit.error;
    if (!stopping) stop("SIGTERM");
    await Promise.all(outcomes);
    if (stopSignal === "SIGINT") return 130;
    if (stopSignal === "SIGTERM" && firstExit.signal === "SIGTERM") return 143;
    return firstExit.code ?? (firstExit.signal ? 1 : 0);
  } catch (error) {
    stop("SIGTERM");
    await Promise.race([Promise.all(outcomes), pause(2_100)]);
    throw error;
  } finally {
    if (forceTimer) clearTimeout(forceTimer);
    signalTarget.off("SIGINT", stopForInterrupt);
    signalTarget.off("SIGTERM", stopForTermination);
  }
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  try {
    if (process.argv[2] === "serve") {
      await serveStaticUntilStopped();
    } else {
      const mode = process.argv[2] === "dev" ? "dev" : "start";
      process.exitCode = await runLocal({
        mode,
        noOpen: process.env.TERMINAL_TUTOR_NO_OPEN === "1",
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unable to start the local app";
    process.stderr.write(`Terminal Tutor could not start: ${message}\n`);
    process.exitCode = 1;
  }
}
