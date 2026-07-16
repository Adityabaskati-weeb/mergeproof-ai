# MergeProof

MergeProof is an evidence-backed merge decision agent for engineering teams. It turns a Jira ticket and GitHub pull request into a cited change contract across code, tests, and release readiness.

## Current vertical slice

- `mergeproof analyze <public-pr-url>` CLI workflow
- Desktop shell boundary in `apps/desktop`
- Paste a public GitHub pull request URL into the CLI or native desktop client
- Fetch real PR metadata, changed files, commits, and checks with Octokit
- Extract acceptance criteria from the PR description
- Analyze the change with a configurable OpenAI model (GPT-5.6 by default)
- Validate model citations against the fetched GitHub sources
- Three-state decision model: ready, needs evidence, needs owner decision
- Provenance metrics for fetched sources, cited sources, unsupported claims, model, and latency

## Run locally

Run all commands from the repository root, not from `C:\Users\baska`:

```text
C:\Users\baska\Documents\Codex\2026-07-16\hey-everyone-build-week-starts-now
```

### Command Prompt

```bat
cd /d "C:\Users\baska\Documents\Codex\2026-07-16\hey-everyone-build-week-starts-now"
npm install
copy .env.example .env
set OPENAI_API_KEY=your-real-openai-key
set OPENAI_MODEL=gpt-5.6
npm run cli -- analyze https://github.com/owner/repo/pull/123
npm run desktop:dev
```

### PowerShell

```powershell
Set-Location "C:\Users\baska\Documents\Codex\2026-07-16\hey-everyone-build-week-starts-now"
npm install
Copy-Item .env.example .env
$env:OPENAI_API_KEY = "your-real-openai-key"
$env:OPENAI_MODEL = "gpt-5.6"
npm run cli -- analyze https://github.com/owner/repo/pull/123
npm run desktop:dev
```

The CLI also loads values from `.env`. Never commit the real `.env` file. `GITHUB_TOKEN` is optional for public repositories but helps avoid API rate limits. The model is configurable per command, so teams can choose their preferred provider-compatible model name.

Run the CLI directly during development:

```text
npm run cli -- analyze https://github.com/owner/repo/pull/123
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --json
```

Replace the example PR URL with a real pull request. `https://github.com/owner/repo/pull/123` is only a placeholder.

Exit codes are `0` for a ready decision, `2` when human evidence or ownership is required, and `1` for an invalid request or runtime failure. This keeps the CLI useful in CI without treating uncertainty as a successful merge gate.

The native desktop client lives in `apps/desktop`. Install Rust through `rustup` and the Tauri prerequisites before running `npm run desktop:dev` from the repository root. Use `npm run desktop:build` to create the Windows installers.

The desktop shell invokes the same CLI engine through the local `tsx` runner during development. `npm run desktop:build` bundles the CLI into a Windows sidecar and produces MSI and NSIS installers. Set `MERGEPROOF_CLI` only when using a separately installed executable during development.

## Planned integrations

- GitHub App + Octokit for pull request webhooks, diffs, checks, and comments
- OpenAI Responses API with structured output for the Change Contract
- Local repository retrieval and evaluation traces
- Jira Cloud REST API for acceptance criteria and approved follow-ups
- Slack Bolt for approved ownership messages
- Tauri desktop shell using the same core analysis engine as the CLI

See `outputs/mergeproof-design.md` for the validated product design and review decisions.
