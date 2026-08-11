import {
  getSetupAlias,
  getSetupLearningPath,
  getSetupToolVersion,
  getSetupWorkflow,
  setupManifest,
  setupSafety,
  setupShortcuts,
} from "@/app/data/setup-manifest";

export type LessonCommandMode = "either" | "practice" | "live";

export type LessonCommand = {
  command: string;
  label: string;
  detail: string;
  mode?: LessonCommandMode;
};

export type Lesson = {
  id: string;
  number: string;
  kicker: string;
  title: string;
  summary: string;
  outcome: string;
  level: "beginner" | "intermediate" | "advanced";
  minutes: number;
  manifestPathId?: string;
  commands: LessonCommand[];
  fieldNotes: string[];
};

const nodeVersion = getSetupToolVersion("node");
const pnpmVersion = getSetupToolVersion("pnpm");
const pythonVersion = getSetupToolVersion("python");
const uvVersion = getSetupToolVersion("uv");
const herdrVersion = getSetupToolVersion("herdr");
const ompVersion = getSetupToolVersion("omp");
const codexVersion = getSetupToolVersion("codex");
const approvalModeTitle =
  setupSafety.approvalMode.charAt(0).toUpperCase() + setupSafety.approvalMode.slice(1);
const orientationPath = getSetupLearningPath("terminal-orientation");
const movementPath = getSetupLearningPath("find-and-move");
const gitPath = getSetupLearningPath("git-confidence");
const runtimePath = getSetupLearningPath("runtime-mastery");
const agentPath = getSetupLearningPath("agent-workspace");
const maintenancePath = getSetupLearningPath("maintain-the-machine");
const previewWorkflow = getSetupWorkflow("preview");
const checkWorkflow = getSetupWorkflow("check");
const updateWorkflow = getSetupWorkflow("update");
const reconcileWorkflow = getSetupWorkflow("reconcile");
const gsAlias = getSetupAlias("gs");
const gdAlias = getSetupAlias("gd");
const glAlias = getSetupAlias("gl");
const editorAlias = getSetupAlias("e");
const lazygitAlias = getSetupAlias("lg");

function shortcut(keys: string): string {
  const entry = setupShortcuts.find((candidate) => candidate.keys === keys);
  if (!entry) throw new Error(`Shortcut “${keys}” is missing from manifest/setup.json`);
  return `${entry.keys}: ${entry.action}`;
}

export const lessons: Lesson[] = [
  {
    id: "orientation",
    number: "01",
    kicker: "Build a mental map",
    title: "Know what is actually running",
    summary:
      "Ghostty is the window, zsh interprets commands, Starship draws the prompt, Herdr keeps work alive, and OMP is the coding agent inside it.",
    outcome: "You can identify your shell, location, and command-resolution order without guessing.",
    level: orientationPath.level,
    minutes: orientationPath.minutes,
    manifestPathId: orientationPath.id,
    commands: [
      { command: "pwd", label: "Where am I?", detail: "Print the current working directory." },
      {
        command: "echo $SHELL",
        label: "Which shell?",
        detail: "Confirm that new terminal sessions use zsh.",
      },
      {
        command: "echo $PATH | tr ':' '\\n'",
        label: "Resolution order",
        detail: "See every directory searched when you type a command.",
      },
      {
        command: "which gh",
        label: "Find a tool",
        detail: "Show the executable that wins on PATH.",
      },
      { command: "la", label: "Read the room", detail: "Use your declared alias for an all-files project overview." },
      { command: "bat README.md", label: "Preview safely", detail: "Read a text file without opening an editor." },
    ],
    fieldNotes: [
      "Read the prompt left to right: folder, Git branch/state, then the ❯ input marker.",
      "When a command behaves strangely, `type -a command` is more revealing than reinstalling it.",
      shortcut("Up / Down"),
    ],
  },
  {
    id: "navigation",
    number: "02",
    kicker: "Move without friction",
    title: "Navigate at thought speed",
    summary:
      "Use eza for shape, zoxide for memory, and fzf when you remember only a fragment. These replace repetitive `cd` chains with intent.",
    outcome: "You can inspect a project and jump between familiar folders with a few keystrokes.",
    level: "beginner",
    minutes: 8,
    commands: [
      { command: "eza --tree --level=2", label: "See the shape", detail: "A compact two-level project tree." },
      { command: "ls -la", label: "Reveal details", detail: "Include hidden files and permissions." },
      { command: "cd docs && pwd", label: "Move, then verify", detail: "Chain a successful move with an inspection." },
      { command: "z dotfiles", label: "Jump by memory", detail: "On your Mac, zoxide ranks folders you visit." },
    ],
    fieldNotes: [
      shortcut("Control-T"),
      shortcut("Option-C"),
      shortcut("Control-R"),
    ],
  },
  {
    id: "search",
    number: "03",
    kicker: "Ask the filesystem",
    title: "Find anything in seconds",
    summary:
      "`fd` finds names, `rg` finds text, `bat` reads files, and `jq` makes JSON answer precise questions.",
    outcome: "You can locate the right file or line before reaching for an editor.",
    level: movementPath.level,
    minutes: movementPath.minutes,
    manifestPathId: movementPath.id,
    commands: [
      { command: "fd -e md", label: "Find by name", detail: "Find Markdown files with friendly defaults." },
      { command: "rg \"TODO\" .", label: "Find by content", detail: "Search recursively with file and line context." },
      { command: "bat package.json", label: "Read comfortably", detail: "Syntax-aware output with paging on the real Mac." },
      {
        command: "jq '.tools[] | select(.category == \"search\") | .command' setup.json",
        label: "Query structured data",
        detail: "Filter the workstation manifest down to search tools.",
      },
    ],
    fieldNotes: [
      "Prefer `rg` over `grep -R` and `fd` over a long `find` expression for daily work.",
      "Add `--hidden` deliberately; good defaults avoid noisy `.git` and dependency trees.",
      shortcut("Control-/"),
    ],
  },
  {
    id: "git",
    number: "04",
    kicker: "Work in small checkpoints",
    title: "Make Git feel conversational",
    summary:
      "Inspect first, stage intentionally, commit one idea, and let `gh` handle the GitHub-shaped part of the workflow.",
    outcome: "You can understand local changes and orient a GitHub task without leaving the terminal.",
    level: gitPath.level,
    minutes: gitPath.minutes,
    manifestPathId: gitPath.id,
    commands: [
      { command: "gs", label: "What changed?", detail: `${gsAlias.name} expands to \`${gsAlias.expandsTo}\`.` },
      { command: "gd", label: "Read the patch", detail: `${gdAlias.name} expands to \`${gdAlias.expandsTo}\`.` },
      { command: "gl", label: "Recent story", detail: `${glAlias.name} expands to \`${glAlias.expandsTo}\`.` },
      { command: "lg", label: "Open the Git cockpit", detail: `${lazygitAlias.name} opens ${lazygitAlias.expandsTo}; Practice shows the model without taking over the browser.` },
      { command: "gh auth status", label: "GitHub readiness", detail: "Check whether the CLI is authenticated." },
    ],
    fieldNotes: [
      `Your shortcuts come from the manifest: \`${gsAlias.name}\`, \`${gdAlias.name}\`, and \`${glAlias.name}\`.`,
      "Do not put identity or tokens in the shared repo: `.gitconfig.local` stays mode 600 and untracked.",
    ],
  },
  {
    id: "runtimes",
    number: "05",
    kicker: "Projects choose versions",
    title: "Keep runtimes boring",
    summary:
      "mise pins language versions, pnpm handles JavaScript workspaces, and uv handles Python projects. The goal is repeatability, not version trivia.",
    outcome: "You can tell which runtime a project is using and invoke its package manager confidently.",
    level: runtimePath.level,
    minutes: runtimePath.minutes,
    manifestPathId: runtimePath.id,
    commands: [
      { command: "mise current", label: "Show active runtimes", detail: "Read the versions selected for this directory." },
      { command: "mise doctor", label: "Explain selection", detail: "Check mise configuration, shims, and runtime resolution." },
      { command: "node --version", label: "Verify Node", detail: `Currently pinned to Node ${nodeVersion}.` },
      { command: "pnpm --version", label: "Verify pnpm", detail: `Currently pinned to pnpm ${pnpmVersion}.` },
      { command: "python3 --version && uv --version", label: "Verify Python", detail: `Python ${pythonVersion} with uv ${uvVersion}.` },
      { command: "uv init scratch-python", label: "Create an isolated project", detail: "Practice creates this only in memory; use the same command in a real project directory when ready.", mode: "practice" },
    ],
    fieldNotes: [
      `The dotfiles pin exact versions after a ${setupManifest.releasePolicy.minimumRuntimeReleaseAge} release-age gate.`,
      "Use `mise x -- command` when you want an explicit project runtime without mutating global PATH.",
    ],
  },
  {
    id: "agents",
    number: "06",
    kicker: "Keep agents contained",
    title: "Run Herdr, OMP, and Codex with control",
    summary:
      `Ghostty hosts zsh; Herdr adds persistent panes; OMP and Codex run inside them. OMP ${approvalModeTitle} mode auto-approves reads and workspace edits while Codex auto-reviews eligible prompts; both retain their configured boundaries.`,
    outcome: "You can start, detach, resume, and verify both agent configurations without nesting multiplexers.",
    level: agentPath.level,
    minutes: agentPath.minutes,
    manifestPathId: agentPath.id,
    commands: [
      { command: "herdr --version", label: "Check Herdr", detail: `The installed workspace manager is ${herdrVersion}.` },
      { command: "herdr", label: "Enter your persistent workspace", detail: "Live only: open Herdr, use Control-B then ?, and detach with Control-B then Q.", mode: "live" },
      { command: "omp --version", label: "Check OMP", detail: `The installed coding agent is ${ompVersion}.` },
      { command: `omp --approval-mode ${setupSafety.approvalMode}`, label: "Start OMP with the declared boundary", detail: "Live only: launch a real agent session; exit it before continuing the lesson.", mode: "live" },
      { command: "codex --version", label: "Check Codex", detail: `The installed Codex CLI is ${codexVersion}.` },
      { command: "codex", label: "Start Codex", detail: "Live only: launch Codex inside a Herdr pane when you want the session to persist.", mode: "live" },
      {
        command: "omp config get tools.approvalMode",
        label: "Verify approvals",
        detail: `Must print \`${setupSafety.approvalMode}\`. \`--auto-approve\` is the broader \`yolo\` mode.`,
      },
      {
        command: "omp config get secrets.enabled",
        label: "Verify secret masking",
        detail: "Must print `true`.",
      },
    ],
    fieldNotes: [
      shortcut("Control-B, then ?"),
      shortcut("Control-B, then Q"),
      `Use \`omp --approval-mode ${setupSafety.approvalMode}\` for the same one-session behavior; reserve \`--auto-approve\` for deliberately trusted automation.`,
      "Codex uses `on-request` with `auto_review`: eligible prompts are reviewed for you without globally disabling the sandbox.",
      "Do not stack tmux or zellij around Herdr. One multiplexer is enough.",
    ],
  },
  {
    id: "maintenance",
    number: "07",
    kicker: "Own the machine",
    title: "Diagnose before you repair",
    summary:
      "Your dotfiles are an executable description of the workstation. `dev-doctor` finds drift; `dev-update` changes the declared toolchain for review.",
    outcome: "You can validate the setup, update it deliberately, and rebuild another Mac safely.",
    level: maintenancePath.level,
    minutes: maintenancePath.minutes,
    manifestPathId: maintenancePath.id,
    commands: [
      { command: "dev-doctor", label: "Run the doctor", detail: "Assert links, tools, runtimes, config, and safe permissions." },
      { command: previewWorkflow.command, label: previewWorkflow.title, detail: previewWorkflow.purpose },
      { command: checkWorkflow.command, label: checkWorkflow.title, detail: checkWorkflow.purpose },
      { command: "git status --short", label: "Review generated pins", detail: "Updates become visible repo changes on purpose." },
      { command: "gitleaks detect --redact", label: "Scan before sharing", detail: "Catch credential-shaped content before a commit." },
    ],
    fieldNotes: [
      "The bootstrap uses an explicit allowlist and backs up conflicts; it never adopts your whole home directory.",
      `The normal \`${reconcileWorkflow.command}\` workflow ${reconcileWorkflow.purpose.toLowerCase()}.`,
      `Run \`${updateWorkflow.command}\` when you have time to review and test—not automatically on shell startup. It ${updateWorkflow.purpose.toLowerCase()}.`,
    ],
  },
  {
    id: "real-work",
    number: "08",
    kicker: "Transfer the skill",
    title: "Practice on a real project, safely",
    summary:
      "Connect a project folder read-only to explore real filenames in the simulated shell. Use Live Mac only when you intentionally need the actual machine.",
    outcome: "You can choose the least-powerful mode that still teaches or completes the task.",
    level: "intermediate",
    minutes: 10,
    commands: [
      { command: "tree /workspace", label: "Map the project", detail: "Available after a read-only folder is connected.", mode: "practice" },
      { command: "rg \"TODO\" /workspace", label: "Find unfinished work", detail: "Search the in-memory copy of selected text files.", mode: "practice" },
      { command: "git status --short", label: "Orient before editing", detail: "In Live Mac, this reflects the real working tree." },
      { command: "dev-doctor", label: "Close with confidence", detail: "Return to a known-good workstation state." },
    ],
    fieldNotes: [
      "Folder mode reads only files you choose, excludes secrets, and mounts sanitized text under `/workspace`.",
      "The browser works from a snapshot. Use Refresh snapshot after the project changes on disk.",
      "Live Mac is full shell access. It is loopback-only, one-session, short-ticketed, and always requires explicit opt-in.",
    ],
  },
  {
    id: "quality-loop",
    number: "09",
    kicker: "Shorten the feedback loop",
    title: "Edit, inspect, and check before you wait",
    summary:
      "Your editor and quality tools are deliberately small: open the right file, search structure, load project environment explicitly, and catch shell or secret mistakes early.",
    outcome: "You can move from a finding to a safe local check without leaving the terminal.",
    level: "intermediate",
    minutes: 10,
    commands: [
      { command: "e README.md", label: "Open the editor", detail: `${editorAlias.name} expands to \`${editorAlias.expandsTo}\`; Practice shows a safe preview instead of opening full-screen Neovim.`, mode: "practice" },
      { command: "sg run -p 'export const $A = $B' .", label: "Search structure", detail: "Use ast-grep to find exported constants by syntax rather than text alone.", mode: "practice" },
      { command: "direnv status", label: "Inspect project environment", detail: "Confirm what a directory would load before approving its .envrc." },
      { command: "shellcheck scripts/check-links", label: "Lint shell code", detail: "Catch quoting, portability, and control-flow mistakes." },
      { command: "gitleaks detect --redact", label: "Scan before Git", detail: "Check credential-shaped content without printing a detected value." },
    ],
    fieldNotes: [
      "Use `rg` for text and `sg` for syntax-aware patterns. Start with the simpler tool.",
      "Never approve a new `.envrc` before reading it; direnv is explicit by design.",
      `Declared aliases: ${setupManifest.aliases.map((alias) => `\`${alias.name}\` → \`${alias.expandsTo}\``).join("; ")}.`,
      "In Live Mac, editor and Git UI aliases open interactive full-screen tools. Exit them before continuing a browser lesson.",
    ],
  },
  {
    id: "checkpoint-lab",
    number: "10",
    kicker: "Ship one coherent idea",
    title: "Practice the branch-to-PR rhythm",
    summary:
      "This in-memory lab rehearses the whole checkpoint: create a focused branch, stage one file, write an intentional commit, and prepare a draft pull request.",
    outcome: "You can narrate and perform the small Git loop that keeps real work reviewable.",
    level: "intermediate",
    minutes: 12,
    commands: [
      { command: "git switch -c lesson/terminal-trick", label: "Name the idea", detail: "Create a focused practice branch.", mode: "practice" },
      { command: "git add notes/terminal-tricks.md", label: "Stage intentionally", detail: "Select the one file that belongs to this checkpoint.", mode: "practice" },
      { command: "git commit -m \"Document terminal trick\"", label: "Record the why", detail: "Write a concise imperative commit message.", mode: "practice" },
      { command: "gh pr create --draft --fill", label: "Prepare review", detail: "Practice models the GitHub operation without contacting GitHub.", mode: "practice" },
      { command: "gh repo view benjaminsehl/dotfiles", label: "Verify the real remote", detail: "Live only: read the published repository without changing it.", mode: "live" },
    ],
    fieldNotes: [
      "A commit should contain one explainable idea, not every nearby edit.",
      "Use a draft PR early when feedback would change direction; make it ready only when the checks and story are coherent.",
      "Practice mode maintains a disposable Git model. Reloading returns it to the original state.",
    ],
  },
];

export function commandMatches(
  command: string,
  lessonCommand: LessonCommand,
  mode?: "practice" | "live",
): boolean {
  const requiredMode = lessonCommand.mode ?? "either";
  if (mode && requiredMode !== "either" && requiredMode !== mode) return false;
  const normalized = command.trim().replace(/\s+/g, " ");
  const expected = lessonCommand.command.trim().replace(/\s+/g, " ");
  return normalized === expected;
}
