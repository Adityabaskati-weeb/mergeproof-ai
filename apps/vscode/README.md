# MergeProof VS Code Extension

This thin extension provides ten commands while reusing the repository CLI:

- `MergeProof: Review Working Tree`
- `MergeProof: Run Sandbox Agent`
- `MergeProof: Run Autopilot Correction Loop`
- `MergeProof: Run Autopilot Correction Loop`
- `MergeProof: Analyze Pull Request`
- `MergeProof: Generate Evidence Plan`
- `MergeProof: Suggest Safe Fix`
- `MergeProof: Generate Test Patch`
- `MergeProof: Autofix Review Threads`
- `MergeProof: Run Consensus Gate`
- `MergeProof: Simplify Changed Code`
- `MergeProof: Resolve Merge Conflicts`
- `MergeProof: Scan Repository Security`
- `MergeProof: Inspect Plan History`

Open the repository root in VS Code, install dependencies there, then install this extension directory through VS Code's extension development workflow. Set `mergeproof.cliPath` only when using a globally installed CLI; otherwise it invokes the workspace `npm run cli` script.
