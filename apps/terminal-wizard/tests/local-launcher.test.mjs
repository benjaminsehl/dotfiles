import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  LOCAL_ORIGIN,
  PTY_HEALTH_URL,
  WEB_HEALTH_URL,
  browserOpenArguments,
  buildLocalEnvironments,
  defaultSpawnServices,
  runLocal,
  waitForLocalServices,
} from "../scripts/run-local.mjs";

class FakeChild extends EventEmitter {
  killedWith = [];

  kill(signal) {
    this.killedWith.push(signal);
    queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  }
}

function fixedRandom(length) {
  return Buffer.alloc(length, length);
}

function healthyResponse(url) {
  if (url === WEB_HEALTH_URL) {
    return new Response("<!doctype html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (url === PTY_HEALTH_URL) {
    return new Response(JSON.stringify({ ready: true, mode: "local" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error(`unexpected health URL: ${url}`);
}

test("builds least-privilege web and PTY environments", () => {
  const token = fixedRandom(32).toString("hex");
  const environment = buildLocalEnvironments({
    HOME: "/tmp/test-home",
    PATH: "/usr/bin:/bin",
    AWS_SECRET_ACCESS_KEY: "must-not-pass",
    OPENAI_API_KEY: "must-not-pass",
    WIZARD_SESSION_TOKEN: "must-be-replaced",
  }, token, "/tmp/dotfiles-checkout");

  assert.equal(environment.web.HOME, "/tmp/test-home");
  assert.equal(environment.web.PATH, "/usr/bin:/bin");
  assert.equal(environment.web.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(environment.web.OPENAI_API_KEY, undefined);
  assert.equal(environment.web.WIZARD_SESSION_TOKEN, undefined);
  assert.equal(environment.pty.WIZARD_ALLOWED_ORIGIN, LOCAL_ORIGIN);
  assert.equal(environment.pty.WIZARD_SESSION_TOKEN, token);
  assert.equal(environment.pty.WIZARD_WORKSPACE_ROOT, "/tmp/dotfiles-checkout");
  assert.throws(
    () => buildLocalEnvironments({}, "short", "/tmp/dotfiles-checkout"),
    /session token/,
  );
});

test("prefers installed Chrome and otherwise uses the default browser", () => {
  assert.deepEqual(browserOpenArguments(LOCAL_ORIGIN, () => true), [
    "-a",
    "Google Chrome",
    LOCAL_ORIGIN,
  ]);
  assert.deepEqual(browserOpenArguments(LOCAL_ORIGIN, () => false), [LOCAL_ORIGIN]);
});

test("uses only Node and built artifacts in production, with Vite and tsx reserved for development", () => {
  const environment = buildLocalEnvironments(
    { HOME: "/tmp/test-home", PATH: "/usr/bin:/bin" },
    fixedRandom(32).toString("hex"),
    "/tmp/dotfiles-checkout",
  );
  const production = [];
  defaultSpawnServices(environment, "start", (command, args, options) => {
    production.push({ command, args, options });
    return new FakeChild();
  });

  assert.equal(production.length, 2);
  assert.ok(production.every(({ command }) => command === process.execPath));
  assert.match(production[0].args[0], /scripts\/run-local\.mjs$/);
  assert.deepEqual(production[0].args.slice(1), ["serve"]);
  assert.match(production[1].args[0], /dist\/server\/pty-server\.mjs$/);
  assert.equal(production[0].options.env.WIZARD_SESSION_TOKEN, undefined);
  assert.match(production[1].options.env.WIZARD_SESSION_TOKEN, /^[a-f0-9]{64}$/);

  const development = [];
  defaultSpawnServices(environment, "dev", (command, args) => {
    development.push({ command, args });
    return new FakeChild();
  });
  assert.match(development[0].command, /node_modules\/\.bin\/vite$/);
  assert.match(development[1].command, /node_modules\/\.bin\/tsx$/);
});

test("waits for both the local web app and shell service", async () => {
  const calls = [];
  let webAttempts = 0;

  await waitForLocalServices({
    async fetchHealth(url, init) {
      calls.push({ url, init });
      if (url === WEB_HEALTH_URL && webAttempts++ === 0) {
        throw new Error("web server is still starting");
      }
      return healthyResponse(url);
    },
    sleep: async () => {},
  });

  assert.deepEqual(calls.map(({ url }) => url), [
    WEB_HEALTH_URL,
    PTY_HEALTH_URL,
    WEB_HEALTH_URL,
  ]);
  assert.deepEqual(calls[0].init.headers, { Accept: "text/html" });
  assert.deepEqual(calls[1].init.headers, { Accept: "application/json" });
});

test("opens Chrome only after both services are healthy and never exposes the token", async () => {
  const web = new FakeChild();
  const pty = new FakeChild();
  const events = [];
  const output = [];
  let environments;

  const result = await runLocal({
    random: fixedRandom,
    parentEnvironment: { HOME: "/tmp/test-home", PATH: "/usr/bin:/bin" },
    workspaceRoot: "/tmp/dotfiles-checkout",
    signalTarget: new EventEmitter(),
    spawnServices(nextEnvironments, mode) {
      environments = nextEnvironments;
      events.push(`spawn:${mode}`);
      return { web, pty };
    },
    healthOptions: {
      async fetchHealth(url) {
        events.push(url === WEB_HEALTH_URL ? "health:web" : "health:pty");
        return healthyResponse(url);
      },
    },
    async openLocalBrowser(url) {
      events.push("open");
      assert.equal(url, LOCAL_ORIGIN);
      queueMicrotask(() => web.emit("exit", 0, null));
    },
    output(message) {
      output.push(message);
    },
  });

  assert.equal(result, 0);
  assert.deepEqual(events, ["spawn:start", "health:web", "health:pty", "open"]);
  assert.deepEqual(pty.killedWith, ["SIGTERM"]);
  assert.doesNotMatch(output.join(""), new RegExp(environments.pty.WIZARD_SESSION_TOKEN));
  assert.match(output.join(""), /Terminal Tutor is ready/);
});

test("stops both owned services when readiness times out", async () => {
  const web = new FakeChild();
  const pty = new FakeChild();
  let clock = 0;
  let browserOpened = false;

  await assert.rejects(
    runLocal({
      random: fixedRandom,
      parentEnvironment: { HOME: "/tmp/test-home", PATH: "/usr/bin:/bin" },
      workspaceRoot: "/tmp/dotfiles-checkout",
      signalTarget: new EventEmitter(),
      spawnServices: () => ({ web, pty }),
      healthOptions: {
        fetchHealth: async () => { throw new Error("connection refused"); },
        now: () => clock,
        sleep: async (milliseconds) => { clock += milliseconds; },
        timeoutMs: 250,
        pollIntervalMs: 100,
      },
      openLocalBrowser: async () => { browserOpened = true; },
      output: () => {},
    }),
    /did not become ready/,
  );

  assert.equal(browserOpened, false);
  assert.deepEqual(web.killedWith, ["SIGTERM"]);
  assert.deepEqual(pty.killedWith, ["SIGTERM"]);
});

test("forwards an interrupt to both owned services", async () => {
  const web = new FakeChild();
  const pty = new FakeChild();
  const signalTarget = new EventEmitter();

  const result = await runLocal({
    random: fixedRandom,
    parentEnvironment: { HOME: "/tmp/test-home", PATH: "/usr/bin:/bin" },
    workspaceRoot: "/tmp/dotfiles-checkout",
    signalTarget,
    spawnServices: () => ({ web, pty }),
    healthOptions: { fetchHealth: async (url) => healthyResponse(url) },
    openLocalBrowser: async () => queueMicrotask(() => signalTarget.emit("SIGINT")),
    output: () => {},
  });

  assert.equal(result, 130);
  assert.deepEqual(web.killedWith, ["SIGINT"]);
  assert.deepEqual(pty.killedWith, ["SIGINT"]);
});
