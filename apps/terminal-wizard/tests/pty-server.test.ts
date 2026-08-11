import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import WebSocket from "ws";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const tsxCli = fileURLToPath(
  new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url),
);
const ptyServer = fileURLToPath(
  new URL("../server/pty-server.ts", import.meta.url),
);

let child: ChildProcess;
let bridgePort = 0;
let browserOrigin = "";
let bridgeHttp = "";
let bridgeWebSocket = "";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForReady(process: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(
      () => reject(new Error(`PTY service did not become ready: ${stderr}`)),
      5_000,
    );
    const cleanup = () => {
      clearTimeout(timeout);
      process.stdout?.off("data", onStdout);
      process.stderr?.off("data", onStderr);
      process.off("exit", onExit);
    };
    const onStdout = (chunk: Buffer) => {
      if (!chunk.toString("utf8").includes("Live Mac service ready")) return;
      cleanup();
      resolve();
    };
    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`PTY service exited before readiness with code ${code}: ${stderr}`));
    };
    process.stdout?.on("data", onStdout);
    process.stderr?.on("data", onStderr);
    process.once("exit", onExit);
  });
}

async function stopChild(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => process.once("exit", () => resolve()));
  process.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise<void>((resolve) =>
      setTimeout(() => {
        process.kill("SIGKILL");
        resolve();
      }, 3_000),
    ),
  ]);
}

async function startIsolatedBridge(
  idleTimeoutMs: number,
): Promise<{
  child: ChildProcess;
  httpUrl: string;
  origin: string;
  webSocketUrl: string;
}> {
  const isolatedPort = await availablePort();
  const isolatedOriginPort = await availablePort();
  const origin = `http://127.0.0.1:${isolatedOriginPort}`;
  const isolatedChild = spawn(process.execPath, [tsxCli, ptyServer], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      WIZARD_SESSION_TOKEN: randomBytes(32).toString("hex"),
      WIZARD_ALLOWED_ORIGIN: origin,
      WIZARD_PTY_PORT: String(isolatedPort),
      WIZARD_TEST_IDLE_TIMEOUT_MS: String(idleTimeoutMs),
      WIZARD_WORKSPACE_ROOT: projectRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForReady(isolatedChild);
  return {
    child: isolatedChild,
    httpUrl: `http://127.0.0.1:${isolatedPort}`,
    origin,
    webSocketUrl: `ws://127.0.0.1:${isolatedPort}/terminal`,
  };
}

async function session(origin = browserOrigin): Promise<Response> {
  return fetch(`${bridgeHttp}/session`, {
    headers: { Origin: origin },
    cache: "no-store",
  });
}

async function mintTicket(): Promise<string> {
  const response = await session();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), browserOrigin);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  const body = (await response.json()) as {
    protocol?: unknown;
    expiresInMs?: unknown;
  };
  assert.equal(body.expiresInMs, 30_000);
  assert.equal(typeof body.protocol, "string");
  assert.match(
    body.protocol as string,
    /^terminal-wizard\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/,
  );
  return body.protocol as string;
}

type SocketAttempt =
  | { kind: "open"; socket: WebSocket }
  | { kind: "http"; status: number | undefined };

async function attemptSocket(
  protocols: string | string[],
  origin = browserOrigin,
  headers?: Record<string, string>,
): Promise<SocketAttempt> {
  return new Promise<SocketAttempt>((resolve, reject) => {
    const socket = new WebSocket(bridgeWebSocket, protocols, {
      origin,
      headers,
      handshakeTimeout: 2_000,
    });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket attempt timed out"));
    }, 3_000);
    let settled = false;
    const finish = (result: SocketAttempt) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    socket.once("open", () => finish({ kind: "open", socket }));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      finish({ kind: "http", status: response.statusCode });
    });
    socket.once("error", (error) => {
      if (!settled) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  socket.close(1000, "test complete");
  await Promise.race([
    closed,
    new Promise<void>((resolve) =>
      setTimeout(() => {
        socket.terminate();
        resolve();
      }, 2_000),
    ),
  ]);
}

async function statusWithHost(host: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port: bridgePort,
        path: "/session",
        method: "GET",
        headers: { Host: host, Origin: browserOrigin },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.once("error", reject);
    request.end();
  });
}

before(async () => {
  bridgePort = await availablePort();
  const originPort = await availablePort();
  browserOrigin = `http://127.0.0.1:${originPort}`;
  bridgeHttp = `http://127.0.0.1:${bridgePort}`;
  bridgeWebSocket = `ws://127.0.0.1:${bridgePort}/terminal`;
  child = spawn(process.execPath, [tsxCli, ptyServer], {
    cwd: projectRoot,
    env: {
      ...process.env,
      TW_TEST_PARENT_SECRET: "must-not-reach-live-shell",
      WIZARD_SESSION_TOKEN: randomBytes(32).toString("hex"),
      WIZARD_ALLOWED_ORIGIN: browserOrigin,
      WIZARD_PTY_PORT: String(bridgePort),
      WIZARD_WORKSPACE_ROOT: projectRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForReady(child);
});

after(async () => {
  await stopChild(child);
});

test("prepares node-pty's macOS helper as a regular executable", async (context) => {
  if (process.platform !== "darwin") {
    context.skip("macOS-only node-pty prebuild check");
    return;
  }
  const helper = fileURLToPath(
    new URL(
      `../node_modules/node-pty/prebuilds/darwin-${process.arch}/spawn-helper`,
      import.meta.url,
    ),
  );
  const metadata = await lstat(helper);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.isSymbolicLink(), false);
  await access(helper, fsConstants.X_OK);
});

test("enforces the loopback Origin, Host, ticket, and session boundary", async () => {
  assert.equal((await session("https://evil.example")).status, 404);
  assert.equal((await fetch(`${bridgeHttp}/session`)).status, 404);
  assert.equal(await statusWithHost("evil.example"), 403);

  const ticket = await mintTicket();

  const badHost = await attemptSocket(ticket, browserOrigin, {
    Host: "evil.example",
  });
  assert.deepEqual(badHost, { kind: "http", status: 403 });

  const crossSite = await attemptSocket(ticket, "https://evil.example");
  assert.deepEqual(crossSite, { kind: "http", status: 403 });

  const tooManyProtocols = await attemptSocket([
    ticket,
    "terminal-wizard.unexpected",
  ]);
  assert.deepEqual(tooManyProtocols, { kind: "http", status: 403 });

  const accepted = await attemptSocket(ticket);
  assert.equal(accepted.kind, "open");
  if (accepted.kind !== "open") return;

  const pong = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("pong timed out")), 1_000);
    accepted.socket.once("message", (raw) => {
      clearTimeout(timeout);
      const message = JSON.parse(raw.toString()) as { type?: unknown };
      assert.equal(message.type, "pong");
      resolve();
    });
  });
  accepted.socket.send(JSON.stringify({ type: "ping" }));
  await pong;
  await closeSocket(accepted.socket);

  const replay = await attemptSocket(ticket);
  assert.deepEqual(replay, { kind: "http", status: 403 });

  const firstTicket = await mintTicket();
  const secondTicket = await mintTicket();
  const first = await attemptSocket(firstTicket);
  assert.equal(first.kind, "open");
  if (first.kind !== "open") return;

  const concurrent = await attemptSocket(secondTicket);
  assert.deepEqual(concurrent, { kind: "http", status: 403 });
  await closeSocket(first.socket);

  const consumedWhileBusy = await attemptSocket(secondTicket);
  assert.deepEqual(consumedWhileBusy, { kind: "http", status: 403 });

  const invalidMessageTicket = await mintTicket();
  const invalidMessage = await attemptSocket(invalidMessageTicket);
  assert.equal(invalidMessage.kind, "open");
  if (invalidMessage.kind !== "open") return;
  const closeCode = new Promise<number>((resolve) =>
    invalidMessage.socket.once("close", (code) => resolve(code)),
  );
  invalidMessage.socket.send(JSON.stringify({ type: "unknown" }));
  assert.equal(await closeCode, 1008);
});

async function waitForMessageType(
  socket: WebSocket,
  expectedType: string,
  timeoutMs = 5_000,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${expectedType}`)),
      timeoutMs,
    );
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
    };
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as {
        type?: unknown;
        message?: unknown;
      };
      if (message.type === "error") {
        cleanup();
        reject(new Error(String(message.message ?? "PTY service error")));
        return;
      }
      if (message.type !== expectedType) return;
      cleanup();
      resolve();
    };
    const onClose = (code: number) => {
      cleanup();
      reject(new Error(`Socket closed with ${code} before ${expectedType}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.on("message", onMessage);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

async function waitForOutput(
  socket: WebSocket,
  expectedText: string,
  timeoutMs = 5_000,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for terminal output: ${expectedText}`)),
      timeoutMs,
    );
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
    };
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as {
        type?: unknown;
        data?: unknown;
        message?: unknown;
      };
      if (message.type === "error") {
        cleanup();
        reject(new Error(String(message.message ?? "PTY service error")));
        return;
      }
      if (message.type !== "output" || typeof message.data !== "string") return;
      output += message.data;
      if (!output.includes(expectedText)) return;
      cleanup();
      resolve();
    };
    const onClose = (code: number) => {
      cleanup();
      reject(new Error(`Socket closed with ${code} before expected terminal output`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.on("message", onMessage);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

async function startLiveShell(socket: WebSocket): Promise<void> {
  const ready = waitForMessageType(socket, "ready");
  socket.send(JSON.stringify({ type: "start", cols: 80, rows: 24 }));
  await ready;
}

test("sanitizes the shell environment and survives a rapid reconnect", async () => {
  const firstAttempt = await attemptSocket(await mintTicket());
  assert.equal(firstAttempt.kind, "open");
  if (firstAttempt.kind !== "open") return;
  await startLiveShell(firstAttempt.socket);
  await closeSocket(firstAttempt.socket);

  const secondAttempt = await attemptSocket(await mintTicket());
  assert.equal(secondAttempt.kind, "open");
  if (secondAttempt.kind !== "open") return;
  await startLiveShell(secondAttempt.socket);

  // Give the first PTY's asynchronous exit callback a chance to run. It must
  // not clear or close the newly active PTY/socket.
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  assert.equal(secondAttempt.socket.readyState, WebSocket.OPEN);

  const marker = `__TW_ENV__unset:live::__TW_CWD__${resolve(projectRoot)}`;
  const output = waitForOutput(secondAttempt.socket, marker);
  secondAttempt.socket.send(
    JSON.stringify({
      type: "input",
      data: 'printf \'__TW_ENV__%s:%s::__TW_CWD__%s\\n\' "${TW_TEST_PARENT_SECRET-unset}" "$TERMINAL_WIZARD" "$PWD"\r',
    }),
  );
  await output;
  await closeSocket(secondAttempt.socket);
});

test("resize and ping traffic cannot keep an idle live session alive", async () => {
  const idleTimeoutMs = 350;
  const isolated = await startIsolatedBridge(idleTimeoutMs);

  try {
    const ticketResponse = await fetch(`${isolated.httpUrl}/session`, {
      headers: { Origin: isolated.origin },
      cache: "no-store",
    });
    assert.equal(ticketResponse.status, 200);
    const ticketBody = (await ticketResponse.json()) as { protocol?: unknown };
    assert.equal(typeof ticketBody.protocol, "string");

    const socketAttempt = await new Promise<SocketAttempt>((resolve, reject) => {
      const socket = new WebSocket(
        isolated.webSocketUrl,
        ticketBody.protocol as string,
        { origin: isolated.origin, handshakeTimeout: 2_000 },
      );
      socket.once("open", () => resolve({ kind: "open", socket }));
      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve({ kind: "http", status: response.statusCode });
      });
      socket.once("error", reject);
    });
    assert.equal(socketAttempt.kind, "open");
    if (socketAttempt.kind !== "open") return;

    const socket = socketAttempt.socket;
    await startLiveShell(socket);

    let pongCount = 0;
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { type?: unknown };
      if (message.type === "pong") pongCount += 1;
    });

    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.once("close", (code, reason) => {
        resolve({ code, reason: reason.toString("utf8") });
      });
    });
    const controlTraffic = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "resize", cols: 81, rows: 25 }));
      socket.send(JSON.stringify({ type: "ping" }));
    }, 40);

    const result = await Promise.race([
      closed,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("resize and ping traffic kept the idle session alive")),
          idleTimeoutMs * 4,
        ),
      ),
    ]).finally(() => clearInterval(controlTraffic));

    assert.equal(result.code, 1000);
    assert.equal(result.reason, "idle timeout");
    assert.ok(pongCount > 0, "expected the server to process heartbeat traffic before timing out");
  } finally {
    await stopChild(isolated.child);
  }
});
