import assert from "node:assert/strict";
import test from "node:test";
import { lessons } from "../app/data/lessons";
import {
  basePracticeFiles,
  PRACTICE_ROOT,
  registerPracticeCommands,
} from "../app/lib/practice";
import {
  PracticeShell,
  type PracticeCommandResult,
} from "../app/lib/practice-shell";

const practiceRoot = PRACTICE_ROOT;
const practiceEnvironment = {
  HOME: "/home/benjamin",
  SHELL: "/bin/zsh",
  PATH: "/usr/local/bin:/usr/bin:/bin",
  TERM: "xterm-ghostty",
  TERM_PROGRAM: "ghostty",
};

async function createPracticeShell(
  extraFiles: Record<string, string> = {},
  onCommandResult?: (result: PracticeCommandResult) => void,
): Promise<PracticeShell> {
  const shell = new PracticeShell({
    files: { ...basePracticeFiles, ...extraFiles },
    cwd: practiceRoot,
    env: practiceEnvironment,
    onCommandResult,
  });
  await shell.attach(() => undefined);
  registerPracticeCommands(shell);
  assert.ok(shell.bash, "practice shell should initialize just-bash");
  return shell;
}

const expectedLessonOutput = new Map<string, RegExp>([
  ["pwd", /Sites\/dotfiles/],
  ["echo $SHELL", /\/bin\/zsh/],
  ["echo $PATH | tr ':' '\\n'", /\/usr\/local\/bin\n\/usr\/bin/],
  ["which gh", /\/gh/],
  ["la", /README\.md/],
  ["bat README.md", /# Benjamin's dotfiles/],
  ["eza --tree --level=2", /docs\/shortcuts\.md/],
  ["ls -la", /README\.md/],
  ["cd docs && pwd", /dotfiles\/docs/],
  ["cd .. && pwd", /Sites\/dotfiles/],
  ["z dotfiles", /zoxide would jump/],
  ["fd -e md", /README\.md/],
  ["rg \"TODO\" .", /docs\/TODO\.md:\d+:/],
  ["bat apps/terminal-wizard/package.json", /"name": "terminal-tutor"/],
  ["jq '.tools[] | select(.category == \"search\") | .command' manifest/setup.json", /"rg"/],
  ["gs", /WizardTerminal\.tsx/],
  ["gd", /simulated practice change/],
  ["gl", /HEAD -> main/],
  ["lg", /Practice lazygit view/],
  ["gh auth status", /Practice identity ready/],
  ["mise current", /node\s+\d+/],
  ["mise doctor", /shims active/],
  ["node --version", /^v\d+/],
  ["pnpm --version", /^\d+/],
  ["python3 --version && uv --version", /Python \d+[\s\S]+uv \d+/],
  ["uv init scratch-python", /Initialized project 'scratch-python'/],
  ["herdr --version", /herdr \d+/],
  ["omp --version", /^\d+/],
  ["codex --version", /codex-cli \d+/],
  ["omp config get tools.approvalMode", /^write\s*$/],
  ["omp config get secrets.enabled", /^true\s*$/],
  ["dev-doctor", /not a live health result/],
  ["apply --dry-run", /Dry run: dotfile links already match/],
  ["apply --check", /apply is simulated/],
  ["git status --short", /WizardTerminal\.tsx/],
  ["gitleaks detect --redact", /no leaks found/],
  ["tree /workspace", /lesson\.ts/],
  ["rg \"TODO\" /workspace", /lesson\.ts:\d+:.*TODO/],
  ["e README.md", /Practice editor preview/],
  ["sg run -p 'export const $A = $B' apps/terminal-wizard/app", /apps\/terminal-wizard\/app\/example\.ts:1:export const ready/],
  ["direnv status", /No \.envrc is loaded/],
  ["shellcheck scripts/check-links", /No ShellCheck findings/],
  ["git switch -c lesson/terminal-trick", /Switched to a new branch/],
  ["git add notes/terminal-tricks.md", /Staged notes\/terminal-tricks\.md/],
  ["git commit -m \"Document terminal trick\"", /Document terminal trick/],
  ["gh pr create --draft --fill", /Practice draft ready/],
]);

test("every Practice-capable lesson command succeeds with meaningful model output", async (t) => {
  const shell = await createPracticeShell({
    "/workspace/README.md": "# Example project\n",
    "/workspace/src/lesson.ts": "// TODO: practice a safe search\nexport const ready = true;\n",
  });
  const bash = shell.bash;
  assert.ok(bash);

  const advertisedCommands = lessons.flatMap((lesson) =>
    lesson.commands
      .filter((item) => item.mode !== "live")
      .map(({ command }) => ({ lessonId: lesson.id, command })),
  );
  assert.deepEqual(
    [...new Set(advertisedCommands.map(({ command }) => command))].sort(),
    [...expectedLessonOutput.keys()].sort(),
    "new lesson commands need an explicit meaningful-output assertion",
  );

  for (const { lessonId, command } of advertisedCommands) {
    await t.test(`${lessonId}: ${command}`, async () => {
      const cwd = command === "cd .. && pwd" ? `${practiceRoot}/docs` : practiceRoot;
      const result = await bash.exec(command, { cwd });
      const output = `${result.stdout}${result.stderr}`;
      assert.equal(result.exitCode, 0, `${command}\n${output}`);
      assert.ok(output.trim().length >= 3, `${command} should teach something, not return empty output`);
      assert.match(output, expectedLessonOutput.get(command) as RegExp);
      if (command.startsWith("eza ")) assert.doesNotMatch(output, /^\/bin/m);
    });
  }
});

test("the required course succeeds sequentially through the actual session adapter", async () => {
  const results: PracticeCommandResult[] = [];
  const shell = await createPracticeShell(
    {
      "/workspace/README.md": "# Example project\n",
      "/workspace/src/lesson.ts": "// TODO: practice a safe search\nexport const ready = true;\n",
    },
    (result) => results.push(result),
  );
  const commands = lessons.flatMap((lesson) =>
    lesson.commands.filter((command) => command.required !== false && command.mode !== "live"),
  );

  for (const command of commands) {
    const previousCount = results.length;
    await shell.handleInput(`${command.command}\r`);
    const result = results.at(-1);
    assert.equal(results.length, previousCount + 1, command.command);
    assert.equal(result?.command, command.command);
    assert.equal(result?.exitCode, 0, `${command.command}\n${result?.stderr ?? ""}`);
    if (command.command === "cd .. && pwd") assert.equal(result.cwdAfter, practiceRoot);
  }

  assert.equal(shell.cwd, practiceRoot);
});

test("workspace lessons fail honestly until a folder is connected", async () => {
  const shell = await createPracticeShell();
  const bash = shell.bash;
  assert.ok(bash);

  for (const command of ["tree /workspace", 'rg "TODO" /workspace']) {
    const result = await bash.exec(command, { cwd: practiceRoot });
    assert.notEqual(result.exitCode, 0, command);
    assert.match(`${result.stdout}${result.stderr}`, /No read-only folder is connected/);
  }
});

test("connected-folder lesson commands inspect the mounted read-only snapshot", async () => {
  const shell = await createPracticeShell({
    "/workspace/README.md": "# Example project\n",
    "/workspace/src/lesson.ts": "// TODO: practice a safe search\nexport const ready = true;\n",
  });
  const bash = shell.bash;
  assert.ok(bash);

  const cases = [
    { command: "tree /workspace", expected: /lesson\.ts/ },
    { command: 'rg "TODO" /workspace', expected: /lesson\.ts:\d+:.*TODO/ },
  ];
  for (const { command, expected } of cases) {
    const result = await bash.exec(command, { cwd: practiceRoot });
    assert.equal(result.exitCode, 0, `${command}\n${result.stderr}`);
    assert.match(result.stdout, expected);
    assert.doesNotMatch(result.stdout, /No read-only folder is connected/);
  }
});

test("practice execution covers pipelines, chains, shortcut aliases, and safe custom commands", async (t) => {
  const shell = await createPracticeShell();
  const bash = shell.bash;
  assert.ok(bash);

  const cases = [
    {
      behavior: "pipeline",
      command: "echo $PATH | tr ':' '\\n'",
      expected: /\/usr\/local\/bin\n\/usr\/bin/,
    },
    {
      behavior: "successful chain",
      command: "cd docs && pwd",
      expected: /dotfiles\/docs/,
    },
    { behavior: "gs shortcut alias", command: "gs", expected: /WizardTerminal\.tsx/ },
    { behavior: "gd shortcut alias", command: "gd", expected: /simulated practice change/ },
    { behavior: "gl shortcut alias", command: "gl", expected: /HEAD -> main/ },
    { behavior: "ll shortcut alias", command: "ll", expected: /README\.md/ },
    { behavior: "safe updater model", command: "dev-update", expected: /no packages changed/ },
    { behavior: "interactive fzf model", command: "fzf", expected: /interactive on the real Mac/ },
  ];

  for (const { behavior, command, expected } of cases) {
    await t.test(behavior, async () => {
      const result = await bash.exec(command, { cwd: practiceRoot });
      const output = `${result.stdout}${result.stderr}`;
      assert.equal(result.exitCode, 0, `${command}\n${output}`);
      assert.match(output, expected);
    });
  }
});
