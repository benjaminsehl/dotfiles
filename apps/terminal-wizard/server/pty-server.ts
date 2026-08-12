import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir, userInfo } from "node:os";
import { resolve } from "node:path";
import { URL } from "node:url";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

const host = "127.0.0.1";
const port = Number(process.env.WIZARD_PTY_PORT ?? 4318);
const allowedOrigin = process.env.WIZARD_ALLOWED_ORIGIN ?? "http://127.0.0.1:4317";
const sessionToken = process.env.WIZARD_SESSION_TOKEN ?? "";
const pairingSecret = process.env.WIZARD_PAIRING_SECRET ?? "";
const instanceId = process.env.WIZARD_INSTANCE_ID ?? "";
const expectedHost = `${host}:${port}`;
const hostedOrigin = "https://terminal-tutor-three.vercel.app";
const maximumPairingBodyBytes = 1_024;
const defaultIdleTimeoutMs = 20 * 60 * 1000;
const defaultPairingLifetimeMs = 5 * 60 * 1000;
const defaultStartDeadlineMs = 10_000;
const defaultAbsoluteSessionMs = 2 * 60 * 60 * 1000;
function testDuration(name: string, fallback: number): number {
  if (process.env.NODE_ENV !== "test") return fallback;
  const configured = Number(process.env[name]);
  return Number.isSafeInteger(configured) && configured >= 50 ? configured : fallback;
}
const idleTimeoutMs = (() => {
  return testDuration("WIZARD_TEST_IDLE_TIMEOUT_MS", defaultIdleTimeoutMs);
})();
const pairingLifetimeMs = testDuration(
  "WIZARD_TEST_PAIRING_TIMEOUT_MS",
  defaultPairingLifetimeMs,
);
const startDeadlineMs = testDuration(
  "WIZARD_TEST_START_DEADLINE_MS",
  defaultStartDeadlineMs,
);
const absoluteSessionMs = testDuration(
  "WIZARD_TEST_ABSOLUTE_SESSION_MS",
  defaultAbsoluteSessionMs,
);
const ticketLifetimeMs = 30_000;
const maximumBufferedOutput = 1_048_576;
const allowedOriginUrl = (() => {
  try {
    const parsed = new URL(allowedOrigin);
    if (
      parsed.origin !== allowedOrigin ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("not an exact origin");
    }
    return parsed;
  } catch {
    throw new Error("WIZARD_ALLOWED_ORIGIN must be an exact origin without a path");
  }
})();
const isLocalMode =
  allowedOriginUrl.protocol === "http:" && allowedOriginUrl.hostname === "127.0.0.1";
const isHostedMode = allowedOrigin === hostedOrigin;
const shellWorkingDirectory = (() => {
  const configured = process.env.WIZARD_WORKSPACE_ROOT;
  if (!configured) {
    if (isHostedMode) {
      throw new Error("WIZARD_WORKSPACE_ROOT must name an existing directory in hosted mode");
    }
    return resolve(homedir());
  }
  const candidate = resolve(configured);
  if (isHostedMode) {
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Fall through to the fail-closed hosted-mode error below.
    }
    throw new Error("WIZARD_WORKSPACE_ROOT must name an existing directory in hosted mode");
  }
  try {
    return existsSync(candidate) && statSync(candidate).isDirectory()
      ? candidate
      : resolve(homedir());
  } catch {
    return resolve(homedir());
  }
})();

if (!/^[a-f0-9]{64}$/.test(sessionToken)) {
  throw new Error("WIZARD_SESSION_TOKEN must be a fresh 32-byte hexadecimal value");
}
if (!isLocalMode && !isHostedMode) {
  throw new Error(`WIZARD_ALLOWED_ORIGIN must be a 127.0.0.1 origin or ${hostedOrigin}`);
}
if (isHostedMode && !/^[A-Za-z0-9_-]{43}$/.test(pairingSecret)) {
  throw new Error("WIZARD_PAIRING_SECRET must be a fresh 32-byte base64url value in hosted mode");
}
if (isHostedMode && !/^[A-Za-z0-9_-]{22}$/.test(instanceId)) {
  throw new Error("WIZARD_INSTANCE_ID must be a fresh 16-byte base64url value in hosted mode");
}

type ClientMessage =
  | { type: "start"; cols: number; rows: number }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "ping" };

type ServerMessage =
  | { type: "ready" }
  | { type: "output"; data: string }
  | { type: "exit"; code: number; signal?: number }
  | { type: "error"; message: string }
  | { type: "pong" };

const tickets = new Map<string, number>();
type HostedPairingState = "awaiting-pair" | "ticket-issued" | "active" | "spent";
let hostedPairingState: HostedPairingState = "awaiting-pair";
const pairingExpiresAt = Date.now() + pairingLifetimeMs;
let pairingExpiryTimer: NodeJS.Timeout | null = null;
let ticketExpiryTimer: NodeJS.Timeout | null = null;
let socketReserved = false;

function pruneTickets(now = Date.now()): void {
  for (const [ticket, expiresAt] of tickets) {
    if (expiresAt <= now) tickets.delete(ticket);
  }
}

function mintTicket(): string {
  pruneTickets();
  const nonce = randomBytes(32).toString("base64url");
  const signature = createHmac("sha256", sessionToken).update(nonce).digest("base64url");
  const ticket = `terminal-wizard.${nonce}.${signature}`;
  tickets.set(ticket, Date.now() + ticketLifetimeMs);
  return ticket;
}

function consumeTicket(ticket: string | undefined): boolean {
  if (!ticket) return false;
  const expiresAt = tickets.get(ticket);
  tickets.delete(ticket);
  return typeof expiresAt === "number" && expiresAt > Date.now();
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isLoopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function sendJson(response: ServerResponse, status: number, body: unknown, expose = false): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Cross-Origin-Resource-Policy": expose ? "cross-origin" : "same-site",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...(expose ? { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(
  response: ServerResponse,
  status: number,
  expose = false,
  allowPrivateNetwork = false,
): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Cross-Origin-Resource-Policy": expose ? "cross-origin" : "same-site",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...(expose
      ? {
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Max-Age": "0",
          ...(allowPrivateNetwork ? { "Access-Control-Allow-Private-Network": "true" } : {}),
          Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
        }
      : {}),
  });
  response.end();
}

type PairingRequest = {
  version: 1;
  instanceId: string;
  pairingSecret: string;
};

function parsePairingRequest(value: unknown): PairingRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    record.version !== 1 ||
    typeof record.instanceId !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/.test(record.instanceId) ||
    typeof record.pairingSecret !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(record.pairingSecret)
  ) {
    return null;
  }
  return {
    version: 1,
    instanceId: record.instanceId,
    pairingSecret: record.pairingSecret,
  };
}

async function readPairingRequest(request: IncomingMessage): Promise<PairingRequest | null> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    request.resume();
    return null;
  }
  const declaredLength = Number(request.headers["content-length"]);
  if (
    request.headers["content-length"] !== undefined &&
    (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > maximumPairingBodyBytes)
  ) {
    request.resume();
    return null;
  }

  const chunks: Buffer[] = [];
  let byteLength = 0;
  const body = await new Promise<string | null>((resolveBody) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolveBody(value);
    };
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      byteLength += chunk.length;
      if (byteLength > maximumPairingBodyBytes) {
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => finish(Buffer.concat(chunks).toString("utf8")));
    request.once("aborted", () => finish(null));
    request.once("error", () => finish(null));
  });
  if (body === null) return null;
  try {
    return parsePairingRequest(JSON.parse(body));
  } catch {
    return null;
  }
}

function cleanShellEnvironment(): Record<string, string> {
  const allowed = [
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
  ];
  const username = userInfo().username;
  const environment: Record<string, string> = {
    HOME: homedir(),
    USER: username,
    LOGNAME: username,
    SHELL: "/bin/zsh",
    PATH: "/usr/local/bin:/usr/local/sbin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
    TERM: "xterm-ghostty",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "ghostty",
    TERMINAL_WIZARD: "live",
  };
  for (const key of allowed) {
    const value = process.env[key];
    if (value) environment[key] = value;
  }
  return environment;
}

function validDimension(value: unknown, fallback: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= maximum
    ? value
    : fallback;
}

function parseMessage(raw: WebSocket.RawData): ClientMessage | null {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  if (text.length > 65_536) return null;
  try {
    const value = JSON.parse(text) as Partial<ClientMessage>;
    if (value.type === "start") {
      return {
        type: "start",
        cols: validDimension(value.cols, 80, 400),
        rows: validDimension(value.rows, 24, 200),
      };
    }
    if (value.type === "resize") {
      return {
        type: "resize",
        cols: validDimension(value.cols, 80, 400),
        rows: validDimension(value.rows, 24, 200),
      };
    }
    if (value.type === "input" && typeof value.data === "string" && value.data.length <= 65_536) {
      return { type: "input", data: value.data };
    }
    if (value.type === "ping") return { type: "ping" };
  } catch {
    return null;
  }
  return null;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sendOutput(socket: WebSocket, data: string): void {
  for (let offset = 0; offset < data.length; offset += 65_536) {
    if (socket.bufferedAmount > maximumBufferedOutput) {
      send(socket, { type: "error", message: "Live Mac closed because terminal output was too fast." });
      socket.close(1013, "output backpressure");
      return;
    }
    send(socket, { type: "output", data: data.slice(offset, offset + 65_536) });
  }
}

let activeSocket: WebSocket | null = null;
let activePty: pty.IPty | null = null;

function validPairingPreflight(request: IncomingMessage): boolean {
  const requestedMethod = request.headers["access-control-request-method"];
  const requestedHeaders = (request.headers["access-control-request-headers"] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const privateNetwork = request.headers["access-control-request-private-network"];
  return (privateNetwork === undefined || privateNetwork === "true") &&
    requestedMethod === "POST" &&
    requestedHeaders.length === 1 &&
    requestedHeaders[0] === "content-type";
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!isLoopback(request) || request.headers.host !== expectedHost) {
    sendJson(response, 403, { error: "loopback only" });
    return;
  }

  const origin = request.headers.origin;
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  const exactPath = requestUrl.search === "" && requestUrl.hash === "";
  if (request.method === "GET" && exactPath && requestUrl.pathname === "/health") {
    sendJson(
      response,
      200,
      isHostedMode
        ? { ready: true, mode: "hosted", instanceId }
        : { ready: true, mode: "local" },
      origin === allowedOrigin,
    );
    return;
  }

  if (
    isHostedMode &&
    request.method === "OPTIONS" &&
    exactPath &&
    requestUrl.pathname === "/session" &&
    origin === allowedOrigin &&
    validPairingPreflight(request)
  ) {
    sendEmpty(
      response,
      204,
      true,
      request.headers["access-control-request-private-network"] === "true",
    );
    return;
  }

  if (
    isLocalMode &&
    request.method === "GET" &&
    exactPath &&
    requestUrl.pathname === "/session" &&
    origin === allowedOrigin &&
    !activeSocket &&
    !socketReserved
  ) {
    sendJson(response, 200, { protocol: mintTicket(), expiresInMs: ticketLifetimeMs }, true);
    return;
  }

  if (
    isHostedMode &&
    request.method === "POST" &&
    exactPath &&
    requestUrl.pathname === "/session" &&
    origin === allowedOrigin
  ) {
    if (hostedPairingState !== "awaiting-pair" || activeSocket || socketReserved) {
      sendJson(response, 409, { error: "pairing unavailable" }, true);
      return;
    }
    if (Date.now() >= pairingExpiresAt) {
      sendJson(response, 410, { error: "pairing expired" }, true);
      return;
    }
    const pairing = await readPairingRequest(request);
    if (!pairing) {
      sendJson(response, 400, { error: "invalid pairing request" }, true);
      return;
    }
    // Re-check after the asynchronous body read so two concurrent requests
    // cannot both exchange the same one-shot pairing capability.
    if (hostedPairingState !== "awaiting-pair") {
      sendJson(response, 409, { error: "pairing unavailable" }, true);
      return;
    }
    if (Date.now() >= pairingExpiresAt) {
      sendJson(response, 410, { error: "pairing expired" }, true);
      return;
    }
    if (
      !safeEqual(pairing.instanceId, instanceId) ||
      !safeEqual(pairing.pairingSecret, pairingSecret)
    ) {
      sendJson(response, 401, { error: "pairing rejected" }, true);
      return;
    }

    hostedPairingState = "ticket-issued";
    if (pairingExpiryTimer) clearTimeout(pairingExpiryTimer);
    pairingExpiryTimer = null;
    const protocol = mintTicket();
    ticketExpiryTimer = setTimeout(() => {
      if (hostedPairingState === "ticket-issued") shutdown();
    }, ticketLifetimeMs);
    sendJson(response, 200, { protocol, expiresInMs: ticketLifetimeMs }, true);
    return;
  }
  sendJson(response, 404, { error: "not found" });
}

const httpServer = createServer((request, response) => {
  void handleHttpRequest(request, response).catch(() => {
    if (!response.headersSent) sendJson(response, 500, { error: "request failed" });
    else response.destroy();
  });
});
httpServer.headersTimeout = 5_000;
httpServer.requestTimeout = 10_000;
httpServer.keepAliveTimeout = 5_000;
httpServer.maxRequestsPerSocket = 20;

const socketServer = new WebSocketServer({
  noServer: true,
  maxPayload: 65_536,
  perMessageDeflate: false,
  clientTracking: true,
});

socketServer.on("connection", (socket) => {
  socketReserved = false;
  activeSocket = socket;
  let socketPty: pty.IPty | null = null;
  let idleTimer: NodeJS.Timeout;
  const startTimer = setTimeout(() => {
    if (socketPty) return;
    send(socket, { type: "error", message: "Live Mac was not started in time." });
    socket.close(1008, "start timeout");
  }, startDeadlineMs);
  const absoluteTimer = setTimeout(() => {
    send(socket, { type: "error", message: "Live Mac reached its maximum session time." });
    socket.close(1000, "session limit");
  }, absoluteSessionMs);
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      send(socket, { type: "error", message: "Live Mac closed after 20 minutes of inactivity." });
      socket.close(1000, "idle timeout");
    }, idleTimeoutMs);
  };
  resetIdleTimer();

  socket.on("message", (raw) => {
    const message = parseMessage(raw);
    if (!message) {
      socket.close(1008, "invalid message");
      return;
    }

    if (message.type === "ping") {
      send(socket, { type: "pong" });
      return;
    }

    if (message.type === "start") {
      if (socketPty) return;
      clearTimeout(startTimer);
      try {
        const spawnedPty = pty.spawn("/bin/zsh", ["-l"], {
          name: "xterm-ghostty",
          cols: message.cols,
          rows: message.rows,
          cwd: shellWorkingDirectory,
          env: cleanShellEnvironment(),
        });
        socketPty = spawnedPty;
        activePty = spawnedPty;
        spawnedPty.onData((data) => sendOutput(socket, data));
        spawnedPty.onExit(({ exitCode, signal }) => {
          send(socket, { type: "exit", code: exitCode, signal });
          if (socketPty === spawnedPty) socketPty = null;
          if (activePty === spawnedPty) activePty = null;
          if (activeSocket === socket) socket.close(1000, "shell exited");
        });
        send(socket, { type: "ready" });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unable to start the login shell";
        send(socket, { type: "error", message: messageText });
        socket.close(1011, "spawn failed");
      }
      return;
    }

    if (!socketPty) {
      socket.close(1008, "shell not started");
      return;
    }
    if (message.type === "input") {
      if (message.data.length > 0) resetIdleTimer();
      socketPty.write(message.data);
    }
    if (message.type === "resize") socketPty.resize(message.cols, message.rows);
  });

  socket.on("close", () => {
    clearTimeout(idleTimer);
    clearTimeout(startTimer);
    clearTimeout(absoluteTimer);
    const ownedPty = socketPty;
    socketPty = null;
    if (activePty === ownedPty) activePty = null;
    ownedPty?.kill();
    if (activeSocket === socket) activeSocket = null;
    if (isHostedMode) {
      hostedPairingState = "spent";
      setImmediate(shutdown);
    }
  });
});

httpServer.on("upgrade", (request, socket, head) => {
  const origin = request.headers.origin;
  const protocols = (request.headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  const ticket = protocols.length === 1 ? protocols[0] : undefined;

  if (
    !isLoopback(request) ||
    request.headers.host !== expectedHost ||
    origin !== allowedOrigin ||
    requestUrl.pathname !== "/terminal" ||
    requestUrl.search !== "" ||
    (isHostedMode && hostedPairingState !== "ticket-issued")
  ) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const acceptedTicket = consumeTicket(ticket);
  if (!acceptedTicket || activeSocket || socketReserved) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  socketReserved = true;
  if (isHostedMode) {
    hostedPairingState = "active";
    if (ticketExpiryTimer) clearTimeout(ticketExpiryTimer);
    ticketExpiryTimer = null;
  }
  try {
    socketServer.handleUpgrade(request, socket, head, (webSocket) => {
      socketServer.emit("connection", webSocket, request);
    });
  } catch {
    socketReserved = false;
    if (isHostedMode) {
      hostedPairingState = "spent";
      setImmediate(shutdown);
    }
    socket.destroy();
  }
});

httpServer.listen(port, host, () => {
  console.log(`Live Mac service ready on http://${host}:${port} (loopback only)`);
  if (isHostedMode) {
    const remainingMs = Math.max(1, pairingExpiresAt - Date.now());
    pairingExpiryTimer = setTimeout(() => {
      if (hostedPairingState === "awaiting-pair") shutdown();
    }, remainingMs);
  }
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (pairingExpiryTimer) clearTimeout(pairingExpiryTimer);
  if (ticketExpiryTimer) clearTimeout(ticketExpiryTimer);
  activePty?.kill();
  activeSocket?.close(1001, "service stopping");
  socketServer.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
