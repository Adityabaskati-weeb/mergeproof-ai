# MergeProof

MergeProof is an evidence-backed merge decision agent for engineering teams. It turns a Jira ticket and GitHub pull request into a cited change contract across code, tests, and release readiness.

## Current vertical slice

- `mergeproof analyze <public-pr-url>` CLI workflow
- Desktop shell boundary in `apps/desktop`
- Paste a public GitHub pull request URL into the CLI or native desktop client
- Fetch real PR metadata, changed files, commits, and checks with Octokit
- Extract acceptance criteria from the PR description
- Analyze the change with a configurable OpenAI model (GPT-5.6 by default)
- Route analysis through OpenAI, OpenAI-compatible endpoints, or Anthropic
- Retrieve evidence from an indexed local checkout at the exact PR head commit
- Import linked Jira issue descriptions and acceptance criteria when credentials are configured
- Validate model citations against the fetched GitHub sources
- Publish a MergeProof GitHub Check with annotations and a merge decision
- Optionally notify a Slack incoming webhook
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
npm run cli -- index .
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --repo . --provider openai-compatible --model your-model
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --save analysis.json
npm run cli -- evaluate analysis.json
```

Replace the example PR URL with a real pull request. `https://github.com/owner/repo/pull/123` is only a placeholder.

Exit codes are `0` for a ready decision, `2` when human evidence or ownership is required, and `1` for an invalid request or runtime failure. This keeps the CLI useful in CI without treating uncertainty as a successful merge gate.

The native desktop client lives in `apps/desktop`. Install Rust through `rustup` and the Tauri prerequisites before running `npm run desktop:dev` from the repository root. Use `npm run desktop:build` to create the Windows installers.

The desktop shell invokes the same CLI engine through the local `tsx` runner during development. `npm run desktop:build` bundles the CLI into a Windows sidecar and produces MSI and NSIS installers. Set `MERGEPROOF_CLI` only when using a separately installed executable during development.

## GitHub automation

Copy `.github/workflows/mergeproof.yml` into a repository and add an `OPENAI_API_KEY` repository secret. The workflow runs on pull-request updates and publishes a `MergeProof evidence gate` Check. A `ready` result succeeds; `needs-evidence` fails; `needs-owner` is neutral. The workflow intentionally does not auto-merge or modify code.

For repository retrieval, check out the PR head locally and run `npm run cli -- index .`, then analyze with `--repo .`. Evidence is only accepted when the indexed commit SHA exactly matches the PR head, preventing stale local files from becoming citations.

Repository policy lives in `.mergeproof/config.json`; team review guidance can be added to `.mergeproof/instructions.md`. Supported policy keys are `provider`, `model`, `retrievalTopK`, and `minCitationsPerCriterion`.

Save a machine-readable run with `-- --json` and use `evaluate` to report criterion coverage, citation coverage, abstention, unsupported claims, and retrieval usage. This makes MergeProof quality measurable instead of relying on an attractive demo transcript.

For Jira context, configure `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` in `.env`; link an issue in the PR body using a Jira URL or issue key. For Slack notifications, pass `--slack-webhook` explicitly; webhook URLs are never persisted by MergeProof.

Mutation actions are explicit: `--publish-review` posts a GitHub review or fallback PR comment, and `--create-jira` creates a Jira follow-up using `JIRA_PROJECT_KEY`. These flags are never enabled by default.

## Planned integrations

- GitHub App + Octokit for pull request webhooks, diffs, checks, and comments
- OpenAI Responses API with structured output for the Change Contract
- Local repository retrieval and evaluation traces
- Jira Cloud REST API for acceptance criteria and approved follow-ups
- Slack Bolt for approved ownership messages
- Tauri desktop shell using the same core analysis engine as the CLI

See `outputs/mergeproof-design.md` for the validated product design and review decisions.
