import { defineCommand, type CommandContext, type ExecResult } from "just-bash";
import type { BashShell } from "@wterm/just-bash";
import {
  getSetupToolVersion,
  setupManifest,
  setupSafety,
} from "../data/setup-manifest";

const ok = (stdout: string): ExecResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr: string): ExecResult => ({ stdout: "", stderr, exitCode: 1 });

export const practiceVersionLines: Record<string, string> = {
  ghostty: `ghostty ${getSetupToolVersion("ghostty")}\n`,
  starship: `starship ${getSetupToolVersion("starship")}\n`,
  herdr: `herdr ${getSetupToolVersion("herdr")}\n`,
  omp: `${getSetupToolVersion("omp")}\n`,
  codex: `codex-cli ${getSetupToolVersion("codex")}\n`,
  gh: `gh version ${getSetupToolVersion("gh")} (practice snapshot)\n`,
  node: `v${getSetupToolVersion("node")}\n`,
  npm: `${getSetupToolVersion("npm")}\n`,
  pnpm: `${getSetupToolVersion("pnpm")}\n`,
  bun: `${getSetupToolVersion("bun")}\n`,
  go: `go version go${getSetupToolVersion("go")} darwin/amd64\n`,
  python3: `Python ${getSetupToolVersion("python")}\n`,
  uv: `uv ${getSetupToolVersion("uv")}\n`,
  nvim: `NVIM v${getSetupToolVersion("nvim")}\n`,
  mise: `${getSetupToolVersion("mise")} macos-x64 (practice snapshot)\n`,
};

const practiceRuntimeIds = ["node", "pnpm", "bun", "go", "python"] as const;

export const practiceDoctorOutput = `Developer workstation doctor (practice snapshot)
✓ clean zsh login; no Fig hooks
✓ Homebrew declaration satisfied
✓ Ghostty config valid
✓ mise runtimes pinned
✓ OMP approval mode: ${setupSafety.approvalMode}
✓ OMP secret masking: ${setupSafety.secretsEnabled ? "enabled" : "disabled"}
✓ Herdr ↔ OMP integration current
✓ Herdr ↔ Codex integration current
✓ sensitive file modes private

All promised checks pass in the recorded setup. Run this in Live Mac for current state.
`;

export const basePracticeFiles: Record<string, string> = {
  "/home/benjamin/Developer/terminal-wizard/README.md": `# Terminal Wizard

Practice is an in-memory shell. Try pwd, tree, rg, jq, and git status.
Nothing here can alter the Mac.
`,
  "/home/benjamin/Developer/terminal-wizard/package.json": `${JSON.stringify(
    {
      name: "terminal-wizard",
      private: true,
      scripts: {
        dev: "npm run dev:web",
        check: "npm run typecheck && npm run lint && npm run test:unit",
      },
    },
    null,
    2,
  )}\n`,
  "/home/benjamin/Developer/terminal-wizard/docs/shortcuts.md": `# Shortcuts

- Control-R: fuzzy history
- Control-T: fuzzy file finder
- Option-C: fuzzy directory jump
- Control-B then ?: Herdr help
- Control-B then Q: detach Herdr
`,
  "/home/benjamin/Developer/terminal-wizard/docs/TODO.md": `# Practice ideas

- [ ] Search this project with rg
- [ ] Inspect setup.json with jq
- [ ] Run dev-doctor
`,
  "/home/benjamin/Developer/terminal-wizard/config/omp.yml": `tools:
  approvalMode: ${setupSafety.approvalMode}
secrets:
  enabled: ${setupSafety.secretsEnabled}
`,
  "/home/benjamin/Developer/terminal-wizard/setup.json": JSON.stringify(setupManifest, null, 2),
};

function versionCommand(name: string) {
  return defineCommand(name, async (args) => {
    if (args.length === 0 && ["herdr", "omp", "codex", "nvim"].includes(name)) {
      return ok(
        `${practiceVersionLines[name]}Practice mode does not launch interactive full-screen programs. Switch to Live Mac deliberately when you need the real ${name}.\n`,
      );
    }
    return ok(practiceVersionLines[name]);
  });
}

function positionalArguments(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--level", "-L"].includes(argument)) {
      index += 1;
      continue;
    }
    if (!argument.startsWith("-")) values.push(argument);
  }
  return values;
}

function pathsBelow(root: string, ctx: CommandContext): string[] {
  const prefix = root === "/" ? "/" : `${root}/`;
  return ctx.fs
    .getAllPaths()
    .filter((path) => path !== root && path.startsWith(prefix))
    .map((path) => path.slice(prefix.length))
    .filter(Boolean)
    .sort();
}

function requestedDepth(args: string[], fallback: number): number {
  const inline = args.find((argument) => /^--level=\d+$/.test(argument));
  if (inline) return Number(inline.slice("--level=".length));

  const levelIndex = args.findIndex((argument) => argument === "--level" || argument === "-L");
  if (levelIndex >= 0) {
    const parsed = Number(args[levelIndex + 1]);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return fallback;
}

async function listPaths(args: string[], ctx: CommandContext): Promise<ExecResult> {
  const target = positionalArguments(args)[0] ?? ".";
  const root = ctx.fs.resolvePath(ctx.cwd, target);
  if (!(await ctx.fs.exists(root))) return fail(`eza: ${target}: No such file or directory\n`);

  const depth = requestedDepth(args, args.includes("--tree") ? Number.POSITIVE_INFINITY : 1);
  const paths = pathsBelow(root, ctx).filter((path) => path.split("/").length <= depth);
  return ok(`${paths.slice(0, 80).join("\n")}${paths.length ? "\n" : ""}`);
}

async function findPaths(args: string[], ctx: CommandContext): Promise<ExecResult> {
  const [rawNeedle = "", rawRoot = "."] = positionalArguments(args);
  const needle = rawNeedle.toLowerCase();
  const root = ctx.fs.resolvePath(ctx.cwd, rawRoot);
  if (!(await ctx.fs.exists(root))) return fail(`fd: ${rawRoot}: No such file or directory\n`);

  const paths = pathsBelow(root, ctx).filter((path) => !needle || path.toLowerCase().includes(needle));
  return ok(`${paths.slice(0, 80).join("\n")}${paths.length ? "\n" : ""}`);
}

async function practiceTree(args: string[], ctx: CommandContext): Promise<ExecResult> {
  const target = positionalArguments(args)[0] ?? ".";
  const root = ctx.fs.resolvePath(ctx.cwd, target);
  if (!(await ctx.fs.exists(root))) {
    if (root === "/workspace") {
      return ok(
        "/workspace\n└── No read-only folder is connected. Use “Connect a folder” above, then run this again.\n",
      );
    }
    return fail(`tree: ${target}: No such file or directory\n`);
  }

  const depth = requestedDepth(args, Number.POSITIVE_INFINITY);
  const paths = pathsBelow(root, ctx).filter((path) => path.split("/").length <= depth);
  const heading = target === "." ? "." : target;
  const lines = paths.slice(0, 80).map((path) => {
    const segments = path.split("/");
    return `${"    ".repeat(Math.max(0, segments.length - 1))}└── ${segments.at(-1)}`;
  });
  return ok(`${[heading, ...lines].join("\n")}\n\n${paths.length} entries in the practice snapshot\n`);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function practiceRipgrep(args: string[], ctx: CommandContext): Promise<ExecResult> {
  const positionals = positionalArguments(args);
  const pattern = positionals[0];
  if (!pattern) return fail("rg: provide a search pattern\n");

  const rawTargets = positionals.slice(1);
  const targets = rawTargets.length ? rawTargets : ["."];
  const roots = targets.map((target) => ctx.fs.resolvePath(ctx.cwd, target));
  for (const [index, root] of roots.entries()) {
    if (await ctx.fs.exists(root)) continue;
    if (root === "/workspace") {
      return ok(
        "No read-only folder is connected at /workspace. Use “Connect a folder” above, then run this search again.\n",
      );
    }
    return fail(`rg: ${targets[index]}: No such file or directory\n`);
  }

  const fixed = args.includes("-F") || args.includes("--fixed-strings");
  const ignoreCase = args.includes("-i") || args.includes("--ignore-case") || !/[A-Z]/.test(pattern);
  const filesOnly = args.includes("-l") || args.includes("--files-with-matches");
  let expression: RegExp;
  try {
    expression = new RegExp(fixed ? escapeRegularExpression(pattern) : pattern, ignoreCase ? "i" : "");
  } catch {
    return fail(`rg: invalid regular expression: ${pattern}\n`);
  }

  const candidatePaths = new Set<string>();
  for (const root of roots) {
    if ((await ctx.fs.stat(root)).isFile) candidatePaths.add(root);
    for (const relativePath of pathsBelow(root, ctx)) {
      candidatePaths.add(root === "/" ? `/${relativePath}` : `${root}/${relativePath}`);
    }
  }

  const matches: string[] = [];
  for (const path of [...candidatePaths].sort()) {
    try {
      if (!(await ctx.fs.stat(path)).isFile) continue;
      const content = await ctx.fs.readFile(path, "utf8");
      const displayPath = path.startsWith(`${ctx.cwd}/`) ? path.slice(ctx.cwd.length + 1) : path;
      let matchedFile = false;
      for (const [lineIndex, line] of content.split("\n").entries()) {
        if (!expression.test(line)) continue;
        matchedFile = true;
        matches.push(filesOnly ? displayPath : `${displayPath}:${lineIndex + 1}:${line}`);
        if (filesOnly) break;
      }
      if (filesOnly && matchedFile) continue;
    } catch {
      // Practice snapshots contain sanitized text; unreadable entries are skipped like rg defaults.
    }
  }

  return matches.length ? ok(`${matches.join("\n")}\n`) : fail("");
}

async function readPretty(args: string[], ctx: CommandContext): Promise<ExecResult> {
  const target = args.find((argument) => !argument.startsWith("-"));
  if (!target) return fail("bat: provide a text file to read\n");
  try {
    const path = ctx.fs.resolvePath(ctx.cwd, target);
    const content = await ctx.fs.readFile(path, "utf8");
    return ok(content.endsWith("\n") ? content : `${content}\n`);
  } catch {
    return fail(`bat: ${target}: No such text file\n`);
  }
}

function gitResult(args: string[]): ExecResult {
  const subcommand = args[0] ?? "status";
  if (subcommand === "--version") return ok(`git version ${getSetupToolVersion("git")}\n`);
  if (subcommand === "status") {
    return ok(
      args.includes("--short")
        ? " M app/components/WizardTerminal.tsx\n?? notes/terminal-tricks.md\n"
        : "On branch main\nChanges not staged for commit:\n  modified: app/components/WizardTerminal.tsx\n\nUntracked files:\n  notes/terminal-tricks.md\n",
    );
  }
  if (subcommand === "diff") {
    return ok(args.includes("--stat") ? " app/components/WizardTerminal.tsx | 12 +++++++++---\n 1 file changed, 9 insertions(+), 3 deletions(-)\n" : "diff --git a/app/components/WizardTerminal.tsx b/app/components/WizardTerminal.tsx\n+// simulated practice change\n");
  }
  if (subcommand === "log") {
    return ok("a8e1c42 (HEAD -> main) Teach live-shell boundaries\n54fc901 Add read-only project practice\n08ab133 Build terminal foundations\n");
  }
  if (subcommand === "branch") return ok("* main\n  lesson/search\n");
  return ok(`git ${args.join(" ")}\nPractice snapshot: command understood; no real repository was changed.\n`);
}

function ghResult(args: string[]): ExecResult {
  if (args[0] === "auth" && args[1] === "status") {
    return ok("github.com\n  ✓ Practice identity ready (no real credentials are loaded)\n");
  }
  if (args.includes("--version") || args[0] === "version") return ok(practiceVersionLines.gh);
  return ok(`gh ${args.join(" ")}\nPractice mode never contacts GitHub. Use Live Mac for an authenticated operation.\n`);
}

function miseResult(args: string[]): ExecResult {
  if (args.includes("--version") || args[0] === "version") return ok(practiceVersionLines.mise);
  if (args[0] === "current" || args[0] === "ls") {
    return ok(
      `${practiceRuntimeIds
        .map((id) => `${id.padEnd(8)} ${getSetupToolVersion(id)}`)
        .join("\n")}\n`,
    );
  }
  return ok("mise: project runtimes are pinned by the dotfiles snapshot\n");
}

function ompResult(args: string[]): ExecResult {
  if (args[0] === "--version" || args[0] === "version") return ok(practiceVersionLines.omp);
  if (args[0] === "config" && args[1] === "get") {
    if (args[2] === "tools.approvalMode") return ok(`${setupSafety.approvalMode}\n`);
    if (args[2] === "secrets.enabled") return ok(`${setupSafety.secretsEnabled}\n`);
  }
  return ok(`OMP is not launched in Practice. Safety snapshot: approval mode ${setupSafety.approvalMode}; secret masking ${setupSafety.secretsEnabled ? "enabled" : "disabled"}.\n`);
}

function doctorResult(): ExecResult {
  return ok(practiceDoctorOutput);
}

export function registerPracticeCommands(shell: BashShell): void {
  const bash = shell.bash;
  if (!bash) return;

  for (const name of ["ghostty", "starship", "herdr", "codex", "node", "npm", "pnpm", "bun", "go", "python3", "uv", "nvim"]) {
    bash.registerCommand(versionCommand(name));
  }
  bash.registerCommand(defineCommand("omp", async (args) => ompResult(args)));
  bash.registerCommand(defineCommand("mise", async (args) => miseResult(args)));
  bash.registerCommand(defineCommand("git", async (args) => gitResult(args)));
  bash.registerCommand(defineCommand("gh", async (args) => ghResult(args)));
  bash.registerCommand(defineCommand("fd", findPaths));
  bash.registerCommand(defineCommand("eza", listPaths));
  bash.registerCommand(defineCommand("bat", readPretty));
  bash.registerCommand(defineCommand("gs", async () => gitResult(["status", "--short"])));
  bash.registerCommand(defineCommand("gd", async () => gitResult(["diff"])));
  bash.registerCommand(defineCommand("gl", async () => gitResult(["log", "--oneline", "-5"])));
  bash.registerCommand(defineCommand("ll", async (args, ctx) => listPaths(["-la", ...args], ctx)));
  bash.registerCommand(defineCommand("la", async (args, ctx) => listPaths(["-la", ...args], ctx)));
  bash.registerCommand(
    defineCommand("z", async (args) =>
      ok(`zoxide would jump to the highest-ranked match for “${args.join(" ") || "…"}” on your Mac.\n`),
    ),
  );
  bash.registerCommand(
    defineCommand("fzf", async () => ok("fzf is interactive on the real Mac. Try Control-R, Control-T, or Option-C there.\n")),
  );
  bash.registerCommand(defineCommand("dev-doctor", async () => doctorResult()));
  bash.registerCommand(
    defineCommand("dev-update", async () =>
      ok("Practice mode: no packages changed. On the Mac, this updates only the Brewfile set and refreshes reviewed mise pins.\n"),
    ),
  );
  bash.registerCommand(
    defineCommand("apply", async (args) =>
      ok(
        args.includes("--dry-run")
          ? "Dry run: dotfile links already match; package and OMP post-install checks would run.\n"
          : "Practice mode: apply is simulated. Use the dotfiles bootstrap on the Mac after reviewing --dry-run.\n",
      ),
    ),
  );
  bash.registerCommand(
    defineCommand("gitleaks", async () => ok("○ scan complete: no leaks found in the practice filesystem\n")),
  );

  const hasWorkspace = bash.fs
    .getAllPaths()
    .some((path) => path === "/workspace" || path.startsWith("/workspace/"));
  if (!hasWorkspace) {
    // Keep the advertised /workspace lessons useful before a folder is connected,
    // while leaving just-bash's real tree and rg implementations intact once one is mounted.
    bash.registerCommand(defineCommand("tree", practiceTree));
    bash.registerCommand(defineCommand("rg", practiceRipgrep));
  }
}

export function promptFor(cwd: string): string {
  const short = cwd
    .replace("/home/benjamin/Developer/terminal-wizard", "terminal-wizard")
    .replace("/home/benjamin", "~");
  return `\x1b[38;2;137;180;250m${short}\x1b[0m \x1b[38;2;166;227;161m❯\x1b[0m `;
}
