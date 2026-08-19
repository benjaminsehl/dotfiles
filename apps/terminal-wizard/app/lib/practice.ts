import { defineCommand, type CommandContext, type ExecResult } from "just-bash";
import type { PracticeShell } from "./practice-shell";
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
export const PRACTICE_ROOT = "/home/benjamin/Sites/dotfiles";

export const practiceDoctorOutput = `Developer workstation declaration (practice model)
✓ expected clean zsh login
✓ declared Homebrew set represented
✓ declared Ghostty and mise configuration represented
✓ OMP approval mode target: ${setupSafety.approvalMode}
✓ OMP secret masking target: ${setupSafety.secretsEnabled ? "enabled" : "disabled"}
✓ Herdr integration targets represented
✓ private-mode policy represented

The teaching model is internally consistent; this is not a live health result.
Switch to Live Mac and run dev-doctor to observe the current workstation.
`;

export const basePracticeFiles: Record<string, string> = {
  [`${PRACTICE_ROOT}/README.md`]: `# Benjamin's dotfiles

Practice is an in-memory model of ~/Sites/dotfiles. Try pwd, tree, rg, jq, and git status.
Nothing here can alter the Mac.
`,
  [`${PRACTICE_ROOT}/apps/terminal-wizard/package.json`]: `${JSON.stringify(
    {
      name: "terminal-tutor",
      private: true,
      scripts: {
        dev: "npm run dev:web",
        check: "npm run typecheck && npm run lint && npm run test:unit",
      },
    },
    null,
    2,
  )}\n`,
  [`${PRACTICE_ROOT}/docs/shortcuts.md`]: `# Shortcuts

- Control-R: fuzzy history
- Control-T: fuzzy file finder
- Option-C: fuzzy directory jump
- Control-B then ?: Herdr help
- Control-B then Q: detach Herdr
`,
  [`${PRACTICE_ROOT}/docs/TODO.md`]: `# Practice ideas

TODO: rehearse one safe search before switching to Live Mac.

- [ ] Search this project with rg
- [ ] Inspect manifest/setup.json with jq
- [ ] Run dev-doctor
`,
  [`${PRACTICE_ROOT}/notes/terminal-tricks.md`]: `# Terminal trick

Inspect first, mutate second.
`,
  [`${PRACTICE_ROOT}/scripts/check-links`]: `#!/usr/bin/env bash
set -euo pipefail
printf 'practice links are healthy\\n'
`,
  [`${PRACTICE_ROOT}/apps/terminal-wizard/app/example.ts`]: `export const ready = true;
`,
  [`${PRACTICE_ROOT}/practice/omp.yml`]: `tools:
  approvalMode: ${setupSafety.approvalMode}
secrets:
  enabled: ${setupSafety.secretsEnabled}
`,
  [`${PRACTICE_ROOT}/manifest/setup.json`]: JSON.stringify(setupManifest, null, 2),
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
      return fail(
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
      return fail(
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

type PracticeGitState = {
  branch: string;
  staged: boolean;
  committed: boolean;
};

function gitResult(args: string[], state: PracticeGitState): ExecResult {
  const subcommand = args[0] ?? "status";
  if (subcommand === "--version") return ok(`git version ${getSetupToolVersion("git")}\n`);
  if (subcommand === "status") {
    if (state.committed) return ok(`On branch ${state.branch}\nnothing to commit, working tree clean\n`);
    if (state.staged) {
      return ok(
        args.includes("--short")
          ? "A  notes/terminal-tricks.md\n"
          : `On branch ${state.branch}\nChanges to be committed:\n  new file: notes/terminal-tricks.md\n`,
      );
    }
    return ok(
      args.includes("--short")
        ? " M app/components/WizardTerminal.tsx\n?? notes/terminal-tricks.md\n"
        : `On branch ${state.branch}\nChanges not staged for commit:\n  modified: app/components/WizardTerminal.tsx\n\nUntracked files:\n  notes/terminal-tricks.md\n`,
    );
  }
  if (subcommand === "diff") {
    return ok(args.includes("--stat") ? " app/components/WizardTerminal.tsx | 12 +++++++++---\n 1 file changed, 9 insertions(+), 3 deletions(-)\n" : "diff --git a/app/components/WizardTerminal.tsx b/app/components/WizardTerminal.tsx\n+// simulated practice change\n");
  }
  if (subcommand === "log") {
    const newest = state.committed
      ? `d0c0fed (HEAD -> ${state.branch}) Document terminal trick\n`
      : `a8e1c42 (HEAD -> ${state.branch}) Teach live-shell boundaries\n`;
    return ok(`${newest}54fc901 Add read-only project practice\n08ab133 Build terminal foundations\n`);
  }
  if (subcommand === "branch") return ok(`* ${state.branch}\n  main\n`);
  if (subcommand === "switch" && args[1] === "-c" && args[2]) {
    state.branch = args[2];
    return ok(`Switched to a new branch '${state.branch}'\n`);
  }
  if (subcommand === "add" && args.includes("notes/terminal-tricks.md")) {
    state.staged = true;
    return ok("Staged notes/terminal-tricks.md in the practice repository.\n");
  }
  if (subcommand === "commit") {
    if (state.committed) return ok("Practice checkpoint already committed.\n");
    if (!state.staged) return fail("nothing staged; run git add first\n");
    state.committed = true;
    state.staged = false;
    return ok(`[${state.branch} d0c0fed] Document terminal trick\n 1 file changed, 3 insertions(+)\n`);
  }
  return ok(`git ${args.join(" ")}\nPractice snapshot: command understood; no real repository was changed.\n`);
}

function ghResult(args: string[], state: PracticeGitState): ExecResult {
  if (args[0] === "auth" && args[1] === "status") {
    return ok("github.com\n  ✓ Practice identity ready (no real credentials are loaded)\n");
  }
  if (args.includes("--version") || args[0] === "version") return ok(practiceVersionLines.gh);
  if (args[0] === "pr" && args[1] === "create") {
    if (!state.committed) return fail("Practice: commit the staged checkpoint before preparing a pull request.\n");
    return ok(`Practice draft ready for ${state.branch}; no network request was made.\n`);
  }
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
  if (args[0] === "doctor") {
    return ok("mise doctor (practice snapshot)\n✓ config loaded\n✓ shims active\n✓ exact project runtimes resolved\n");
  }
  return ok("mise: project runtimes are pinned by the dotfiles snapshot\n");
}

async function uvResult(args: string[], ctx: CommandContext): Promise<ExecResult> {
  if (args.includes("--version") || args[0] === "version") return ok(practiceVersionLines.uv);
  if (args[0] !== "init") return ok("uv uses an isolated in-memory project in Practice.\n");
  const name = args[1] || "scratch-python";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) return fail("uv init: choose a simple project name\n");
  const root = ctx.fs.resolvePath(ctx.cwd, name);
  if (!(await ctx.fs.exists(root))) await ctx.fs.mkdir(root, { recursive: true });
  await ctx.fs.writeFile(`${root}/pyproject.toml`, `[project]\nname = "${name}"\nversion = "0.1.0"\n`);
  await ctx.fs.writeFile(`${root}/README.md`, `# ${name}\n`);
  return ok(`Initialized project '${name}' in the in-memory practice filesystem.\n`);
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

function astGrepResult(args: string[]): ExecResult {
  const patternIndex = args.findIndex((argument) => argument === "-p" || argument === "--pattern");
  if (args[0] !== "run" || patternIndex < 0 || !args[patternIndex + 1]) {
    return fail("sg: use `sg run -p 'pattern' path` for a structural search\n");
  }
  if (args[patternIndex + 1] !== "export const $A = $B") {
    return fail("sg: that pattern has no matches in the practice project\n");
  }
  return ok("apps/terminal-wizard/app/example.ts:1:export const ready = true;\n");
}

export function registerPracticeCommands(shell: PracticeShell): void {
  const bash = shell.bash;
  if (!bash) return;

  const gitState: PracticeGitState = { branch: "main", staged: false, committed: false };

  for (const name of ["ghostty", "starship", "herdr", "codex", "node", "npm", "pnpm", "bun", "go", "python3", "nvim"]) {
    bash.registerCommand(versionCommand(name));
  }
  bash.registerCommand(defineCommand("uv", uvResult));
  bash.registerCommand(defineCommand("omp", async (args) => ompResult(args)));
  bash.registerCommand(defineCommand("mise", async (args) => miseResult(args)));
  bash.registerCommand(defineCommand("git", async (args) => gitResult(args, gitState)));
  bash.registerCommand(defineCommand("gh", async (args) => ghResult(args, gitState)));
  bash.registerCommand(defineCommand("fd", findPaths));
  bash.registerCommand(defineCommand("eza", listPaths));
  bash.registerCommand(defineCommand("bat", readPretty));
  bash.registerCommand(defineCommand("gs", async () => gitResult(["status", "--short"], gitState)));
  bash.registerCommand(defineCommand("gd", async () => gitResult(["diff"], gitState)));
  bash.registerCommand(defineCommand("gl", async () => gitResult(["log", "--oneline", "-5"], gitState)));
  bash.registerCommand(defineCommand("ll", async (args, ctx) => listPaths(["-la", ...args], ctx)));
  bash.registerCommand(defineCommand("la", async (args, ctx) => listPaths(["-la", ...args], ctx)));
  bash.registerCommand(
    defineCommand("e", async (args, ctx) => {
      const target = args[0] ?? "README.md";
      const path = ctx.fs.resolvePath(ctx.cwd, target);
      if (!(await ctx.fs.exists(path))) return fail(`nvim: ${target}: No such file\n`);
      return ok(`Practice editor preview for ${target}; Live Mac opens Neovim.\n`);
    }),
  );
  bash.registerCommand(
    defineCommand("n", async (args, ctx) => {
      const target = args[0] ?? "README.md";
      const path = ctx.fs.resolvePath(ctx.cwd, target);
      if (!(await ctx.fs.exists(path))) return fail(`nvim: ${target}: No such file\n`);
      return ok(`Practice editor preview for ${target}; Live Mac opens Neovim.\n`);
    }),
  );
  bash.registerCommand(defineCommand("sg", async (args) => astGrepResult(args)));
  bash.registerCommand(
    defineCommand("lazygit", async () => ok("Practice lazygit view: status, files, branches, commits. Live Mac opens the interactive UI.\n")),
  );
  bash.registerCommand(
    defineCommand("lg", async () => ok("Practice lazygit view: status, files, branches, commits. Live Mac opens the interactive UI.\n")),
  );
  bash.registerCommand(
    defineCommand("direnv", async (args) =>
      args[0] === "status"
        ? ok("direnv status (practice)\nNo .envrc is loaded; approval remains explicit.\n")
        : ok("Practice mode does not load project environment files.\n"),
    ),
  );
  bash.registerCommand(
    defineCommand("shellcheck", async (args) =>
      ok(`No ShellCheck findings in ${args[0] ?? "the practice script"}.\n`),
    ),
  );
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
    .replace(PRACTICE_ROOT, "dotfiles")
    .replace("/home/benjamin", "~");
  return `\x1b[38;2;137;180;250m${short}\x1b[0m \x1b[38;2;166;227;161m❯❯❯\x1b[0m `;
}
