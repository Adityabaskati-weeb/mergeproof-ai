# MergeProof Desktop

MergeProof Desktop is a native Tauri 2 shell for the shared MergeProof engine. It is intentionally not a hosted website.

The desktop client currently provides:

- local pull-request analysis
- model selection per analysis
- evidence trace and citation inspection
- human approval as the boundary for future Jira and Slack actions

The CLI and desktop client call the same `lib/analyze.ts` engine and share the same `Analysis` contract. Install Rust and Tauri prerequisites, then run `npm run desktop:dev` from the repository root. Development falls back to the local `tsx` runner; `npm run desktop:build` creates a self-contained Windows sidecar and native MSI/NSIS installers. Set `MERGEPROOF_CLI` only when using an installed executable during development.
