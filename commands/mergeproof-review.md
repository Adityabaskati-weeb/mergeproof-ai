---
description: Run a citation-validated MergeProof review or safe implementation workflow.
argument-hint: "[pull-request-url or working-tree request]"
---

Use the MergeProof CLI from the repository root. For a pull request, run:

```bash
npm run cli -- analyze "$ARGUMENTS" -- --json --publish-check
```

For local changes, run:

```bash
npm run cli -- review . -- --json
```

Preserve the three-state decision, exact head SHA, fetched/cited source counts, unsupported-claim count, security findings, and attestation. Never describe `needs-evidence` or `needs-owner` as approval. Safe changes require an explicit plan, ephemeral verification, and human approval before applying or publishing.
