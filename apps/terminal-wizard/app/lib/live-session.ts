export const LIVE_SESSION_URL = "http://127.0.0.1:4318/session";
export const LIVE_SOCKET_URL = "ws://127.0.0.1:4318/terminal";

type TicketResponse = {
  protocol?: unknown;
  expiresInMs?: unknown;
};

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

export async function requestLiveTicket(
  signal: AbortSignal,
  fetchTicket: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchTicket(LIVE_SESSION_URL, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  });

  if (!response.ok) {
    if (response.status === 409) throw new Error("Live Mac is already in use in another tab.");
    throw new Error("The local Live Mac service is unavailable. Restart Terminal Tutor and try again.");
  }

  const body = (await response.json()) as TicketResponse;
  if (
    typeof body.protocol !== "string"
    || !/^terminal-tutor\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(body.protocol)
    || body.expiresInMs !== 30_000
  ) {
    throw new Error("The Live Mac service returned an invalid session ticket.");
  }
  return body.protocol;
}
