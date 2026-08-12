# Third-party notices

Terminal Tutor redistributes or adapts the following third-party work:

- `public/wterm.wasm` is copied from `@wterm/core` 0.3.3, part of
  [Vercel Labs' wterm](https://github.com/vercel-labs/wterm). Wterm is
  Copyright 2025 Vercel, Inc. and licensed under Apache-2.0. See
  [`licenses/APACHE-2.0.txt`](licenses/APACHE-2.0.txt).
- `app/lib/practice-shell.ts` adapts the line-editing behavior from
  `@wterm/just-bash` 0.3.3, part of wterm and licensed under Apache-2.0. The
  local adapter executes through `just-bash` once and reports the resulting
  status and working directory to the lesson layer. See
  [`licenses/APACHE-2.0.txt`](licenses/APACHE-2.0.txt).
- `public/ghostty-vt.wasm` is copied from `@wterm/ghostty` 0.3.3, also part of
  wterm and licensed under Apache-2.0. The artifact is built from
  [Ghostty](https://github.com/ghostty-org/ghostty) 1.3.1, Copyright 2024
  Mitchell Hashimoto and Ghostty contributors, licensed under the MIT License.
  See [`licenses/APACHE-2.0.txt`](licenses/APACHE-2.0.txt) and
  [`licenses/Ghostty-MIT.txt`](licenses/Ghostty-MIT.txt).

These notices do not change the license of Benjamin Sehl's original work in
this repository.
