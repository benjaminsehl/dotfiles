import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_HEALTH_URL,
  LIVE_SESSION_URL,
  LiveTicketError,
  parseLiveServerMessage,
  requestLiveHealth,
  requestLiveTicket,
} from "../app/lib/live-session.ts";

const pairing = {
  version: 1 as const,
  instanceId: "A".repeat(22),
  pairingSecret: "b".repeat(43),
};
const ticket = `terminal-wizard.${"c".repeat(43)}.${"d".repeat(43)}`;

test("requests and validates the paired companion before spending the capability", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  await requestLiveHealth(
    pairing,
    new AbortController().signal,
    (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ ready: true, mode: "hosted", instanceId: pairing.instanceId }));
    }) as typeof fetch,
  );

  assert.equal(capturedUrl, LIVE_HEALTH_URL);
  assert.equal(capturedInit?.method, "GET");
  assert.equal(capturedInit?.credentials, "omit");
  assert.equal(capturedInit?.cache, "no-store");
  assert.equal(capturedInit?.redirect, "error");
  assert.equal(capturedInit?.referrerPolicy, "no-referrer");
  assert.equal(capturedInit?.targetAddressSpace, "loopback");
  assert.equal(capturedInit?.body, undefined);
});

test("rejects a health response from a different companion", async () => {
  await assert.rejects(
    requestLiveHealth(
      pairing,
      new AbortController().signal,
      (async () => new Response(JSON.stringify({
        ready: true,
        mode: "hosted",
        instanceId: "z".repeat(22),
      }))) as typeof fetch,
    ),
    /different Terminal Tutor companion/,
  );
});

test("requests a hosted ticket with an exact, credential-free loopback POST", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await requestLiveTicket(
    pairing,
    new AbortController().signal,
    (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ protocol: ticket, expiresInMs: 30_000 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  );

  assert.equal(result, ticket);
  assert.equal(capturedUrl, LIVE_SESSION_URL);
  assert.equal(capturedInit?.method, "POST");
  assert.deepEqual(capturedInit?.headers, { "Content-Type": "application/json" });
  assert.equal(capturedInit?.credentials, "omit");
  assert.equal(capturedInit?.cache, "no-store");
  assert.equal(capturedInit?.redirect, "error");
  assert.equal(capturedInit?.referrerPolicy, "no-referrer");
  assert.equal(capturedInit?.targetAddressSpace, "loopback");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), pairing);
});

test("keeps the fully local path compatible without a pairing body", async () => {
  let capturedInit: RequestInit | undefined;
  const result = await requestLiveTicket(
    null,
    new AbortController().signal,
    (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ protocol: ticket, expiresInMs: 30_000 }));
    }) as typeof fetch,
  );
  assert.equal(result, ticket);
  assert.equal(capturedInit?.method, "GET");
  assert.equal(capturedInit?.body, undefined);
  assert.equal(capturedInit?.headers, undefined);
});

test("fails closed on pairing, busy, unavailable, and malformed responses", async () => {
  const requestWith = (response: Response) => requestLiveTicket(
    pairing,
    new AbortController().signal,
    (async () => response) as typeof fetch,
  );
  await assert.rejects(requestWith(new Response("{}", { status: 410 })), /pairing expired/);
  await assert.rejects(requestWith(new Response("{}", { status: 409 })), /already in use/);
  await assert.rejects(requestWith(new Response("{}", { status: 500 })), /companion is unavailable/);
  await assert.rejects(
    requestWith(new Response(JSON.stringify({ protocol: "terminal-wizard.bad", expiresInMs: 30_000 }))),
    /invalid session ticket/,
  );
  await assert.rejects(
    requestWith(new Response(JSON.stringify({ protocol: ticket, expiresInMs: 1 }))),
    /invalid session ticket/,
  );

  await assert.rejects(
    requestWith(new Response("{}", { status: 410 })),
    (error: unknown) => error instanceof LiveTicketError && error.pairingFinal,
  );
  await assert.rejects(
    requestWith(new Response("{}", { status: 500 })),
    (error: unknown) => error instanceof LiveTicketError && !error.pairingFinal,
  );
});

test("validates bounded server frames before terminal rendering", () => {
  assert.deepEqual(parseLiveServerMessage('{"type":"ready"}'), { type: "ready" });
  assert.deepEqual(parseLiveServerMessage('{"type":"output","data":"ok"}'), { type: "output", data: "ok" });
  assert.deepEqual(parseLiveServerMessage('{"type":"exit","code":0,"signal":2}'), { type: "exit", code: 0, signal: 2 });
  assert.deepEqual(parseLiveServerMessage('{"type":"error","message":"closed"}'), { type: "error", message: "closed" });
  assert.equal(parseLiveServerMessage('{"type":"ready","extra":true}'), null);
  assert.equal(parseLiveServerMessage('{"type":"output","data":"x","extra":true}'), null);
  assert.equal(parseLiveServerMessage('{"type":"output","data":"' + "x".repeat(65_537) + '"}'), null);
  assert.equal(parseLiveServerMessage("not-json"), null);
  assert.equal(parseLiveServerMessage(new Uint8Array()), null);
});
