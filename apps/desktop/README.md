# MergeProof Desktop

MergeProof Desktop is the planned native desktop shell for the shared MergeProof engine. It is intentionally not a hosted website.

The desktop client will provide:

- local repository and pull-request selection
- model policy configuration
- analysis history stored locally
- evidence trace and citation inspection
- human approval for Jira and Slack actions

The CLI and desktop client must call the same `lib/analyze.ts` engine and share the same `Analysis` contract. The desktop shell will be added with Tauri when the Rust toolchain is available; until then, the CLI is the executable reference client.
