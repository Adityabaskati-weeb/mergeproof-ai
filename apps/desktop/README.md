# MergeProof Desktop

MergeProof Desktop is a native Tauri 2 shell for the shared MergeProof engine. It is intentionally not a hosted website.

The desktop client currently provides:

- local pull-request analysis
- staged, unstaged, and untracked working-tree review
- ephemeral sandbox-agent fix generation with optional verification
- provider and model selection per analysis
- low, medium, or high review effort selection
- directory-scoped local review and one-pass sandbox re-review
- evidence trace and citation inspection
- repository retrieval provenance when the exact PR checkout is available
- related local repository context through the CLI-compatible analysis engine
- deterministic security findings with line-linked evidence
- optional repository-scoped review memory
- explicit repository knowledge facts with path scoping
- named repository custom-agent profiles
- quiet/chill/assertive review profiles
- reviewer suggestions from CODEOWNERS and `.mergeproof/reviewers.json`
- privacy and quality signals, consensus gate, simplify, and conflict resolution actions
- analyze, plan, and guarded fix actions through the bundled CLI

The CLI and desktop client call the same `lib/analyze.ts` engine and share the same `Analysis` contract. Install Rust and Tauri prerequisites, then run `npm run desktop:dev` from the repository root. Development falls back to the local `tsx` runner; `npm run desktop:build` creates a self-contained Windows sidecar and native MSI/NSIS installers. Set `MERGEPROOF_CLI` only when using an installed executable during development.
