import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  BRIDGE_PORT,
  HEALTH_URL,
  HOSTED_ORIGIN,
  browserOpenArguments,
  buildBridgeEnvironment,
  buildPairingUrl,
  createHostedSecrets,
  runHosted,
  waitForHealth,
} from "../scripts/run-hosted.mjs";

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

test("builds a canonical fragment-only pairing URL from exact-size secrets", () => {
  const secrets = createHostedSecrets(fixedRandom);
  const url = buildPairingUrl(secrets.instanceId, secrets.pairingSecret);

  assert.equal(new URL(url).origin, HOSTED_ORIGIN);
  assert.equal(new URL(url).search, "");
  assert.equal(new URL(url).hash, `#pair=v1.${secrets.instanceId}.${secrets.pairingSecret}`);
  assert.equal(secrets.instanceId.length, 22);
  assert.equal(secrets.pairingSecret.length, 43);
  assert.match(secrets.sessionToken, /^[a-f0-9]{64}$/);
  assert.throws(() => buildPairingUrl("short", secrets.pairingSecret), /instance ID/);
  assert.throws(() => buildPairingUrl(secrets.instanceId, "not.valid"), /pairing secret/);
});

test("builds the exact one-shot bridge environment without inheriting unrelated secrets", () => {
  const secrets = createHostedSecrets(fixedRandom);
  const environment = buildBridgeEnvironment({
    HOME: "/tmp/test-home",
    PATH: "/usr/bin:/bin",
    AWS_SECRET_ACCESS_KEY: "must-not-pass",
    WIZARD_PAIRING_SECRET: "must-be-replaced",
  }, secrets);

  assert.equal(environment.HOME, "/tmp/test-home");
  assert.equal(environment.PATH, "/usr/bin:/bin");
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(environment.WIZARD_ALLOWED_ORIGIN, HOSTED_ORIGIN);
  assert.equal(environment.WIZARD_PAIRING_SECRET, secrets.pairingSecret);
  assert.equal(environment.WIZARD_INSTANCE_ID, secrets.instanceId);
  assert.equal(environment.WIZARD_SESSION_TOKEN, secrets.sessionToken);
  assert.equal(environment.WIZARD_PTY_PORT, String(BRIDGE_PORT));
  assert.equal(environment.WIZARD_ONE_SHOT, "1");
  assert.match(environment.WIZARD_WORKSPACE_ROOT, /\/Sites\/dotfiles$/);
});

test("prefers installed Chrome and otherwise uses the default macOS browser", () => {
  const url = `${HOSTED_ORIGIN}/#pair=redacted`;
  assert.deepEqual(browserOpenArguments(url, () => true), ["-a", "Google Chrome", url]);
  assert.deepEqual(browserOpenArguments(url, () => false), [url]);
});

test("waits for the matching owned companion instance", async () => {
  const calls = [];
  const responses = [
    new Response(JSON.stringify({ ready: true, instanceId: "wrong-instance" })),
    new Response(JSON.stringify({ ready: true, instanceId: "expected-instance" })),
  ];

  await waitForHealth("expected-instance", {
    fetchHealth: async (url, init) => {
      calls.push({ url, init });
      return responses.shift();
    },
    sleep: async () => {},
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, HEALTH_URL);
  assert.deepEqual(calls[0].init.headers, { Accept: "application/json" });
  assert.equal("Origin" in calls[0].init.headers, false);
});

test("opens only after health is ready and never prints the pairing secret", async () => {
  const bridge = new FakeChild();
  const events = [];
  const output = [];
  let bridgeEnvironment;
  const signalTarget = new EventEmitter();

  const result = await runHosted({
    random: fixedRandom,
    parentEnvironment: { HOME: "/tmp/test-home", PATH: "/usr/bin:/bin" },
    signalTarget,
    spawnBridge(environment) {
      events.push("spawn");
      bridgeEnvironment = environment;
      return bridge;
    },
    healthOptions: {
      async fetchHealth() {
        events.push("health");
        return new Response(JSON.stringify({
          ready: true,
          instanceId: bridgeEnvironment.WIZARD_INSTANCE_ID,
        }));
      },
    },
    async openHostedBrowser(url) {
      events.push("open");
      assert.equal(new URL(url).hash, `#pair=v1.${bridgeEnvironment.WIZARD_INSTANCE_ID}.${bridgeEnvironment.WIZARD_PAIRING_SECRET}`);
      queueMicrotask(() => bridge.emit("exit", 0, null));
    },
    output(message) {
      output.push(message);
    },
  });

  assert.equal(result, 0);
  assert.deepEqual(events, ["spawn", "health", "open"]);
  assert.doesNotMatch(output.join(""), new RegExp(bridgeEnvironment.WIZARD_PAIRING_SECRET));
  assert.doesNotMatch(output.join(""), /#pair=/);
});

test("stops the owned bridge when readiness times out", async () => {
  const bridge = new FakeChild();
  let clock = 0;
  let browserOpened = false;

  await assert.rejects(
    runHosted({
      random: fixedRandom,
      parentEnvironment: { HOME: "/tmp/test-home", PATH: "/usr/bin:/bin" },
      signalTarget: new EventEmitter(),
      spawnBridge: () => bridge,
      healthOptions: {
        fetchHealth: async () => { throw new Error("connection refused"); },
        now: () => clock,
        sleep: async (milliseconds) => { clock += milliseconds; },
        timeoutMs: 250,
        pollIntervalMs: 100,
      },
      openHostedBrowser: async () => { browserOpened = true; },
      output: () => {},
    }),
    /did not become ready/,
  );

  assert.equal(browserOpened, false);
  assert.deepEqual(bridge.killedWith, ["SIGTERM"]);
});

test("forwards an interrupt and returns its conventional exit status", async () => {
  const bridge = new FakeChild();
  const signalTarget = new EventEmitter();

  const result = await runHosted({
    random: fixedRandom,
    parentEnvironment: { HOME: "/tmp/test-home", PATH: "/usr/bin:/bin" },
    signalTarget,
    spawnBridge: () => bridge,
    healthOptions: {
      fetchHealth: async () => new Response(JSON.stringify({
        ready: true,
        instanceId: createHostedSecrets(fixedRandom).instanceId,
      })),
    },
    openHostedBrowser: async () => queueMicrotask(() => signalTarget.emit("SIGINT")),
    output: () => {},
  });

  assert.equal(result, 130);
  assert.deepEqual(bridge.killedWith, ["SIGINT"]);
});
