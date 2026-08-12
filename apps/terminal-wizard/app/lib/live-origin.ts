export const LOCAL_LIVE_MAC_ORIGIN = "http://127.0.0.1:4317";
export const HOSTED_LIVE_MAC_ORIGIN = "https://terminal-tutor-three.vercel.app";

const instancePattern = /^[A-Za-z0-9_-]{22}$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

export type HostedPairing = Readonly<{
  version: 1;
  instanceId: string;
  pairingSecret: string;
}>;

export type LiveMacAccess =
  | Readonly<{ kind: "local"; pairing: null }>
  | Readonly<{ kind: "hosted"; pairing: HostedPairing }>
  | Readonly<{ kind: "hosted-unpaired"; pairing: null }>
  | Readonly<{ kind: "unavailable"; pairing: null }>;

export function parseHostedPairing(hash: string): HostedPairing | null {
  if (!hash.startsWith("#pair=")) return null;
  const value = hash.slice("#pair=".length);
  const parts = value.split(".");
  if (
    parts.length !== 3
    || parts[0] !== "v1"
    || !instancePattern.test(parts[1])
    || !secretPattern.test(parts[2])
  ) {
    return null;
  }
  return Object.freeze({
    version: 1,
    instanceId: parts[1],
    pairingSecret: parts[2],
  });
}

export function resolveLiveMacAccess(origin: string, hash = ""): LiveMacAccess {
  if (origin === LOCAL_LIVE_MAC_ORIGIN) return { kind: "local", pairing: null };
  if (origin !== HOSTED_LIVE_MAC_ORIGIN) return { kind: "unavailable", pairing: null };
  const pairing = parseHostedPairing(hash);
  return pairing
    ? { kind: "hosted", pairing }
    : { kind: "hosted-unpaired", pairing: null };
}

export function consumeLiveMacAccess(
  location: Pick<Location, "origin" | "hash" | "pathname" | "search">,
  history: Pick<History, "state" | "replaceState">,
): LiveMacAccess {
  const access = resolveLiveMacAccess(location.origin, location.hash);
  if (location.hash.startsWith("#pair=")) {
    history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  }
  return access;
}

export function supportsLiveMac(origin: string, hash = ""): boolean {
  const access = resolveLiveMacAccess(origin, hash);
  return access.kind === "local" || access.kind === "hosted";
}
