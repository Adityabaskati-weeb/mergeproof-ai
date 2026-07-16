# JetBrains Integration

MergeProof is available in JetBrains IDEs through the built-in Terminal or External Tools feature. From the project root, use:

```text
npm run cli -- review . -- --json
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --repo . --json --mcp
npm run cli -- agent . -- --json --verify "npm test"
```

Configure an IntelliJ External Tool with:

- Program: `npm` on Windows or `npm` on macOS/Linux
- Arguments: `run cli -- review $ProjectFileDir$ -- --json`
- Working directory: `$ProjectFileDir$`

This uses the same engine as the desktop client, VS Code extension, CI workflow, and Cursor rule. A dedicated JetBrains plugin is not bundled; this integration intentionally avoids maintaining a second analyzer implementation.
