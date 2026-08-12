import type { HostedPairing } from "@/app/lib/live-origin";

export const LIVE_SESSION_URL = "http://127.0.0.1:4318/session";
export const LIVE_SOCKET_URL = "ws://127.0.0.1:4318/terminal";
export const LIVE_HEALTH_URL = "http://127.0.0.1:4318/health";

type TicketResponse = {
  protocol?: unknown;
  expiresInMs?: unknown;
};

export class LiveTicketError extends Error {
  constructor(message: string, readonly pairingFinal = false) {
    super(message);
    this.name = "LiveTicketError";
  }
}

export type LiveServerMessage =
  | { type: "ready" }
  | { type: "output"; data: string }
  | { type: "exit"; code: number; signal?: number }
  | { type: "error"; message: string }
  | { type: "pong" };

export function parseLiveServerMessage(raw: unknown): LiveServerMessage | null {
  if (typeof raw !== "string" || raw.length > 70_000) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.type === "ready" || value.type === "pong") {
      return Object.keys(value).length === 1 ? { type: value.type } : null;
    }
    if (value.type === "output") {
      return Object.keys(value).length === 2
        && typeof value.data === "string"
        && value.data.length <= 65_536
        ? { type: "output", data: value.data }
        : null;
    }
    if (value.type === "error") {
      return Object.keys(value).length === 2
        && typeof value.message === "string"
        && value.message.length <= 512
        ? { type: "error", message: value.message }
        : null;
    }
    if (value.type === "exit") {
      const keys = Object.keys(value);
      const validKeys = keys.every((key) => key === "type" || key === "code" || key === "signal");
      return validKeys
        && keys.length >= 2
        && Number.isSafeInteger(value.code)
        && (value.signal === undefined || Number.isSafeInteger(value.signal))
        ? { type: "exit", code: value.code as number, ...(value.signal === undefined ? {} : { signal: value.signal as number }) }
        : null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function requestLiveHealth(
  pairing: HostedPairing,
  signal: AbortSignal,
  fetchHealth: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchHealth(LIVE_HEALTH_URL, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    targetAddressSpace: "loopback",
    signal,
  });
  if (!response.ok) {
    throw new Error("The local companion is unavailable. Run terminal-wizard --hosted again.");
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (
    Object.keys(body).length !== 3
    || body.ready !== true
    || body.mode !== "hosted"
    || body.instanceId !== pairing.instanceId
  ) {
    throw new Error("This browser is paired with a different Terminal Tutor companion.");
  }
}

export async function requestLiveTicket(
  pairing: HostedPairing | null,
  signal: AbortSignal,
  fetchTicket: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchTicket(LIVE_SESSION_URL, {
    method: pairing ? "POST" : "GET",
    headers: pairing ? { "Content-Type": "application/json" } : undefined,
    body: pairing
      ? JSON.stringify({
          version: pairing.version,
          instanceId: pairing.instanceId,
          pairingSecret: pairing.pairingSecret,
        })
      : undefined,
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    targetAddressSpace: "loopback",
    signal,
  });

  if (!response.ok) {
    if (response.status === 409) throw new LiveTicketError("Live Mac is already in use in another tab.", true);
    if (response.status === 401 || response.status === 403 || response.status === 410) {
      throw new LiveTicketError("This pairing expired. Run terminal-wizard --hosted again.", true);
    }
    throw new LiveTicketError("The local companion is unavailable. Run terminal-wizard --hosted again.");
  }

  const body = (await response.json()) as TicketResponse;
  if (
    typeof body.protocol !== "string"
    || !/^terminal-wizard\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(body.protocol)
    || body.expiresInMs !== 30_000
  ) {
    throw new LiveTicketError("The Live Mac service returned an invalid session ticket.", true);
  }
  return body.protocol;
}
