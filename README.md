# MergeProof

MergeProof is an evidence-backed merge decision agent for engineering teams. It turns a Jira ticket and GitHub pull request into a cited change contract across code, tests, and release readiness.

## Current vertical slice

- `mergeproof analyze <change-request-url>` CLI workflow for GitHub, GitLab, Bitbucket, and Azure DevOps
- `mergeproof review [repo-path]` pre-commit workflow for staged, unstaged, and untracked changes
- `mergeproof review --agent-output` or `mergeproof cr --agent` CodeRabbit-compatible newline-delimited findings with citations and attestations
- `mergeproof review --interactive` interactive finding navigation with ignore/restore disposition controls
- `mergeproof findings --repo <checkout>` persisted finding history filtered by head, path, severity, and disposition; `findings ignore|restore` keeps a separate disposition ledger
- `mergeproof security --repo <checkout>` full-repository deterministic security scan with sensitive-file exclusions
- `mergeproof security-review [repo-path]` focused security review of active local changes
- `.mergeproof/checks.json` natural-language pre-merge checks evaluated as cited criteria on every review
- `.mergeproof/tools.json` SARIF ingestion for existing CI/security tools without executing arbitrary repository commands
- `mergeproof agent [repo-path]` / `mergeproof sandbox [repo-path]` sandboxed fix generation with optional verification
- `mergeproof task <github-issue-url> --repo <checkout>` evidence-retrieved issue implementation with sandbox verification and optional handoff PR
- `mergeproof implement <request...> --repo <checkout>` Copilot-style local implementation agent with bounded retrieval, sandbox verification, optional re-review, and explicit apply
- `mergeproof work-plan <request...> --repo <checkout>` CodeRabbit-style free-form planning from a PRD, design, issue text, or product request with local evidence citations
- `mergeproof recipes` and `mergeproof recipe <change-request-url> <name>` reusable repository-scoped finishing-touch actions
- `mergeproof autofix <github-or-gitlab-url> --repo <checkout>` review-thread autofix with optional verification, re-review, and explicit new-PR/MR handoff
- `mergeproof simplify <change-request-url>` behavior-preserving simplification suggestions
- `mergeproof docstrings <change-request-url>` documentation-only patch suggestions
- `mergeproof consensus <change-request-url> --model <model...>` independent model evidence consensus
- `mergeproof walkthrough <change-request-url>` cited PR summary, ordered change stack, effort estimate, and Mermaid change flow
- `mergeproof erd <change-request-url>` evidence-backed Mermaid schema/entity impact diagram
- `mergeproof conflicts [repo-path]` merge-conflict inspection and explicitly gated resolution patches
- `mergeproof feedback <change-request-url> <label>` and `mergeproof metrics` outcome feedback and ready-decision calibration
- `mergeproof benchmark --input <analysis-or-bundle...>` offline evidence-quality, attestation, and calibration scoring for a team review history
- `mergeproof verify <analysis-json>` to independently verify a saved analysis attestation
- `mergeproof bundle create|verify` to create and offline-verify a portable evidence capsule
- `mergeproof chat` for an interactive CLI session with read-only ask, plan, review, and sandboxed implement actions
- `mergeproof sessions list|show` and `mergeproof chat --session <id>` for resumable, inspectable local sessions
- `mergeproof sessions rename|fork|export|files|prune|cleanup|delete` for full local session lifecycle control
- `mergeproof chat-turn <ask|plan|review|implement> ... --json` for editor and desktop session-backed turns
- `mergeproof remote <ask|plan|review> ... --endpoint <url> --secret <secret>` for signed, read-only remote session steering
- `mergeproof fleet ask|plan|review` for parallel model/sub-agent work with repository-head consistency and disagreement reporting
- `mergeproof analyze <url> --publish-summary` to refresh a marker-scoped GitHub PR summary without overwriting author content
- `mergeproof report [repository]` for local dashboard-style Markdown, JSON, or CSV review reports, natural-language custom reports, and optional Slack, Discord, Teams, or SendGrid email delivery
- `mergeproof plan-history` to inspect recorded implementation-plan versions and content digests
- `mergeproof configuration` to inspect policy/instructions/recipes, or `--generate` to create a starter policy explicitly
- `mergeproof ask <question...>` (also `chat`) for read-only Copilot-style repository Q&A with bounded retrieval and an auditable trace
- `mergeproof research <topic...>` opt-in web research with a preserved source pack and model synthesis
- `mergeproof doctor --repo <checkout>` actionable environment and integration diagnostics without printing secrets
- `mergeproof search <query...>` bounded local timeline search across sessions, findings, audit events, and outcomes
- `mergeproof plugins` / `mergeproof extensions` discovers local agent plugins, skills, commands, and client surfaces
- `mergeproof init --repo <checkout>` idempotently scaffolds a local policy, safe mutation defaults, evidence checks, and instructions
- `mergeproof auth status|org` reports model/integration authentication and GitHub organization access without printing credential values; `auth login|logout --github` delegates GitHub authentication to `gh`
- Desktop shell boundary in `apps/desktop`
- VS Code commands in `apps/vscode`
- Portable agent distribution through `skills/mergeproof-review`, `.cursor-plugin`, `.claude-plugin`, `commands/mergeproof-review.md`, and `.github/agents/mergeproof-review.md`
- Paste a public GitHub pull request URL into the CLI or native desktop client
- Fetch real PR metadata, changed files, commits, and checks with Octokit
- Fetch failed check summaries and annotations into the evidence context for CI/CD-aware findings and fixes
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
- Generate citation-aware implementation plans from GitHub Issues, GitLab Issues, Jira, Linear, and PRs
- Generate evidence-grounded plans from arbitrary work items without requiring a hosted issue or pull request
- Record plan versions with `--record` so plan refinement remains inspectable and tied to a repository head
- Suggest minimal unified-diff fixes from the same evidence context
- Generate test-only unified-diff suggestions without editing production code
- Select low, medium, or high review effort with bounded retrieval budgets
- Apply named repository custom-agent profiles from `.mergeproof/agents/*.md` or `.github/agents/*.md`
- Scope local reviews and sandbox agents to selected directories
- Re-review a verified sandbox patch once before reporting the result
- Apply a proposed fix only with an explicit local checkout and `git apply --check`
- Detect high-confidence credential and dangerous-sink patterns on added lines before model review
- Scan the committed repository tree for the same deterministic security patterns without allowing model output to suppress findings
- Detect high-confidence privacy literals and AI-slop quality signals before model review
- Optionally run `npm audit`, Semgrep, and an existing or explicitly created CodeQL database with normalized findings
- Optionally call explicitly configured read-only MCP tools and include their responses as cited review context
- Optionally add Brave or Tavily web-search snippets as clearly labeled external context
- Add explicitly selected local related repositories as separately committed, citation-validated context
- Persist bounded, repository-scoped review memory locally for future context
- Store explicitly approved, repository- and path-scoped knowledge facts locally
- Suggest reviewers from `.github/CODEOWNERS` and `.mergeproof/reviewers.json`
- Publish an evidence-derived walkthrough with changed-file layers, related issues, reviewer suggestions, a non-runtime Mermaid change-flow diagram, and conservative schema impact ERD output
- Accept signed GitHub pull-request webhooks for automatic review runs
- Run governed Slack message automations configured by channel, author, and text match
- Accept signed custom automation webhooks with event, nested-field, and change-request URL matching
- Accept signed Discord `/mergeproof` interactions with deferred follow-up results through the same governed command engine
- Enforce optional default-deny Slack channel/user/action scopes and durable hourly request budgets from `.mergeproof/slack-scopes.json`
- Emit a reproducible SHA-256 attestation for each decision and evidence set
- Record a bounded local audit trail inspectable with `mergeproof audit`
- Record merge/close lifecycle outcomes and explicit human feedback against the original decision, head SHA, and attestation
- Record merged outcomes automatically through the opt-in `mergeproof-post-merge.yml` GitHub Actions workflow
- Give local reviews a working-tree digest so citations and decisions are tied to the exact uncommitted snapshot
- Generate a proposed fix inside an ephemeral Git worktree without mutating the developer checkout
- Implement a natural-language local request from a clean checkout inside an ephemeral Git worktree; `--apply` requires explicit verification and refuses stale or changed checkouts
- Create explicit stacked PRs for GitHub review-thread autofixes with `--stacked-pr`
- Run an explicit allowlisted verification command inside that sandbox before reporting success
- Run the same sandbox agent in an ephemeral GitHub Actions runner through manual `workflow_dispatch`
- Run safe, read-only scheduled reviews for open pull requests through an opt-in GitHub Actions workflow
- Deliver scheduled Markdown review reports to Slack, Discord, Microsoft Teams, or SendGrid email through explicit opt-in credentials
- Generate custom report narratives with `report --prompt`; the prompt receives only the measured local report and a source digest
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
npm run cli -- work-plan "Add rate limiting to the public API" --repo . --json
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
npm run cli -- autofix https://github.com/owner/repo/pull/123 -- --repo . --verify "npm test" --re-review
npm run cli -- autofix https://github.com/owner/repo/pull/123 -- --repo . --verify "npm test" --re-review --create-pr --stacked-pr
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

On Windows PowerShell, use `npm.cmd` instead of `npm` if the PowerShell shim intercepts CLI arguments, for example `npm.cmd run cli -- bundle verify review.bundle.json`.

```text
npm run cli -- analyze https://github.com/owner/repo/pull/123
npm run cli -- review . -- --criteria "API behavior is preserved|New behavior has focused tests"
npm run cli -- review . --effort high --dir src tests
npm run cli -- review . -- --external-security
npm run cli -- review . --agent-output --type uncommitted --light
npm run cli -- --config review-guidance.md review . --agent-output
npm run cli -- security-review . --agent-output
npm run cli -- review . -- --codeql-db .codeql/db --codeql-create --codeql-query javascript-code-scanning.qls
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --repo . --external-security --codeql-db .codeql/db
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --repo . --mcp
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --web-search
npm run cli -- analyze https://github.com/owner/repo/pull/123 --related-repo ..\shared-contracts --related-repo ..\platform
npm run cli -- analyze https://github.com/owner/repo/pull/123 --repo . --agent security
npm run cli -- agent . -- --verify "npm test"
npm run cli -- agent . --verify "npm test" --re-review --dir src tests
npm run cli -- ask "How does authentication flow through this repository?" -- --repo . --json
npm run cli -- research "secure GitHub webhook verification" -- --repo . --json
npm run cli -- doctor -- --repo .
npm run cli -- task https://github.com/owner/repo/issues/123 -- --repo . --verify "npm test" --re-review
npm run cli -- task https://github.com/owner/repo/issues/123 -- --repo . --verify "npm test" --re-review --create-pr
npm run cli -- recipes -- --repo .
npm run cli -- recipe https://github.com/owner/repo/pull/123 api-contract -- --repo . --patch recipe.patch
npm run cli -- recipe https://github.com/owner/repo/pull/123 api-contract -- --repo . --verify "npm test" --re-review --create-pr
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --json
npm run cli -- index .
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --repo . --provider openai-compatible --model your-model
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --save analysis.json
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --request-reviewers @alice team:platform
npm run cli -- analyze https://github.com/owner/repo/pull/123 -- --apply-labels
npm run cli -- evaluate analysis.json
npm run cli -- verify analysis.json
npm run cli -- bundle create https://github.com/owner/repo/pull/123 --analysis analysis.json --output review.bundle.json
npm run cli -- bundle verify review.bundle.json
npm.cmd run cli -- chat --repo . --verify "npm test" --re-review
npm run cli -- report owner/repo -- --repo . --format csv --output mergeproof-report.csv
npm run cli -- feedback https://github.com/owner/repo/pull/123 merged -- --repo . --analysis analysis.json
npm run cli -- metrics owner/repo -- --repo . --json
npm run cli -- plan https://github.com/owner/repo/pull/123 -- --save plan.json
npm run cli -- plan https://github.com/owner/repo/pull/123 -- --record --repo . --save plan.json
npm run cli -- work-plan "Add rate limiting to the public API" -- --repo . --record --json
npm run cli -- plan-history -- --repo . --json
npm run cli -- walkthrough https://github.com/owner/repo/pull/123 -- --publish
npm run cli -- plan https://acme.atlassian.net/browse/PLAT-42 -- --save plan.json
npm run cli -- simplify https://github.com/owner/repo/pull/123 -- --repo . --patch simplify.patch
npm run cli -- consensus https://github.com/owner/repo/pull/123 -- --model gpt-5.6 claude-sonnet-4-20250514 --provider openai anthropic --repo .
npm run cli -- fix https://github.com/owner/repo/pull/123 -- --repo . --patch proposed-fix.patch
npm run cli -- fix https://github.com/owner/repo/pull/123 -- --repo . --apply
npm run cli -- tests https://github.com/owner/repo/pull/123 -- --repo . --patch proposed-tests.patch
npm run cli -- docstrings https://github.com/owner/repo/pull/123 -- --repo . --patch proposed-docstrings.patch
npm run cli -- memory owner/repo -- --repo . --query retry
npm run cli -- audit --repo .
npm run cli -- state --repo . --json
npm run cli -- state --repo . --pause --reason "Release freeze"
npm run cli -- state --repo . --auto-pause-after 5 --reason "Avoid repetitive incremental reviews"
npm run cli -- conflicts .
npm run cli -- conflicts . --resolve --model gpt-5.6 --patch conflict-resolution.patch
npm run cli -- resolve https://github.com/owner/repo/pull/123 -- --json
npm run cli -- resolve https://github.com/owner/repo/pull/123 -- --apply --thread-id PRRT_kwDO123
npm run cli -- knowledge owner/repo --repo . --add "Generated API clients must be changed through the schema" --path src/api
npm run cli -- knowledge owner/repo --repo . --query schema
npm run cli -- security -- --repo . --json
npm run cli -- serve -- --secret your-webhook-secret --repo . --publish-review
```

Replace the example PR URL with a real pull request. `https://github.com/owner/repo/pull/123` is only a placeholder.

Exit codes are `0` for a ready decision, `2` when human evidence or ownership is required, and `1` for an invalid request or runtime failure. This keeps the CLI useful in CI without treating uncertainty as a successful merge gate.

The native desktop client lives in `apps/desktop`. Install Rust through `rustup` and the Tauri prerequisites before running `npm run desktop:dev` from the repository root. Use `npm run desktop:build` to create the Windows installers. The desktop action picker exposes evidence chat, analyze, read-only repository ask, consensus, local review, repository security scan, offline review-capsule verification, plan history, sandbox agent, GitHub issue tasks, named recipes, URL-based plan, free-form work plan, safe-fix, simplify, and test workflows through the same bundled CLI.

Named finishing-touch recipes live in `.mergeproof/recipes.json`; start from `.mergeproof/recipes.example.json`. Each recipe has bounded instructions and optional path scopes. Recipe patches are suggestions by default, can be checked and applied explicitly, and can be delivered as a separate verified GitHub PR.

The desktop shell invokes the same CLI engine through the local `tsx` runner during development. `npm run desktop:build` bundles the CLI into a Windows sidecar and produces MSI and NSIS installers. Set `MERGEPROOF_CLI` only when using a separately installed executable during development.

## GitHub automation

Copy `.github/workflows/mergeproof.yml` into a repository and add an `OPENAI_API_KEY` repository secret. The workflow runs on pull-request updates and publishes a `MergeProof evidence gate` Check. A `ready` result succeeds; `needs-evidence` fails; `needs-owner` is neutral. The workflow intentionally does not auto-merge or modify code.

For repository retrieval, check out the PR head locally and run `npm run cli -- index .`, then analyze with `--repo .`. Evidence is only accepted when the indexed commit SHA exactly matches the PR head, preventing stale local files from becoming citations. External security tools are opt-in; missing binaries are reported as unavailable rather than treated as a clean scan. Existing CI/security output can be added through `.mergeproof/tools.json` or `--tool-sarif <path...>`; MergeProof accepts only SARIF files inside the repository, maps each result to a cited finding, and never executes the tool command. Language-server output can be added with `--lsp-diagnostics diagnostics.json`; the JSON artifact is bounded, repository-local, and converted into cited quality findings without starting an arbitrary LSP process.

The included workflow reviews opened, synchronized, reopened, and ready-for-review pull requests, and supports manual `workflow_dispatch` runs. It checks out the PR head, publishes a Check and review, runs the deterministic security gate, and records memory for that repository. Add `OPENAI_API_KEY`; if your token cannot publish reviews, the workflow still retains the Check/status fallback. For a deployable GitHub App receiver, configure `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_PRIVATE_KEY`; `GITHUB_TOKEN` takes precedence for local and Actions runs. The `serve` command also accepts signed GitLab, Bitbucket, and Azure DevOps webhook events at `/gitlab/webhook`, `/bitbucket/webhook`, and `/azure-devops/webhook` when their provider webhook secrets are configured.

The manual `.github/workflows/mergeproof-agent.yml` workflow checks out a selected PR into an ephemeral Actions runner, runs the sandbox agent with an allowlisted verification command, uploads the JSON result as an artifact, and posts a summary comment. Its default-off `create_pr` input can apply the already-verified patch to a new branch and open a separate handoff PR; it never mutates the original PR branch. Agent-compatible editors can use `skills/mergeproof-review/SKILL.md` to invoke the same CLI contract.

The manual `.github/workflows/mergeproof-task.yml` workflow implements a GitHub issue from retrieved repository evidence in an ephemeral worktree. It requires an allowlisted verification command, uploads the machine-readable result, comments on the source issue, and only pushes a separate handoff PR when the explicit `create_pr` input is enabled.

The `.github/workflows/mergeproof-scheduled.yml` workflow reviews up to five open pull requests hourly when the repository variable `MERGEPROOF_SCHEDULE_ENABLED=true` is set, or immediately through `workflow_dispatch`. It publishes evidence checks, optionally publishes reviews when selected at dispatch time, generates a seven-day Markdown and CSV activity report, uploads machine-readable results, and never applies code or merges a pull request. Scheduled model usage is opt-in because it can incur API cost.

Repository policy lives in `.mergeproof/config.json`; use `mergeproof configuration` to inspect it or `mergeproof configuration --generate` to create the starter policy explicitly. A repository policy can inherit up to three levels of bounded JSON policy files through `"extends": "../organization-policy.json"`; `MERGEPROOF_CENTRAL_CONFIG` can provide an organization policy when the checkout does not contain one. Local scalar values override inherited values, while custom checks are combined and deduplicated before analysis. Team review guidance can be added to `.mergeproof/instructions.md`. Copy `.mergeproof/checks.example.json` to `.mergeproof/checks.json` to add bounded natural-language pre-merge checks; each check becomes a normal evidence criterion and cannot produce a ready decision without valid citations. Supported policy keys are `provider`, `model`, `effort`, `retrievalTopK`, `minCitationsPerCriterion`, and optional inline `customChecks`. Review effort defaults to `medium`; `low` uses four repository chunks, `medium` eight, and `high` sixteen unless `--retrieval-top-k` is explicitly set.

Use `--record` on `plan` or `work-plan` to append a local, bounded version to `.mergeproof/plan-history.jsonl`; each entry stores the plan digest, model, repository head, stable plan identity, and version. This history is local metadata and is ignored from source control by default.

Save a machine-readable run with `-- --json` and use `evaluate` to report criterion coverage, citation coverage, abstention, unsupported claims, and retrieval usage. This makes MergeProof quality measurable instead of relying on an attractive demo transcript.

Review capsules make the decision portable: `bundle create` snapshots the fetched change-request context alongside the saved analysis, exact head SHA, citation manifest, and SHA-256 digests. `bundle verify` performs an offline integrity and citation check without a model, network request, or MergeProof service. Capsules can contain source patches and discussion text, so treat them as sensitive artifacts and store them only where the repository policy allows.

Interactive sessions are append-only JSONL under `.mergeproof/sessions/`. A session stores bounded prompts, outcomes, and provenance traces rather than API keys or source snapshots. `fleet ask` and `fleet plan` run up to five configured models in parallel, refuse to combine results observed from different repository heads, and report answer or plan disagreement instead of hiding it. `fleet review` is the same unanimous evidence gate exposed through a Copilot-style parallel workflow. `mergeproof acp --stdio` exposes the same safe ask/plan/review contract over the editor-neutral Agent Client Protocol, with a loopback TCP mode via `--port`; ACP sessions advertise their available commands and never expose mutation modes. For controlled remote steering, `serve` can expose `POST /session/turn` when `MERGEPROOF_REMOTE_SESSION_SECRET` is configured, and `mergeproof remote` sends fresh HMAC-signed turns to it. Requests can only run read-only `ask`, `plan`, or `review` turns against the configured checkout. Remote `implement` is deliberately rejected.

Autonomous correction is explicit rather than hidden: `mergeproof autopilot "request" --repo . --verify "npm test"` can make up to three evidence-re-reviewed correction attempts, and `--apply` applies only the converged patch after a stale-checkout and permission check. Copy `.mergeproof/permissions.example.json` to `.mergeproof/permissions.json` to deny actions, restrict paths, or require verification before mutation/publication. Inspect the active policy with `mergeproof permissions --repo .`.

The review stream is agent-friendly: `mergeproof review . --agent-output` emits one JSON object per line for `review_context`, `status`, `finding`, and `complete`, including source citations and the attestation digest. Use `sessions fork`, `sessions export --format markdown|json`, `sessions delete`, and `sessions delete-all --yes` to manage local transcripts. `mergeproof doctor --repo .` checks runtime, GitHub auth, model credentials, writable storage, optional web search, and Cargo availability without printing secret values. `mergeproof research` uses network only when Tavily or Brave credentials are explicitly configured; otherwise it reports that research is unavailable.

For Jira context, configure `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` in `.env`; for Linear context, configure `LINEAR_API_KEY` and optionally `LINEAR_TEAM_KEY`; link an issue in the change request body using a Jira or Linear URL. For Slack notifications, pass `--slack-webhook` explicitly; webhook URLs are never persisted by MergeProof.

Mutation actions are explicit: `--publish-review` posts a GitHub review or fallback PR comment, `--publish-summary` updates only the `mergeproof-summary` marker block in a GitHub PR body, `--create-gitlab-issue` creates a GitLab follow-up using `GITLAB_TOKEN`, and `--create-jira` creates a Jira follow-up using `JIRA_PROJECT_KEY`. These flags are never enabled by default.

Review memory is local JSONL at `.mergeproof/memory.jsonl`; use `--remember` to persist a CLI run or start `serve` for webhook-driven persistence. Automatic review lifecycle state is explicit and local at `.mergeproof/review-state.json`; use `state --pause`, `state --resume`, `state --ignore <PR URL>`, or `state --unignore <PR URL>` to control signed webhook reviews. Set `state --auto-pause-after <commits>` to suppress repetitive incremental reviews until an explicit resume. Explicit knowledge facts are stored separately at `.mergeproof/knowledge.jsonl` and can only be added by a human through `knowledge --add` or Slack `learn`; both stores are bounded and contain summaries/facts, not repository source snapshots. `mergeproof serve` validates `x-hub-signature-256` before accepting GitHub events and supports `/mergeproof review`, `/mergeproof full review`, `/mergeproof summary`, `/mergeproof diagram`, `/mergeproof generate sequence diagram`, `/mergeproof docstrings`, `/mergeproof generate docstrings`, `/mergeproof generate unit tests`, `/mergeproof plan`, `/mergeproof implement <request>`, `/mergeproof autofix`, `/mergeproof autofix stacked pr`, `/mergeproof run <recipe>`, `/mergeproof resolve`, `/mergeproof configuration`, `/mergeproof generate configuration`, `/mergeproof issue`, `/mergeproof pause`, `/mergeproof resume`, `/mergeproof ignore`, `/mergeproof unignore`, and `/mergeproof help` comments on pull requests. The explicit `implement`, `autofix stacked pr`, and `run <recipe>` commands require a configured checkout and open separate verified PRs; they never edit the source PR branch. Set `MERGEPROOF_COMMENT_AGENT_VERIFY`, `MERGEPROOF_COMMENT_AUTOFIX_VERIFY`, or `MERGEPROOF_COMMENT_RECIPE_VERIFY` to an allowlisted verification command when those comment-driven mutations are enabled. If `SLACK_SIGNING_SECRET` is configured, the same receiver exposes `/slack/commands` and `/slack/events`: `review`, `investigate`, `walkthrough` (also `summary` or `diagram`), `docstrings`, `plan`, `fix`, `tests`, `learn`, `pause`, `resume`, `rate`, and `autofix` accept the supported commands; explicit `issue` creation supports GitHub and GitLab by default, or Jira/Linear when `MERGEPROOF_SLACK_ISSUE_PROVIDER` is explicitly set. Configure `SLACK_BOT_TOKEN` for threaded Events API replies. Thread-local state stores only the last change-request URL, so follow-up messages can say `review` or `plan` without resending the URL. Slack and GitHub writes are never enabled without the command and credentials. Slack autofix additionally requires `MERGEPROOF_SLACK_AUTOFIX_ENABLED=true`, an explicit checkout, and an allowlisted verification command, then opens a separate PR.

Slack message automations are opt-in through `.mergeproof/automations.json`, using the shape in `.mergeproof/automations.example.json`. Each rule can constrain `channelIds`, `authorIds`, `contains`, and `topLevelOnly`; supported actions are review, investigate, plan, fix, tests, and learn. Automations require a change-request URL in the message or an existing thread reference, and never create issues, apply patches, merge, or push code. Signed external automations can use `/automation/webhook` with `.mergeproof/webhook-automations.json` to match an event and payload field before running a read-only review, investigation, plan, or fix suggestion.

The VS Code extension exposes `review`, `analyze`, URL-based `plan`, free-form `work-plan`, `fix`, `tests`, guarded `autofix`, and offline review-capsule verification commands from the command palette. Local review includes uncommitted files and uses the same validator as PR analysis, so desktop, terminal, CI, and editor results share one evidence contract. GitHub issue-comment commands include `/mergeproof review`, `/mergeproof full review`, `/mergeproof summary`, `/mergeproof diagram`, `/mergeproof plan`, `/mergeproof implement <request>`, `/mergeproof issue`, and `/mergeproof help`; only the explicit `implement` command creates a separate PR.

Fix suggestions are not silently committed, pushed, or posted to GitHub. Without `--apply`, MergeProof only emits a patch. With `--apply`, it rejects absolute or traversal paths and requires Git to accept the patch with whitespace errors treated as failures. The `agent` command is safer by default: it applies the patch only in an ephemeral Git worktree and can run only the explicitly supported verification commands.

## Product boundaries

MergeProof is intentionally local-first and evidence-gated. The repository includes a root `plugin.json` plus Claude, Cursor, GitHub agent, command, skill, and ACP packaging so the same review contract can travel across supported agent clients. It still does not claim to replace GitHub's inline autocomplete, hosted cloud-agent fleet, enterprise policy plane, or CodeRabbit's hosted knowledge administration, billing/tenant controls, and dashboard service. Those hosted surfaces require their own provider infrastructure; MergeProof's differentiator is an inspectable evidence ledger that makes every decision, external diagnostic, model output, permission decision, and mutation boundary auditable.

See `outputs/mergeproof-design.md` for the validated product design and review decisions.
