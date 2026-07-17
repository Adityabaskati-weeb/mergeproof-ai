---
name: mergeproof-review
description: Review a change request with MergeProof's evidence ledger, deterministic security gates, and conservative abstention rules.
---

Run the repository's MergeProof CLI for the requested pull request or working tree. Treat citations as valid only when they resolve to the fetched exact head SHA. Preserve `ready`, `needs-evidence`, and `needs-owner` as distinct outcomes. Do not invent evidence, remove deterministic security findings, modify the source branch, merge, or publish a fix without an explicit human-controlled action.

For pull requests, prefer `npm run cli -- analyze <url> -- --json --publish-check`. For local changes, prefer `npm run cli -- review . -- --json`. Use `mergeproof fleet review` when an independent multi-model quorum is requested.
