export const LIVE_MAC_ORIGIN = "http://127.0.0.1:4317";

export function supportsLiveMac(origin: string): boolean {
  return origin === LIVE_MAC_ORIGIN;
}
