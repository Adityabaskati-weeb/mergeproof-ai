# MergeProof VS Code Extension

This thin extension provides four commands while reusing the repository CLI:

- `MergeProof: Analyze Pull Request`
- `MergeProof: Generate Evidence Plan`
- `MergeProof: Suggest Safe Fix`
- `MergeProof: Generate Test Patch`

Open the repository root in VS Code, install dependencies there, then install this extension directory through VS Code's extension development workflow. Set `mergeproof.cliPath` only when using a globally installed CLI; otherwise it invokes the workspace `npm run cli` script.
