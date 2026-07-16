# MergeProof Desktop

MergeProof Desktop is a native Tauri 2 shell for the shared MergeProof engine. It is intentionally not a hosted website.

The desktop client will provide:

- local repository and pull-request selection
- model policy configuration
- analysis history stored locally
- evidence trace and citation inspection
- human approval for Jira and Slack actions

The CLI and desktop client call the same `lib/analyze.ts` engine and share the same `Analysis` contract. Install Rust and Tauri prerequisites, then run `npm run desktop:dev` from the repository root. The shell invokes the `mergeproof` CLI through `MERGEPROOF_CLI` or the executable on `PATH`.
