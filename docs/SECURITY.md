# Security model

This repository is an explicit allowlist. It never scans a home directory and
never adopts configuration recursively.

## Never commit

- `.netrc`, `.npmrc`, `.env*`, private keys, tokens, or credential files
- `~/.config/gh`, `~/.ssh`, `~/.aws`, `~/.docker`, or password-manager data
- `~/.omp`, including its database, WAL, locks, provider credentials, and generated extension
- shell history, application history, backups, caches, or licensed font files
- `.gitconfig.local` and `.zshrc.local`

OMP's safe values are generated through its CLI during bootstrap instead of
copying its configuration tree. Herdr's OMP extension is generated the same
way. Git identity remains in a mode-600 local include.

Codex is managed with the same narrow approach. The repository never copies or
tracks `~/.codex`; `configure-codex` owns only the top-level approval policy and
reviewer keys while preserving machine-local tables. See [CODEX.md](CODEX.md).

Run `scripts/test` before every commit. It checks syntax, performs a redacted
secret scan when Gitleaks is available, and proves bootstrap idempotence in an
isolated temporary home.

`apply` never pulls the repository automatically. Review remote changes and use
`git pull --ff-only` explicitly before applying them. The shell also never
downloads a missing command on first use.

Bootstrap enables `.githooks/pre-commit` only for this checkout. It does not set
a global `core.hooksPath`, which would interfere with hooks owned by other
repositories.

If a secret is ever committed, removing the line is not enough. Revoke or
rotate the credential first, then remove it from Git history.
