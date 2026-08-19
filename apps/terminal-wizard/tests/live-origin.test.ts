import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_LIVE_MAC_ORIGIN,
  supportsLiveMac,
} from "../app/lib/live-origin.ts";

test("enables Live Mac only on the exact fixed local origin", () => {
  assert.equal(LOCAL_LIVE_MAC_ORIGIN, "http://127.0.0.1:4317");
  assert.equal(supportsLiveMac(LOCAL_LIVE_MAC_ORIGIN), true);
  assert.equal(supportsLiveMac("https://127.0.0.1:4317"), false);
  assert.equal(supportsLiveMac("http://localhost:4317"), false);
  assert.equal(supportsLiveMac("http://127.0.0.1:3000"), false);
  assert.equal(supportsLiveMac("http://127.0.0.1:4317.evil.example"), false);
  assert.equal(supportsLiveMac("https://terminal-tutor.example"), false);
});
