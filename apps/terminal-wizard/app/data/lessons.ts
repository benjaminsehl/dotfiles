import {
  getSetupToolVersion,
  setupManifest,
  setupSafety,
} from "@/app/data/setup-manifest";

export type LessonCommand = {
  command: string;
  label: string;
  detail: string;
  match?: string;
};

export type Lesson = {
  id: string;
  number: string;
  kicker: string;
  title: string;
  summary: string;
  outcome: string;
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

export const lessons: Lesson[] = [
  {
    id: "orientation",
    number: "01",
    kicker: "Build a mental map",
    title: "Know what is actually running",
    summary:
      "Ghostty is the window, zsh interprets commands, Starship draws the prompt, Herdr keeps work alive, and OMP is the coding agent inside it.",
    outcome: "You can identify your shell, location, and command-resolution order without guessing.",
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
        match: "echo $PATH",
      },
      {
        command: "which gh",
        label: "Find a tool",
        detail: "Show the executable that wins on PATH.",
      },
    ],
    fieldNotes: [
      "Read the prompt left to right: folder, Git branch/state, then the ❯ input marker.",
      "When a command behaves strangely, `type -a command` is more revealing than reinstalling it.",
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
    commands: [
      { command: "eza --tree --level=2", label: "See the shape", detail: "A compact two-level project tree." },
      { command: "ls -la", label: "Reveal details", detail: "Include hidden files and permissions." },
      { command: "cd docs && pwd", label: "Move, then verify", detail: "Chain a successful move with an inspection." },
      { command: "z dotfiles", label: "Jump by memory", detail: "On your Mac, zoxide ranks folders you visit." },
    ],
    fieldNotes: [
      "Control-T inserts a fuzzy-found file; Option-C jumps to a fuzzy-found directory.",
      "Control-R searches command history. Start typing first to narrow Up/Down history search.",
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
    commands: [
      { command: "fd config", label: "Find by name", detail: "Search file and directory names with friendly defaults." },
      { command: "rg \"approvalMode\" .", label: "Find by content", detail: "Search recursively with file and line context." },
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
    commands: [
      { command: "git status --short", label: "What changed?", detail: "A compact working-tree summary." },
      { command: "git diff --stat", label: "How much changed?", detail: "See scope before reading the patch." },
      { command: "git log --oneline -5", label: "Recent story", detail: "Read the latest five checkpoints." },
      { command: "gh auth status", label: "GitHub readiness", detail: "Check whether the CLI is authenticated." },
    ],
    fieldNotes: [
      "Your shortcuts are `gs` (status), `gd` (diff), and `gl` (compact graph log).",
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
    commands: [
      { command: "mise current", label: "Show active runtimes", detail: "Read the versions selected for this directory." },
      { command: "node --version", label: "Verify Node", detail: `Currently pinned to Node ${nodeVersion}.` },
      { command: "pnpm --version", label: "Verify pnpm", detail: `Currently pinned to pnpm ${pnpmVersion}.` },
      { command: "python3 --version && uv --version", label: "Verify Python", detail: `Python ${pythonVersion} with uv ${uvVersion}.` },
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
    commands: [
      { command: "herdr --version", label: "Check Herdr", detail: `The installed workspace manager is ${herdrVersion}.` },
      { command: "omp --version", label: "Check OMP", detail: `The installed coding agent is ${ompVersion}.` },
      { command: "codex --version", label: "Check Codex", detail: `The installed Codex CLI is ${codexVersion}.` },
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
      "In Herdr: Control-B then ? opens help; Control-B then Q detaches while work continues.",
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
    commands: [
      { command: "dev-doctor", label: "Run the doctor", detail: "Assert links, tools, runtimes, config, and safe permissions." },
      { command: "apply --dry-run", label: "Preview reconciliation", detail: "See what the dotfiles would change before applying it." },
      { command: "git status --short", label: "Review generated pins", detail: "Updates become visible repo changes on purpose." },
      { command: "gitleaks detect --redact", label: "Scan before sharing", detail: "Catch credential-shaped content before a commit." },
    ],
    fieldNotes: [
      "The bootstrap uses an explicit allowlist and backs up conflicts; it never adopts your whole home directory.",
      "Run `dev-update` when you have time to review and test—not automatically on shell startup.",
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
    commands: [
      { command: "tree /workspace", label: "Map the project", detail: "Available after a read-only folder is connected." },
      { command: "rg \"TODO\" /workspace", label: "Find unfinished work", detail: "Search the in-memory copy of selected text files." },
      { command: "git status --short", label: "Orient before editing", detail: "In Live Mac, this reflects the real working tree." },
      { command: "dev-doctor", label: "Close with confidence", detail: "Return to a known-good workstation state." },
    ],
    fieldNotes: [
      "Folder mode reads only files you choose, excludes secrets, and mounts sanitized text under `/workspace`.",
      "Live Mac is full shell access. It is loopback-only, one-session, short-ticketed, and always requires explicit opt-in.",
    ],
  },
];

export function commandMatches(command: string, lessonCommand: LessonCommand): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  const expected = (lessonCommand.match ?? lessonCommand.command).trim().replace(/\s+/g, " ");
  return normalized === expected || normalized.startsWith(`${expected} `) || normalized.includes(expected);
}
