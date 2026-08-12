import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeLiveMacAccess,
  HOSTED_LIVE_MAC_ORIGIN,
  parseHostedPairing,
  resolveLiveMacAccess,
  supportsLiveMac,
} from "../app/lib/live-origin.ts";

const instanceId = "A".repeat(22);
const pairingSecret = "b".repeat(43);
const validHash = `#pair=v1.${instanceId}.${pairingSecret}`;

test("accepts only the fixed local origin or an exactly paired production origin", () => {
  assert.equal(supportsLiveMac("http://127.0.0.1:4317"), true);
  assert.equal(supportsLiveMac(HOSTED_LIVE_MAC_ORIGIN), false);
  assert.equal(supportsLiveMac(HOSTED_LIVE_MAC_ORIGIN, validHash), true);
  assert.equal(supportsLiveMac("https://terminal-tutor-three-git-main.vercel.app", validHash), false);
  assert.equal(supportsLiveMac("https://terminal-tutor-three.vercel.app.evil.example", validHash), false);
  assert.equal(supportsLiveMac("https://127.0.0.1:4317"), false);
  assert.equal(supportsLiveMac("http://localhost:4317"), false);
  assert.equal(supportsLiveMac("http://127.0.0.1:3000"), false);
});

test("parses one exact versioned capability and rejects ambiguous fragments", () => {
  assert.deepEqual(parseHostedPairing(validHash), {
    version: 1,
    instanceId,
    pairingSecret,
  });
  for (const hash of [
    "",
    "#pair=",
    `#pair=${instanceId}.${pairingSecret}`,
    `#pair=v2.${instanceId}.${pairingSecret}`,
    `#pair=v1.${instanceId.slice(1)}.${pairingSecret}`,
    `#pair=v1.${instanceId}.${pairingSecret.slice(1)}`,
    `#pair=v1.${instanceId}.${pairingSecret}.extra`,
    `#pair=v1.${instanceId}.${pairingSecret}&extra=1`,
    `#other=1&pair=v1.${instanceId}.${pairingSecret}`,
  ]) {
    assert.equal(parseHostedPairing(hash), null, hash);
  }
});

test("scrubs pairing material from browser history while keeping it only in memory", () => {
  const replacements: unknown[][] = [];
  const access = consumeLiveMacAccess(
    {
      origin: HOSTED_LIVE_MAC_ORIGIN,
      hash: validHash,
      pathname: "/course",
      search: "?lesson=1",
    },
    {
      state: { safe: true },
      replaceState(...args: unknown[]) {
        replacements.push(args);
      },
    },
  );
  assert.deepEqual(access, {
    kind: "hosted",
    pairing: { version: 1, instanceId, pairingSecret },
  });
  assert.deepEqual(replacements, [[{ safe: true }, "", "/course?lesson=1"]]);

  assert.deepEqual(resolveLiveMacAccess(HOSTED_LIVE_MAC_ORIGIN), {
    kind: "hosted-unpaired",
    pairing: null,
  });
});

test("scrubs malformed pairing material without enabling Live Mac", () => {
  let replacement = "";
  const access = consumeLiveMacAccess(
    {
      origin: HOSTED_LIVE_MAC_ORIGIN,
      hash: "#pair=malformed",
      pathname: "/",
      search: "",
    },
    {
      state: null,
      replaceState(_state, _unused, url) {
        replacement = String(url);
      },
    },
  );
  assert.deepEqual(access, { kind: "hosted-unpaired", pairing: null });
  assert.equal(replacement, "/");
});
