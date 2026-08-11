# Codex approval defaults

Codex and OMP are separate coding agents with separate approval settings. This
repository keeps OMP at `write`, while Codex uses:

```toml
approval_policy = "on-request"
approvals_reviewer = "auto_review"
```

`on-request` keeps approval boundaries available. `auto_review` delegates
eligible approval prompts to Codex's reviewer instead of requiring Benjamin to
answer every prompt; it does not disable sandboxing or grant blanket access.
This is the closest reproducible match for an “approve for me” interactive
default. A global `never` policy is intentionally not used.

OMP's `write` mode auto-approves reads and writes inside the workspace while
retaining the approval boundary for higher-impact execution. The per-session
equivalent is `omp --approval-mode write`. `omp --auto-approve` maps to OMP's
broader `yolo` mode and is intentionally not the persistent default.

The complete `~/.codex/config.toml` is not tracked because Codex also stores
machine-local marketplace, plugin, and integration settings there.
`configure-codex` changes only these two top-level keys, preserves all unknown
keys and tables, tightens the directory and file modes, and backs up a changed
file before replacing it.

The CLI itself is pinned through mise as `npm:@openai/codex`, and bootstrap
installs Herdr's Codex integration alongside its OMP integration. Credentials,
sessions, plugins, and marketplace state remain machine-local.

Verify or reapply the policy with:

```bash
configure-codex --check
configure-codex
```

See the official [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
and [configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic)
for the current semantics.
