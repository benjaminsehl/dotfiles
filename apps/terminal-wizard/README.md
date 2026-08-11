# Terminal Wizard

A private, interactive field guide to Benjamin’s real developer setup:

```text
Ghostty → zsh + Starship → Herdr → OMP / Codex
                    └── mise → Node, pnpm, Bun, Go, Python
```

The browser terminal is powered by
[`wterm`](https://github.com/vercel-labs/wterm), its libghostty WASM core, and
`just-bash`. It teaches the declared toolchain in ten short lessons while
keeping the default experience isolated from the Mac.

## Run locally

After applying the dotfiles, run:

```bash
terminal-wizard
```

Or run the app directly from the repository:

```bash
cd apps/terminal-wizard
npm ci
npm run dev
```

Open <http://127.0.0.1:4317>. The fixed loopback origin is intentional: Chrome
folder permissions, the one-time Live Mac ticket, and browser storage are all
origin-bound.

Production-local mode:

```bash
npm run build
npm start
```

Node 24 is the declared runtime; `engines.node` allows Node 22.13 or newer.

## Three levels of access

### Practice (default)

- An in-memory Bash-compatible filesystem; changes disappear on reload.
- No network configuration, native process access, or Mac credentials.
- The terminal parser is libghostty, so color, Unicode, and escape handling
  closely match Ghostty even though the shell itself is simulated.
- Lesson buttons insert commands but never press Return.

### Read-only folder snapshot

Chrome can optionally expose a user-selected project through the File System
Access API. Raw handles stay in a private module closure; React and wterm receive
only frozen text DTOs mounted below `/workspace`.

The scanner asks for read access only, limits depth, entries, individual files,
and total decoded bytes, rejects binary/invalid UTF-8, removes terminal controls,
and blocks or redacts common credential patterns. Heuristics cannot recognize
every possible secret, so choose a narrow project or dotfiles directory—never
the home directory. The browser works from a point-in-time copy; use **Refresh
snapshot** in the folder card after files change on disk.

### Live Mac (explicit opt-in)

Live Mac is a real `/bin/zsh -l` PTY with the user’s full permissions. Opening
it requires typing `LIVE`. The shell starts at the checked-out dotfiles root so
course commands inspect the same project in Practice and Live. The bridge:

- binds only to `127.0.0.1:4318`;
- checks the exact browser Origin, HTTP Host, WebSocket path, and loopback peer;
- mints a single-use 256-bit protocol ticket that expires after 30 seconds;
- allows one active session, disables compression, caps messages and buffered
  output, and closes after 20 minutes without keyboard activity;
- passes an explicit environment allowlist rather than browser/server secrets;
- never reconnects automatically.

Treat this mode exactly like a Ghostty window. The browser UI is not a sandbox
once Live Mac is connected.

## Verification

```bash
npm run check
```

This runs TypeScript, ESLint, policy/unit tests, adversarial PTY boundary tests,
a production build, rendered HTML and security-header assertions, local WASM
checks, and both runtime and full dependency audits.

`npm audit --omit=dev` is clean. The full audit has one documented upstream
exception: `vinext@1.0.0-beta.5` depends on `image-size@2.0.2`, whose ICNS and
JXL/HEIF parsers have infinite-loop advisories. Terminal Wizard configures no
image optimizer. Vinext imports `image-size` only from its metadata-route build
helper; this app defines no file-based metadata image routes and accepts no
user-controlled build inputs, so those parsers are not reachable through the
app. `scripts/audit.mjs` allows only those exact advisories and fails closed on
errors, malformed reports, or anything new. Do not run `npm audit fix --force`;
npm currently proposes a breaking vinext downgrade.

## Local-only by design

There is no analytics, account, cloud sync, remote shell endpoint, or hosted
deployment. Progress is `localStorage`; a selected folder handle can be stored
in IndexedDB and still requires the permission state Chrome grants. Use
“Forget folder” in the app and Chrome site settings when you want to remove both
the remembered handle and browser-level permission.

## Key dependencies

- `@wterm/*` 0.3.3
- libghostty core built from Ghostty 1.3.1
- `just-bash` 2.14.5
- React 19.2.8
- Vite 8.2.1 / vinext 1.0.0-beta.5
- `node-pty` 1.1.0 / `ws` 8.21.3

The generated social card is project-local at `public/og.png`; runtime fonts,
WASM, CSS, and scripts are all served locally.

Redistributed WASM attribution and complete license texts are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
