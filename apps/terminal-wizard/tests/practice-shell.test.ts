import assert from "node:assert/strict";
import test from "node:test";
import { defineCommand } from "just-bash";
import {
  PracticeShell,
  type PracticeCommandResult,
} from "../app/lib/practice-shell";

test("executes a submitted practice command exactly once and reports its result", async () => {
  const results: PracticeCommandResult[] = [];
  const output: string[] = [];
  let executions = 0;
  const shell = new PracticeShell({
    files: { "/practice/README.md": "safe\n" },
    cwd: "/practice",
    onCommandResult: (result) => results.push(result),
  });
  await shell.attach((data) => output.push(data));
  assert.ok(shell.bash);
  shell.bash.registerCommand(
    defineCommand("count-once", async () => {
      executions += 1;
      return { stdout: "one execution\n", stderr: "", exitCode: 0 };
    }),
  );

  await shell.handleInput("count-once\r");

  assert.equal(executions, 1);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    command: "count-once",
    stdout: "one execution\n",
    stderr: "",
    exitCode: 0,
    cwdBefore: "/practice",
    cwdAfter: "/practice",
    lessonId: null,
  });
  assert.match(output.join(""), /one execution/);
});

test("uses just-bash PWD and exposes failures for progress decisions", async () => {
  const results: PracticeCommandResult[] = [];
  const shell = new PracticeShell({
    files: { "/practice/docs/README.md": "safe\n" },
    cwd: "/practice",
    onCommandResult: (result) => results.push(result),
  });
  await shell.attach(() => undefined);

  await shell.handleInput("cd docs && pwd\r");
  await shell.handleInput("false\r");

  assert.equal(shell.cwd, "/practice/docs");
  assert.equal(results[0]?.command, "cd docs && pwd");
  assert.equal(results[0]?.exitCode, 0);
  assert.equal(results[0]?.cwdBefore, "/practice");
  assert.equal(results[0]?.cwdAfter, "/practice/docs");
  assert.equal(results[1]?.command, "false");
  assert.notEqual(results[1]?.exitCode, 0);
  assert.equal(results[1]?.cwdBefore, "/practice/docs");
  assert.equal(results[1]?.cwdAfter, "/practice/docs");
});

test("binds an in-flight result to the lesson active at submission", async () => {
  const results: PracticeCommandResult[] = [];
  let activeLesson = "orientation";
  let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const shell = new PracticeShell({
    cwd: "/practice",
    getLessonId: () => activeLesson,
    onCommandResult: (result) => results.push(result),
  });
  await shell.attach(() => undefined);
  assert.ok(shell.bash);
  shell.bash.registerCommand(
    defineCommand("finish-later", async () => {
      markStarted();
      await blocked;
      return { stdout: "done\n", stderr: "", exitCode: 0 };
    }),
  );

  const execution = shell.handleInput("finish-later\r");
  await started;
  activeLesson = "navigation";
  release();
  await execution;

  assert.equal(results[0]?.lessonId, "orientation");
});

test("reports the line produced by cursor editing, history, and continuation", async () => {
  const results: PracticeCommandResult[] = [];
  const shell = new PracticeShell({
    cwd: "/practice",
    onCommandResult: (result) => results.push(result),
  });
  await shell.attach(() => undefined);

  await shell.handleInput("echo ac");
  await shell.handleInput("\x1b[D");
  await shell.handleInput("b\r");
  await shell.handleInput("\x1b[A");
  await shell.handleInput("\r");
  await shell.handleInput("echo one \\\r");
  await shell.handleInput("two\r");

  assert.equal(results[0]?.command, "echo abc");
  assert.equal(results[1]?.command, "echo abc");
  assert.equal(results[2]?.command, "echo one \\\ntwo");
});

test("persists exported and unset environment variables across commands", async () => {
  const results: PracticeCommandResult[] = [];
  const shell = new PracticeShell({
    cwd: "/practice",
    onCommandResult: (result) => results.push(result),
  });
  await shell.attach(() => undefined);

  await shell.handleInput("export TW=ready\r");
  await shell.handleInput("printf '%s\\n' \"$TW\"\r");
  await shell.handleInput("unset TW\r");
  await shell.handleInput("printf '%s\\n' \"${TW-unset}\"\r");

  assert.equal(results[1]?.stdout, "ready\n");
  assert.equal(results[3]?.stdout, "unset\n");
});

test("edits and pastes Unicode without recursion or broken surrogate pairs", async () => {
  const results: PracticeCommandResult[] = [];
  const shell = new PracticeShell({
    cwd: "/practice",
    onCommandResult: (result) => results.push(result),
  });
  await shell.attach(() => undefined);

  await shell.handleInput("echo 😊x");
  await shell.handleInput("\x1b[D");
  await shell.handleInput("\x7f");
  await shell.handleInput("\r");
  await shell.handleInput("echo one 😊\necho two\n");

  assert.equal(results[0]?.command, "echo x");
  assert.equal(results[0]?.command.includes("\uFFFD"), false);
  assert.equal(results[1]?.command, "echo one 😊");
  assert.equal(results[2]?.command, "echo two");
});

test("handles common terminal escape sequences without inserting wrapper bytes", async () => {
  const results: PracticeCommandResult[] = [];
  const shell = new PracticeShell({
    cwd: "/practice",
    onCommandResult: (result) => results.push(result),
  });
  await shell.attach(() => undefined);

  await shell.handleInput("echo abc");
  await shell.handleInput("\x1b[H");
  await shell.handleInput("\x1b[3~");
  await shell.handleInput("e");
  await shell.handleInput("\x1b[F");
  await shell.handleInput("\r");
  await shell.handleInput("\x1b[200~");
  await shell.handleInput("echo safe");
  await shell.handleInput("\x1b[201~");
  await shell.handleInput("\r");
  await shell.handleInput("echo ok");
  await shell.handleInput("\x1b[99~");
  await shell.handleInput("\r");

  assert.equal(results[0]?.command, "echo abc");
  assert.equal(results[1]?.command, "echo safe");
  assert.equal(results[2]?.command, "echo ok");
});
