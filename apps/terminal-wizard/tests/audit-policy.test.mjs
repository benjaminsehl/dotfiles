import assert from "node:assert/strict";
import test from "node:test";
import {
  CLEAN_LIFECYCLE_POLICY_TEXT,
  assertCleanLifecyclePolicy,
} from "../scripts/audit.mjs";

test("accepts npm 11.16's exact clean lifecycle-policy text", () => {
  assert.doesNotThrow(() => {
    assertCleanLifecyclePolicy(`${CLEAN_LIFECYCLE_POLICY_TEXT}\n`);
  });
});

test("accepts npm's clean JSON lifecycle-policy report", () => {
  assert.doesNotThrow(() => {
    assertCleanLifecyclePolicy('{"allowScripts":[]}');
  });
});

test("rejects pending lifecycle scripts", () => {
  assert.throws(
    () => assertCleanLifecyclePolicy('{"allowScripts":["unreviewed-package@1.0.0"]}'),
    /explicitly approved or denied/,
  );
});

test("rejects malformed, ambiguous, and error-shaped reports", () => {
  for (const output of [
    "",
    `${CLEAN_LIFECYCLE_POLICY_TEXT} Maybe.`,
    "not json",
    "{}",
    '{"allowScripts":[],"error":"registry unavailable"}',
    '{"error":"registry unavailable"}',
  ]) {
    assert.throws(() => assertCleanLifecyclePolicy(output));
  }
});
