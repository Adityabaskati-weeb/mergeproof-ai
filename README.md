# MergeProof

MergeProof is an evidence-backed merge decision agent for engineering teams. It turns a Jira ticket and GitHub pull request into a cited change contract across code, tests, and release readiness.

## Current vertical slice

- `mergeproof analyze <change-request-url>` CLI workflow for GitHub, GitLab, Bitbucket, and Azure DevOps
- `mergeproof review [repo-path]` pre-commit workflow for staged, unstaged, and untracked changes
- `mergeproof agent [repo-path]` sandboxed fix generation with optional verification
- `mergeproof autofix <github-or-gitlab-url> --repo <checkout>` review-thread autofix with optional verification, re-review, and explicit new-PR/MR handoff
- `mergeproof simplify <change-request-url>` behavior-preserving simplification suggestions
- `mergeproof consensus <change-request-url> --model <model...>` independent model evidence consensus
- Desktop shell boundary in `apps/desktop`
- VS Code commands in `apps/vscode`
- Paste a public GitHub pull request URL into the CLI or native desktop client
- Fetch real PR metadata, changed files, commits, and checks with Octokit
- Fetch unresolved GitHub review threads through GraphQL and treat their comment URLs as evidence sources
- Extract acceptance criteria from the PR description
- Analyze the change with a configurable OpenAI model (GPT-5.6 by default)
- Choose quiet, chill, or assertive review profiles
- Route analysis through OpenAI, OpenAI-compatible endpoints, or Anthropic
- Retrieve evidence from an indexed local checkout at the exact PR head commit
- Import linked Jira or Linear issue descriptions and acceptance criteria when credentials are configured
- Validate model citations against the fetched GitHub sources
- Publish a MergeProof GitHub Check with annotations and a merge decision
- Optionally notify a Slack incoming webhook
- Generate citation-aware implementation plans from a PR
- Suggest minimal unified-diff fixes from the same evidence context
- Generate test-only unified-diff suggestions without editing production code
- Select low, medium, or high review effort with bounded retrieval budgets
- Apply named repository custom-agent profiles from `.mergeproof/agents/*.md` or `.github/agents/*.md`
- Scope local reviews and sandbox agents to selected directories
- Re-review a verified sandbox patch once before reporting the result
- Apply a proposed fix only with an explicit local checkout and `git apply --check`
- Detect high-confidence credential and dangerous-sink patterns on added lines before model review
- Detect high-confidence privacy literals and AI-slop quality signals before model review
- Optionally run `npm audit`, Semgrep, and an existing or explicitly created CodeQL database with normalized findings
- Optionally call explicitly configured read-only MCP tools and include their responses as cited review context
- Optionally add Brave or Tavily web-search snippets as clearly labeled external context
- Add explicitly selected local related repositories as separately committed, citation-validated context
- Persist bounded, repository-scoped review memory locally for future context
- Store explicitly approved, repository- and path-scoped knowledge facts locally
- Suggest reviewers from `.github/CODEOWNERS` and `.mergeproof/reviewers.json`
- Accept signed GitHub pull-request webhooks for automatic review runs
- Run governed Slack message automations configured by channel, author, and text match
- Accept signed custom automation webhooks with event, nested-field, and change-request URL matching
- Emit a reproducible SHA-256 attestation for each decision and evidence set
- Record a bounded local audit trail inspectable with `mergeproof audit`
- Give local reviews a working-tree digest so citations and decisions are tied to the exact uncommitted snapshot
- Generate a proposed fix inside an ephemeral Git worktree without mutating the developer checkout
- Run an explicit allowlisted verification command inside that sandbox before reporting success
- Run the same sandbox agent in an ephemeral GitHub Actions runner through manual `workflow_dispatch`
- Run safe, read-only scheduled reviews for open pull requests through an opt-in GitHub Actions workflow
- Run a separately gated scheduled autofix workflow that never changes the original PR branch
- Run named lifecycle hooks from `.mergeproof/hooks.json` without permitting arbitrary shell commands
- Reuse the evidence contract from compatible agent surfaces through `skills/mergeproof-review/SKILL.md`
- Use the same engine from Cursor through `.cursor/rules/mergeproof-review.mdc`, VS Code, or the native IntelliJ plugin source in `apps/jetbrains`
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

The CLI also loads values from `.env`. Never commit the real `.env` file. `GITHUB_TOKEN` is optional for public repositories but helps avoid API rate limits. The model is configurable per command, so teams can choose their preferred provider-compatible model name. For local models such as Ollama or LM Studio, set `MERGEPROOF_PROVIDER=openai-compatible`, `OPENAI_BASE_URL=http://127.0.0.1:11434/v1`, and `OPENAI_MODEL` to the local model name; no cloud API key is required. `analyze` accepts GitHub PR, GitLab MR, Bitbucket PR, and Azure DevOps PR URLs. Set `GITLAB_TOKEN`, `BITBUCKET_TOKEN` or Bitbucket app-password fields, and `AZURE_DEVOPS_TOKEN` only when private-provider access or publication is required. CodeQL creation is opt-in and requires the CodeQL CLI; specify `--codeql-languages` and a query suite when the repository is not covered by the defaults.

For GitHub review-thread access, `GITHUB_TOKEN`, `GH_TOKEN`, a GitHub App installation, or a local `gh auth login` session is used. If thread access is unavailable, MergeProof records that provenance instead of treating the PR as thread-clean.

To use the safe autofix path, check out the exact PR head SHA and run:

```powershell
npm run cli -- autofix https://github.com/owner/repo/pull/123 --repo . --verify "npm test" --re-review
```

Add `--thread-id <id>` to approve only selected unresolved review threads, or `--create-pr` when you want MergeProof to push a new branch and open a separate PR after verification. The original branch is never modified by this command.

Lifecycle hooks are opt-in and use the allowlisted command IDs in `.mergeproof/hooks.example.json`; pass `--hooks` to `analyze` to run configured before/after hooks. Arbitrary shell commands are rejected.

### Read-only MCP context

To use MCP context, create `.mergeproof/mcp.json` and invoke `analyze --mcp`. MergeProof initializes each configured HTTP MCP server, requires the named tool to advertise `readOnlyHint: true`, calls only that tool, bounds its response to 20,000 characters, and records the server/tool URL in the analysis provenance. Header and argument strings may reference environment variables such as `${LINEAR_API_KEY}` and review fields such as `{{title}}`, `{{criteria}}`, `{{prUrl}}`, and `{{headSha}}`.

For web search, set `TAVILY_API_KEY` or `BRAVE_SEARCH_API_KEY` and pass `--web-search`; snippets are capped, labeled as external context, and never treated as repository files. This sends a bounded PR title/body summary to the selected search provider, so enable it only when that data flow is acceptable for the repository.

```json
{
  "servers": [
    {
      "name": "issue-tracker",
      "url": "https://mcp.example.com/mcp",
      "tool": "search_issues",
      "headers": { "Authorization": "Bearer ${ISSUE_TRACKER_TOKEN}" },
      "arguments": { "query": "{{title}} {{criteria}}" }
    }
  ]
}
```

Run the CLI directly during development:

```text
npm run cli -- analyze https://github.com/owner/repo/pull/123
npm run cli -- review . -- --criteria "API behavior is preserved|New behavior has focused tests"
npm run cli -- review . --effort high --dir src tests
npm run cli -- review . -- --external-security
npm run cli -- review . -- --codeql-db .codeql/db --codeql-create --codeql-query javascript-code-scanning.qls
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --repo . --external-security --codeql-db .codeql/db
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --repo . --mcp
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --web-search
npm run cli -- analyze https://github.com/owner/repo/pull/123 --related-repo ..\shared-contracts --related-repo ..\platform
npm run cli -- analyze https://github.com/owner/repo/pull/123 --repo . --agent security
npm run cli -- agent . -- --verify "npm test"
npm run cli -- agent . --verify "npm test" --re-review --dir src tests
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --json
npm run cli -- index .
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --repo . --provider openai-compatible --model your-model
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --save analysis.json
npm run cli -- evaluate analysis.json
npm run cli -- plan https://github.com/owner/repo/pull/123 -- --save plan.json
npm run cli -- plan https://acme.atlassian.net/browse/PLAT-42 -- --save plan.json
npm run cli -- simplify https://github.com/owner/repo/pull/123 -- --repo . --patch simplify.patch
npm run cli -- consensus https://github.com/owner/repo/pull/123 -- --model gpt-5.6 claude-sonnet-4-20250514 --provider openai anthropic --repo .
npm run cli -- fix https://github.com/owner/repo/pull/123 -- --repo . --patch proposed-fix.patch
npm run cli -- fix https://github.com/owner/repo/pull/123 -- --repo . --apply
npm run cli -- tests https://github.com/owner/repo/pull/123 -- --repo . --patch proposed-tests.patch
npm run cli -- memory owner/repo -- --repo . --query retry
npm run cli -- audit --repo .
npm run cli -- knowledge owner/repo --repo . --add "Generated API clients must be changed through the schema" --path src/api
npm run cli -- knowledge owner/repo --repo . --query schema
npm run cli -- serve -- --secret your-webhook-secret --repo . --publish-review
```

Replace the example PR URL with a real pull request. `https://github.com/owner/repo/pull/123` is only a placeholder.

Exit codes are `0` for a ready decision, `2` when human evidence or ownership is required, and `1` for an invalid request or runtime failure. This keeps the CLI useful in CI without treating uncertainty as a successful merge gate.

The native desktop client lives in `apps/desktop`. Install Rust through `rustup` and the Tauri prerequisites before running `npm run desktop:dev` from the repository root. Use `npm run desktop:build` to create the Windows installers. The desktop action picker exposes analyze, consensus, local review, sandbox agent, plan, safe-fix, simplify, and test workflows through the same bundled CLI.

The desktop shell invokes the same CLI engine through the local `tsx` runner during development. `npm run desktop:build` bundles the CLI into a Windows sidecar and produces MSI and NSIS installers. Set `MERGEPROOF_CLI` only when using a separately installed executable during development.

## GitHub automation

Copy `.github/workflows/mergeproof.yml` into a repository and add an `OPENAI_API_KEY` repository secret. The workflow runs on pull-request updates and publishes a `MergeProof evidence gate` Check. A `ready` result succeeds; `needs-evidence` fails; `needs-owner` is neutral. The workflow intentionally does not auto-merge or modify code.

For repository retrieval, check out the PR head locally and run `npm run cli -- index .`, then analyze with `--repo .`. Evidence is only accepted when the indexed commit SHA exactly matches the PR head, preventing stale local files from becoming citations. External security tools are opt-in; missing binaries are reported as unavailable rather than treated as a clean scan.

The included workflow reviews opened, synchronized, reopened, and ready-for-review pull requests, and supports manual `workflow_dispatch` runs. It checks out the PR head, publishes a Check and review, runs the deterministic security gate, and records memory for that repository. Add `OPENAI_API_KEY`; if your token cannot publish reviews, the workflow still retains the Check/status fallback. For a deployable GitHub App receiver, configure `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_PRIVATE_KEY`; `GITHUB_TOKEN` takes precedence for local and Actions runs. The `serve` command also accepts signed GitLab, Bitbucket, and Azure DevOps webhook events at `/gitlab/webhook`, `/bitbucket/webhook`, and `/azure-devops/webhook` when their provider webhook secrets are configured.

The manual `.github/workflows/mergeproof-agent.yml` workflow checks out a selected PR into an ephemeral Actions runner, runs the sandbox agent with an allowlisted verification command, uploads the JSON result as an artifact, and posts a summary comment. Its default-off `create_pr` input can apply the already-verified patch to a new branch and open a separate handoff PR; it never mutates the original PR branch. Agent-compatible editors can use `skills/mergeproof-review/SKILL.md` to invoke the same CLI contract.

The `.github/workflows/mergeproof-scheduled.yml` workflow reviews up to five open pull requests hourly when the repository variable `MERGEPROOF_SCHEDULE_ENABLED=true` is set, or immediately through `workflow_dispatch`. It publishes evidence checks, optionally publishes reviews when selected at dispatch time, uploads machine-readable results, and never applies code or merges a pull request. Scheduled model usage is opt-in because it can incur API cost.

Repository policy lives in `.mergeproof/config.json`; team review guidance can be added to `.mergeproof/instructions.md`. Supported policy keys are `provider`, `model`, `effort`, `retrievalTopK`, and `minCitationsPerCriterion`. Review effort defaults to `medium`; `low` uses four repository chunks, `medium` eight, and `high` sixteen unless `--retrieval-top-k` is explicitly set.

Save a machine-readable run with `-- --json` and use `evaluate` to report criterion coverage, citation coverage, abstention, unsupported claims, and retrieval usage. This makes MergeProof quality measurable instead of relying on an attractive demo transcript.

For Jira context, configure `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` in `.env`; for Linear context, configure `LINEAR_API_KEY` and optionally `LINEAR_TEAM_KEY`; link an issue in the change request body using a Jira or Linear URL. For Slack notifications, pass `--slack-webhook` explicitly; webhook URLs are never persisted by MergeProof.

Mutation actions are explicit: `--publish-review` posts a GitHub review or fallback PR comment, and `--create-jira` creates a Jira follow-up using `JIRA_PROJECT_KEY`. These flags are never enabled by default.

Review memory is local JSONL at `.mergeproof/memory.jsonl`; use `--remember` to persist a CLI run or start `serve` for webhook-driven persistence. Explicit knowledge facts are stored separately at `.mergeproof/knowledge.jsonl` and can only be added by a human through `knowledge --add` or Slack `learn`; both stores are bounded and contain summaries/facts, not repository source snapshots. `mergeproof serve` validates `x-hub-signature-256` before accepting GitHub events and supports `/mergeproof review`, `/mergeproof plan`, and `/mergeproof issue` comments on pull requests. If `SLACK_SIGNING_SECRET` is configured, the same receiver exposes `/slack/commands` and `/slack/events`: `review`, `investigate`, `plan`, `fix`, `tests`, `learn`, `rate`, and `autofix` accept the supported commands; explicit `issue` creation remains GitHub-only. Configure `SLACK_BOT_TOKEN` for threaded Events API replies. Thread-local state stores only the last change-request URL, so follow-up messages can say `review` or `plan` without resending the URL. Slack and GitHub writes are never enabled without the command and credentials. Slack autofix additionally requires `MERGEPROOF_SLACK_AUTOFIX_ENABLED=true`, an explicit checkout, and an allowlisted verification command, then opens a separate PR.

Slack message automations are opt-in through `.mergeproof/automations.json`, using the shape in `.mergeproof/automations.example.json`. Each rule can constrain `channelIds`, `authorIds`, `contains`, and `topLevelOnly`; supported actions are review, investigate, plan, fix, tests, and learn. Automations require a change-request URL in the message or an existing thread reference, and never create issues, apply patches, merge, or push code. Signed external automations can use `/automation/webhook` with `.mergeproof/webhook-automations.json` to match an event and payload field before running a read-only review, investigation, plan, or fix suggestion.

The VS Code extension exposes `review`, `analyze`, `plan`, `fix`, `tests`, and guarded `autofix` commands from the command palette. Local review includes uncommitted files and uses the same validator as PR analysis, so desktop, terminal, CI, and editor results share one evidence contract.

Fix suggestions are not silently committed, pushed, or posted to GitHub. Without `--apply`, MergeProof only emits a patch. With `--apply`, it rejects absolute or traversal paths and requires Git to accept the patch with whitespace errors treated as failures. The `agent` command is safer by default: it applies the patch only in an ephemeral Git worktree and can run only the explicitly supported verification commands.

## Product boundaries

MergeProof is intentionally local-first and evidence-gated. It does not claim to replace GitHub's hosted Copilot surfaces, CodeRabbit's hosted knowledge base, or provider-specific marketplace plugins. Those integrations can be added without changing the shared `Analysis` contract because provider ingestion, model routing, evidence validation, and publication are separated behind the CLI and desktop bridge.

See `outputs/mergeproof-design.md` for the validated product design and review decisions.
