import assert from "node:assert/strict";
import test from "node:test";
import { BashShell } from "@wterm/just-bash";
import { lessons } from "../app/data/lessons";
import {
  basePracticeFiles,
  registerPracticeCommands,
} from "../app/lib/practice";

const practiceRoot = "/home/benjamin/Developer/terminal-wizard";
const practiceEnvironment = {
  HOME: "/home/benjamin",
  SHELL: "/bin/zsh",
  PATH: "/usr/local/bin:/usr/bin:/bin",
  TERM: "xterm-ghostty",
  TERM_PROGRAM: "ghostty",
};

async function createPracticeShell(extraFiles: Record<string, string> = {}): Promise<BashShell> {
  const shell = new BashShell({
    files: { ...basePracticeFiles, ...extraFiles },
    cwd: practiceRoot,
    env: practiceEnvironment,
  });
  await shell.attach(() => undefined);
  registerPracticeCommands(shell);
  assert.ok(shell.bash, "practice shell should initialize just-bash");
  return shell;
}

const expectedLessonOutput = new Map<string, RegExp>([
  ["pwd", /terminal-wizard/],
  ["echo $SHELL", /\/bin\/zsh/],
  ["echo $PATH | tr ':' '\\n'", /\/usr\/local\/bin\n\/usr\/bin/],
  ["which gh", /\/gh/],
  ["eza --tree --level=2", /docs\/shortcuts\.md/],
  ["ls -la", /README\.md/],
  ["cd docs && pwd", /terminal-wizard\/docs/],
  ["z dotfiles", /zoxide would jump/],
  ["fd config", /config\/omp\.yml/],
  ["rg \"approvalMode\" .", /config\/omp\.yml:\d+:\s+approvalMode: write/],
  ["bat package.json", /"name": "terminal-wizard"/],
  ["jq '.tools[] | select(.category == \"search\") | .command' setup.json", /"rg"/],
  ["git status --short", /WizardTerminal\.tsx/],
  ["git diff --stat", /1 file changed/],
  ["git log --oneline -5", /HEAD -> main/],
  ["gh auth status", /Practice identity ready/],
  ["mise current", /node\s+\d+/],
  ["node --version", /^v\d+/],
  ["pnpm --version", /^\d+/],
  ["python3 --version && uv --version", /Python \d+[\s\S]+uv \d+/],
  ["herdr --version", /herdr \d+/],
  ["omp --version", /^\d+/],
  ["codex --version", /codex-cli \d+/],
  ["omp config get tools.approvalMode", /^write\s*$/],
  ["omp config get secrets.enabled", /^true\s*$/],
  ["dev-doctor", /All promised checks pass/],
  ["apply --dry-run", /Dry run: dotfile links already match/],
  ["gitleaks detect --redact", /no leaks found/],
  ["tree /workspace", /No read-only folder is connected[\s\S]+Connect a folder/],
  ["rg \"TODO\" /workspace", /No read-only folder is connected[\s\S]+Connect a folder/],
]);

test("every advertised lesson command succeeds with meaningful practice output", async (t) => {
  const shell = await createPracticeShell();
  const bash = shell.bash;
  assert.ok(bash);

  const advertisedCommands = lessons.flatMap((lesson) =>
    lesson.commands.map(({ command }) => ({ lessonId: lesson.id, command })),
  );
  assert.deepEqual(
    [...new Set(advertisedCommands.map(({ command }) => command))].sort(),
    [...expectedLessonOutput.keys()].sort(),
    "new lesson commands need an explicit meaningful-output assertion",
  );

  for (const { lessonId, command } of advertisedCommands) {
    await t.test(`${lessonId}: ${command}`, async () => {
      const result = await bash.exec(command, { cwd: practiceRoot });
      const output = `${result.stdout}${result.stderr}`;
      assert.equal(result.exitCode, 0, `${command}\n${output}`);
      assert.ok(output.trim().length >= 3, `${command} should teach something, not return empty output`);
      assert.match(output, expectedLessonOutput.get(command) as RegExp);
      if (command.startsWith("eza ")) assert.doesNotMatch(output, /^\/bin/m);
    });
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
      expected: /terminal-wizard\/docs/,
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
