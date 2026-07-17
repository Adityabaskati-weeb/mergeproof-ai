---
name: mergeproof-review
description: Run an evidence-backed MergeProof review, plan, safe fix, test patch, or sandbox-agent verification for a pull request or working tree.
---

# MergeProof Review Skill

Use the repository CLI from its root. The CLI returns a three-state decision and must not be summarized as approved when it returns `needs-evidence` or `needs-owner`.

## Pull request review

```bash
npm run cli -- analyze "$PR_URL" -- --json --repo . --mcp
```

Use `--external-security` when npm audit or Semgrep is available. Use `--codeql-db <path>` only when a CodeQL database already exists. Treat unavailable external tools as provenance, not as a clean security result.

## Local review

```bash
npm run cli -- review . -- --json --external-security
```

Review staged, unstaged, and untracked changes. Do not add sensitive files to the index or bypass the exact working-tree digest.

## Safe changes

```bash
npm run cli -- plan "$PR_URL" -- --json
npm run cli -- fix "$PR_URL" -- --repo . --patch proposed-fix.patch
npm run cli -- tests "$PR_URL" -- --repo . --patch proposed-tests.patch
npm run cli -- agent . -- --json --verify "npm test"
```

The `fix` command only applies with an explicit `--apply`; the `agent` command applies proposed changes only inside an ephemeral worktree. Never claim a patch is verified unless the command reports `trace.verified: true`.

## Reporting

Preserve the model name, fetched/cited source counts, unsupported-claim count, security findings, MCP provenance, head SHA or working-tree digest, and attestation digest in the final report. If evidence is missing, ask for an owner decision instead of inventing a citation.

## Parallel and resumable work

Use `npm run cli -- fleet review <PR_URL> -- --json` when independent model agreement is required. Use `npm run cli -- fleet ask <question...> -- --repo . --model model-a model-b --json` or `fleet plan` for parallel repository work; context drift across repository heads is a hard failure. Interactive sessions are resumable with `npm run cli -- chat -- --repo . --session <id>`, and desktop/editor integrations should use `chat-turn ... --json` to preserve the session ID and provenance trace.
