import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function runChecked(command, args, options) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`,
  );
  return result;
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

test("installs dev dependencies despite production npm settings and rebuilds after a dirty source is reverted", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "terminal-tutor-launcher-"));
  t.after(() => rm(fixture, { force: true, recursive: true }));

  const repositoryRoot = join(fixture, "dotfiles");
  const applicationRoot = join(repositoryRoot, "apps", "terminal-wizard");
  const fakeBin = join(fixture, "bin");
  const npmLog = join(fixture, "npm.log");
  await mkdir(join(repositoryRoot, "bin"), { recursive: true });
  await mkdir(join(applicationRoot, "src"), { recursive: true });
  await mkdir(join(repositoryRoot, "manifest"), { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await copyFile(
    new URL("../../../bin/terminal-tutor", import.meta.url),
    join(repositoryRoot, "bin", "terminal-tutor"),
  );
  await chmod(join(repositoryRoot, "bin", "terminal-tutor"), 0o755);
  await writeFile(join(applicationRoot, "package-lock.json"), "fixture-lock\n");
  await writeFile(join(applicationRoot, "src", "input.ts"), "export const value = 1;\n");
  await writeFile(join(repositoryRoot, "manifest", "setup.json"), "{}\n");
  await writeFile(
    join(repositoryRoot, ".gitignore"),
    "apps/terminal-wizard/node_modules/\napps/terminal-wizard/dist/\n",
  );

  const fakeNpm = join(fakeBin, "npm");
  await writeFile(fakeNpm, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$NPM_LOG"
case "\${1:-} \${2:-}" in
  "ci --include=dev")
    mkdir -p node_modules/.bin node_modules/node-pty node_modules/ws
    : > node_modules/.bin/vite
    chmod 755 node_modules/.bin/vite
    ;;
  "ci --omit=dev")
    mkdir -p node_modules/node-pty node_modules/ws
    rm -f node_modules/.bin/vite
    ;;
  "run build")
    test -x node_modules/.bin/vite
    mkdir -p dist/server
    printf '<!doctype html>\\n' > dist/index.html
    printf 'export {};\\n' > dist/server/pty-server.mjs
    ;;
  "prune --omit=dev")
    rm -f node_modules/.bin/vite
    ;;
  "run prepare:pty"|"start ") ;;
  *) printf 'unexpected npm invocation: %s\\n' "$*" >&2; exit 64 ;;
esac
`);
  await chmod(fakeNpm, 0o755);

  runChecked("git", ["init", "-q"], { cwd: repositoryRoot });
  runChecked("git", ["config", "user.name", "Terminal Tutor Test"], { cwd: repositoryRoot });
  runChecked("git", ["config", "user.email", "terminal-tutor@example.invalid"], { cwd: repositoryRoot });
  runChecked("git", ["add", "."], { cwd: repositoryRoot });
  runChecked("git", ["commit", "-qm", "fixture"], { cwd: repositoryRoot });

  const sourcePath = join(applicationRoot, "src", "input.ts");
  await writeFile(sourcePath, "export const value = 2;\n");
  const environment = {
    ...process.env,
    NODE_ENV: "production",
    NPM_LOG: npmLog,
    PATH: `${fakeBin}:${process.env.PATH}`,
    npm_config_omit: "dev",
  };
  runChecked(join(repositoryRoot, "bin", "terminal-tutor"), [], {
    cwd: repositoryRoot,
    env: environment,
  });

  runChecked("git", ["restore", "apps/terminal-wizard/src/input.ts"], {
    cwd: repositoryRoot,
  });
  runChecked(join(repositoryRoot, "bin", "terminal-tutor"), [], {
    cwd: repositoryRoot,
    env: environment,
  });

  const invocations = (await readFile(npmLog, "utf8")).trim().split("\n");
  assert.equal(
    invocations.filter((entry) => entry === "ci --include=dev").length,
    2,
  );
  assert.equal(
    invocations.filter((entry) => entry === "run build").length,
    2,
  );
});
