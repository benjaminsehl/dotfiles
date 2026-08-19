import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_SESSION_URL,
  parseLiveServerMessage,
  requestLiveTicket,
} from "../app/lib/live-session.ts";

const ticket = `terminal-tutor.${"c".repeat(43)}.${"d".repeat(43)}`;

test("requests one local ticket with an exact credential-free loopback GET", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await requestLiveTicket(
    new AbortController().signal,
    (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ protocol: ticket, expiresInMs: 30_000 }));
    }) as typeof fetch,
  );

  assert.equal(result, ticket);
  assert.equal(capturedUrl, LIVE_SESSION_URL);
  assert.equal(capturedInit?.method, "GET");
  assert.equal(capturedInit?.credentials, "omit");
  assert.equal(capturedInit?.cache, "no-store");
  assert.equal(capturedInit?.redirect, "error");
  assert.equal(capturedInit?.referrerPolicy, "no-referrer");
  assert.equal(capturedInit?.body, undefined);
  assert.equal(capturedInit?.headers, undefined);
  assert.equal(Object.hasOwn(capturedInit ?? {}, "targetAddressSpace"), false);
});

test("fails closed on busy, unavailable, and malformed ticket responses", async () => {
  const requestWith = (response: Response) => requestLiveTicket(
    new AbortController().signal,
    (async () => response) as typeof fetch,
  );

  await assert.rejects(requestWith(new Response("{}", { status: 409 })), /already in use/);
  await assert.rejects(requestWith(new Response("{}", { status: 500 })), /local Live Mac service is unavailable/);
  await assert.rejects(
    requestWith(new Response(JSON.stringify({ protocol: "terminal-tutor.bad", expiresInMs: 30_000 }))),
    /invalid session ticket/,
  );
  await assert.rejects(
    requestWith(new Response(JSON.stringify({ protocol: ticket, expiresInMs: 1 }))),
    /invalid session ticket/,
  );
  await assert.rejects(
    requestWith(new Response(JSON.stringify({
      protocol: `wrong-prefix.${"c".repeat(43)}.${"d".repeat(43)}`,
      expiresInMs: 30_000,
    }))),
    /invalid session ticket/,
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
