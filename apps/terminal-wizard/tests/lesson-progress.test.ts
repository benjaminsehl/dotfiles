import assert from "node:assert/strict";
import test from "node:test";
import { lessons } from "../app/data/lessons";
import {
  isLessonComplete,
  recordLessonResult,
} from "../app/lib/lesson-progress";

test("credits only a successful command in the selected lesson", () => {
  const maintenance = lessons.find((lesson) => lesson.id === "maintenance");
  const realWork = lessons.find((lesson) => lesson.id === "real-work");
  assert.ok(maintenance);
  assert.ok(realWork);

  const progress = recordLessonResult({}, maintenance, {
    lessonId: maintenance.id,
    command: "dev-doctor",
    mode: "practice",
    status: "succeeded",
    exitCode: 0,
  });
  const doctorStep = maintenance.commands.find((command) => command.command === "dev-doctor");
  assert.ok(doctorStep);
  assert.equal(progress[realWork.id], undefined, "duplicate commands must not credit hidden lessons");
  assert.deepEqual(progress, { maintenance: [doctorStep.id] });

  const unchanged = recordLessonResult(progress, maintenance, {
    lessonId: maintenance.id,
    command: "apply --check",
    mode: "practice",
    status: "failed",
    exitCode: 1,
  });
  assert.equal(unchanged, progress);
});

test("does not mistake an unverified Live submission for successful practice", () => {
  const agents = lessons.find((lesson) => lesson.id === "agents");
  assert.ok(agents);

  const genericSubmission = recordLessonResult({}, agents, {
    lessonId: agents.id,
    command: "herdr --version",
    mode: "live",
    status: "submitted",
  });
  assert.deepEqual(genericSubmission, {});

  const interactiveSubmission = recordLessonResult({}, agents, {
    lessonId: agents.id,
    command: "herdr",
    mode: "live",
    status: "submitted",
  });
  assert.deepEqual(interactiveSubmission, {});
});

test("completion requires every stable core step id", () => {
  const orientation = lessons.find((lesson) => lesson.id === "orientation");
  assert.ok(orientation);
  const requiredIds = orientation.commands
    .filter((command) => command.required !== false)
    .map((command) => command.id);
  assert.equal(isLessonComplete({ orientation: requiredIds.slice(0, -1) }, orientation), false);
  assert.equal(isLessonComplete({ orientation: requiredIds }, orientation), true);
});
