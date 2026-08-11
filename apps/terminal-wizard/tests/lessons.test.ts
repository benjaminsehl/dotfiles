import assert from "node:assert/strict";
import test from "node:test";
import { commandMatches, lessons } from "../app/data/lessons";

test("lesson credit requires the exact normalized command", () => {
  const pwd = lessons.flatMap((lesson) => lesson.commands).find((command) => command.command === "pwd");
  assert.ok(pwd);
  assert.equal(commandMatches("pwd", pwd), true);
  assert.equal(commandMatches("  pwd  ", pwd), true);
  assert.equal(commandMatches("echo pwd", pwd), false);
  assert.equal(commandMatches("pwd && false", pwd), false);
  assert.equal(commandMatches("sudo pwd", pwd), false);
});

test("lesson credit respects Practice and Live mode boundaries", () => {
  const commands = lessons.flatMap((lesson) => lesson.commands);
  const liveOnly = commands.find((command) => command.command === "herdr");
  const practiceOnly = commands.find((command) => command.command === "uv init scratch-python");
  assert.ok(liveOnly);
  assert.ok(practiceOnly);
  assert.equal(commandMatches("herdr", liveOnly, "practice"), false);
  assert.equal(commandMatches("herdr", liveOnly, "live"), true);
  assert.equal(commandMatches("uv init scratch-python", practiceOnly, "live"), false);
  assert.equal(commandMatches("uv init scratch-python", practiceOnly, "practice"), true);
});

test("every lesson has unique commands so progress indices are unambiguous", () => {
  for (const lesson of lessons) {
    const commands = lesson.commands.map((command) => command.command.trim().replace(/\s+/g, " "));
    assert.equal(new Set(commands).size, commands.length, lesson.id);
  }
});
