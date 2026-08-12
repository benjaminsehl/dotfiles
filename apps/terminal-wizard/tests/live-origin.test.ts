import assert from "node:assert/strict";
import test from "node:test";
import { supportsLiveMac } from "../app/lib/live-origin.ts";

test("enables Live Mac only for the fixed local application origin", () => {
  assert.equal(supportsLiveMac("http://127.0.0.1:4317"), true);
  assert.equal(supportsLiveMac("https://127.0.0.1:4317"), false);
  assert.equal(supportsLiveMac("http://localhost:4317"), false);
  assert.equal(supportsLiveMac("http://127.0.0.1:3000"), false);
  assert.equal(supportsLiveMac("https://terminal-tutor.vercel.app"), false);
});
