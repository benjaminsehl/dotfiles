import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(projectRoot, "../..");
const mode = process.argv[2] === "start" ? "start" : "dev";
const token = randomBytes(32).toString("hex");
const bin = (name) => join(projectRoot, "node_modules", ".bin", name);
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
const inheritedEnvironment = Object.fromEntries(
  inheritedKeys.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []),
);
const webEnvironment = {
  ...inheritedEnvironment,
  WIZARD_ALLOWED_ORIGIN: "http://127.0.0.1:4317",
  WIZARD_PTY_PORT: "4318",
};
const ptyEnvironment = {
  ...webEnvironment,
  WIZARD_SESSION_TOKEN: token,
  WIZARD_WORKSPACE_ROOT: workspaceRoot,
};

const webArguments =
  mode === "dev"
    ? ["dev", "-H", "127.0.0.1", "-p", "4317"]
    : ["start", "-H", "127.0.0.1", "-p", "4317"];
const ptyArguments = mode === "dev" ? ["watch", "server/pty-server.ts"] : ["server/pty-server.ts"];

const children = [
  spawn(bin("vinext"), webArguments, {
    cwd: projectRoot,
    env: { ...webEnvironment, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
    stdio: "inherit",
  }),
  spawn(bin("tsx"), ptyArguments, {
    cwd: projectRoot,
    env: ptyEnvironment,
    stdio: "inherit",
  }),
];

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 2_000).unref();
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (stopping) return;
    stop("SIGTERM");
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("exit", () => stop("SIGTERM"));

console.log("Terminal Tutor will open at http://127.0.0.1:4317");
