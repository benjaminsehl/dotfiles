import { createHmac, randomBytes } from "node:crypto";
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
const expectedHost = `${host}:${port}`;
const defaultIdleTimeoutMs = 20 * 60 * 1000;
const idleTimeoutMs = (() => {
  if (process.env.NODE_ENV !== "test") return defaultIdleTimeoutMs;
  const configured = Number(process.env.WIZARD_TEST_IDLE_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured >= 50
    ? configured
    : defaultIdleTimeoutMs;
})();
const ticketLifetimeMs = 30_000;
const maximumBufferedOutput = 1_048_576;

if (!/^[a-f0-9]{64}$/.test(sessionToken)) {
  throw new Error("WIZARD_SESSION_TOKEN must be a fresh 32-byte hexadecimal value");
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

function isLoopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function sendJson(response: ServerResponse, status: number, body: unknown, expose = false): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Cross-Origin-Resource-Policy": "same-site",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...(expose ? { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(body));
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

const httpServer = createServer((request, response) => {
  if (!isLoopback(request) || request.headers.host !== expectedHost) {
    sendJson(response, 403, { error: "loopback only" });
    return;
  }

  const origin = request.headers.origin;
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, { ready: true }, origin === allowedOrigin);
    return;
  }
  if (
    request.method === "GET" &&
    requestUrl.pathname === "/session" &&
    origin === allowedOrigin &&
    !activeSocket
  ) {
    sendJson(response, 200, { protocol: mintTicket(), expiresInMs: ticketLifetimeMs }, true);
    return;
  }
  sendJson(response, 404, { error: "not found" });
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

let activeSocket: WebSocket | null = null;
let activePty: pty.IPty | null = null;

socketServer.on("connection", (socket) => {
  activeSocket = socket;
  let socketPty: pty.IPty | null = null;
  let idleTimer: NodeJS.Timeout;
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
      try {
        const spawnedPty = pty.spawn("/bin/zsh", ["-l"], {
          name: "xterm-ghostty",
          cols: message.cols,
          rows: message.rows,
          cwd: resolve(homedir()),
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
    const ownedPty = socketPty;
    socketPty = null;
    if (activePty === ownedPty) activePty = null;
    ownedPty?.kill();
    if (activeSocket === socket) activeSocket = null;
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
    !consumeTicket(ticket) ||
    activeSocket
  ) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  socketServer.handleUpgrade(request, socket, head, (webSocket) => {
    socketServer.emit("connection", webSocket, request);
  });
});

httpServer.listen(port, host, () => {
  console.log(`Live Mac service ready on http://${host}:${port} (loopback only)`);
});

function shutdown(): void {
  activePty?.kill();
  activeSocket?.close(1001, "service stopping");
  socketServer.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
