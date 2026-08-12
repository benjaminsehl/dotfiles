import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const HOSTED_ORIGIN = "https://terminal-tutor-three.vercel.app";
export const BRIDGE_PORT = 4318;
export const HEALTH_URL = `http://127.0.0.1:${BRIDGE_PORT}/health`;

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(projectRoot, "../..");
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

function base64urlLength(byteLength) {
  return Math.ceil((byteLength * 8) / 6);
}

function requireBase64url(value, byteLength, label) {
  const expectedLength = base64urlLength(byteLength);
  if (typeof value !== "string" || value.length !== expectedLength || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must be ${expectedLength} base64url characters`);
  }
  return value;
}

export function createHostedSecrets(random = randomBytes) {
  return {
    pairingSecret: random(32).toString("base64url"),
    instanceId: random(16).toString("base64url"),
    sessionToken: random(32).toString("hex"),
  };
}

export function buildPairingUrl(instanceId, pairingSecret) {
  const safeInstanceId = requireBase64url(instanceId, 16, "instance ID");
  const safePairingSecret = requireBase64url(pairingSecret, 32, "pairing secret");
  const url = new URL(HOSTED_ORIGIN);
  url.hash = `pair=v1.${safeInstanceId}.${safePairingSecret}`;
  return url.href;
}

export function buildBridgeEnvironment(parentEnvironment, secrets) {
  const inheritedEnvironment = Object.fromEntries(
    inheritedKeys.flatMap((key) => parentEnvironment[key] ? [[key, parentEnvironment[key]]] : []),
  );
  const pairingSecret = requireBase64url(secrets.pairingSecret, 32, "pairing secret");
  const instanceId = requireBase64url(secrets.instanceId, 16, "instance ID");
  if (!/^[a-f0-9]{64}$/.test(secrets.sessionToken)) {
    throw new Error("session token must be 64 lowercase hexadecimal characters");
  }

  return {
    ...inheritedEnvironment,
    NODE_ENV: "production",
    WIZARD_ALLOWED_ORIGIN: HOSTED_ORIGIN,
    WIZARD_INSTANCE_ID: instanceId,
    WIZARD_ONE_SHOT: "1",
    WIZARD_PAIRING_SECRET: pairingSecret,
    WIZARD_PTY_PORT: String(BRIDGE_PORT),
    WIZARD_SESSION_TOKEN: secrets.sessionToken,
    WIZARD_WORKSPACE_ROOT: workspaceRoot,
  };
}

export function browserOpenArguments(url, fileExists = existsSync) {
  const chromePath = "/Applications/Google Chrome.app";
  return fileExists(chromePath) ? ["-a", "Google Chrome", url] : [url];
}

function childOutcome(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    child.once("error", (error) => finish({ kind: "error", error }));
    child.once("exit", (code, signal) => finish({ kind: "exit", code, signal }));
  });
}

export async function openBrowser(url, options = {}) {
  const spawnProcess = options.spawnProcess ?? spawn;
  const args = browserOpenArguments(url, options.fileExists ?? existsSync);
  const opener = spawnProcess("/usr/bin/open", args, { stdio: "ignore" });
  const outcome = await childOutcome(opener);
  if (outcome.kind === "error") throw outcome.error;
  if (outcome.code !== 0) {
    throw new Error(`Browser opener exited with code ${outcome.code ?? "unknown"}`);
  }
}

export async function waitForHealth(instanceId, options = {}) {
  const fetchHealth = options.fetchHealth ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => pause(milliseconds));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    try {
      const response = await fetchHealth(HEALTH_URL, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(Math.min(750, Math.max(50, deadline - now()))),
      });
      if (response.ok) {
        const body = await response.json();
        if (body?.ready === true && body?.instanceId === instanceId) return;
      }
    } catch {
      // The owned companion may still be binding its loopback port.
    }
    await sleep(pollIntervalMs);
  }

  throw new Error("The Live Mac companion did not become ready in time");
}

function defaultSpawnBridge(environment) {
  return spawn(join(projectRoot, "node_modules", ".bin", "tsx"), ["server/pty-server.ts"], {
    cwd: projectRoot,
    env: environment,
    stdio: ["ignore", "inherit", "inherit"],
  });
}

export async function runHosted(options = {}) {
  const secrets = createHostedSecrets(options.random ?? randomBytes);
  const environment = buildBridgeEnvironment(options.parentEnvironment ?? process.env, secrets);
  const spawnBridge = options.spawnBridge ?? defaultSpawnBridge;
  const openHostedBrowser = options.openHostedBrowser ?? ((url) => openBrowser(url));
  const output = options.output ?? ((message) => process.stdout.write(message));
  const signalTarget = options.signalTarget ?? process;
  const bridge = spawnBridge(environment);
  const bridgeOutcome = childOutcome(bridge);
  let stopping = false;
  let stopSignal = null;
  let forceTimer;

  const stop = (signal = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    stopSignal = signal;
    bridge.kill(signal);
    forceTimer = setTimeout(() => bridge.kill("SIGKILL"), 2_000);
    forceTimer.unref?.();
  };
  const stopForInterrupt = () => stop("SIGINT");
  const stopForTermination = () => stop("SIGTERM");
  signalTarget.on("SIGINT", stopForInterrupt);
  signalTarget.on("SIGTERM", stopForTermination);

  try {
    const readiness = waitForHealth(secrets.instanceId, options.healthOptions);
    const initial = await Promise.race([
      readiness.then(() => ({ kind: "ready" })),
      bridgeOutcome,
    ]);
    if (initial.kind === "error") throw initial.error;
    if (initial.kind === "exit") {
      throw new Error(`The Live Mac companion exited before it was ready (${initial.code ?? initial.signal ?? "unknown"})`);
    }

    const pairingUrl = buildPairingUrl(secrets.instanceId, secrets.pairingSecret);
    await openHostedBrowser(pairingUrl);
    output("Terminal Tutor opened with a one-time Live Mac pairing. Keep this terminal window open until you finish.\n");

    const outcome = await bridgeOutcome;
    if (outcome.kind === "error") throw outcome.error;
    if (stopping) return stopSignal === "SIGINT" ? 130 : 143;
    return outcome.code ?? (outcome.signal ? 1 : 0);
  } catch (error) {
    stop("SIGTERM");
    await Promise.race([bridgeOutcome, pause(2_100)]);
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
    process.exitCode = await runHosted();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start the hosted Live Mac companion";
    process.stderr.write(`Terminal Tutor could not start: ${message}\n`);
    process.exitCode = 1;
  }
}
