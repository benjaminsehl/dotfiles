export const LOCAL_LIVE_MAC_ORIGIN = "http://127.0.0.1:4317";

export function supportsLiveMac(origin: string): boolean {
  return origin === LOCAL_LIVE_MAC_ORIGIN;
}
