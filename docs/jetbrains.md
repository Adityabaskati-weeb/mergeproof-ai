# JetBrains Integration

MergeProof includes a small native IntelliJ Platform plugin source under `apps/jetbrains`. Build it with `./gradlew buildPlugin` from that directory and install the generated ZIP through **Settings > Plugins > Install Plugin from Disk**. The actions invoke the same CLI and preserve the evidence engine and safety gates rather than maintaining a second analyzer implementation.

MergeProof is available in JetBrains IDEs through the native plugin source in `apps/jetbrains`, the built-in Terminal, or External Tools. The plugin exposes PR analysis, working-tree review, and guarded review-thread autofix; from the project root, use:

```text
npm run cli -- review . -- --json
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --repo . --json --mcp
npm run cli -- agent . -- --json --verify "npm test"
```

Configure an IntelliJ External Tool with:

- Program: `npm` on Windows or `npm` on macOS/Linux
- Arguments: `run cli -- review $ProjectFileDir$ -- --json`
- Working directory: `$ProjectFileDir$`

This uses the same engine as the desktop client, VS Code extension, CI workflow, and Cursor rule. The External Tool recipe remains useful when you do not want to build a plugin; autofix remains an explicit CLI command because it can create a branch and PR only after sandbox verification.
