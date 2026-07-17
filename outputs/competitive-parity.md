# MergeProof Competitive Parity

This document keeps the product claim honest. The comparison is against GitHub Copilot Code Review and CodeRabbit's public documentation, not private implementation details.

## Capability Matrix

| Capability | MergeProof | Copilot Code Review | CodeRabbit |
| --- | --- | --- | --- |
| GitHub PR review | Yes | Yes | Yes |
| GitLab / Bitbucket / Azure DevOps ingestion | Yes: normalized read-only analysis | Azure DevOps and broader provider support | GitLab, Bitbucket, and Azure DevOps support |
| Local uncommitted review | Yes: staged, unstaged, and untracked changes | IDE and CLI surfaces | IDE and CLI surfaces |
| Agent handoff / fix verification | Yes: local ephemeral Git worktree, optional one-pass re-review, GitHub-issue-to-PR task agent, manual ephemeral GitHub Actions runner, GitHub/GitLab review-finding autofix, and GitHub stacked-PR handoff | Cloud-agent handoff | Agent handoff, Autofix, and autonomous fix/review cycles |
| Automatic review trigger | GitHub Actions, signed webhook, and opt-in hourly scheduled review | Yes | Yes: GitHub, GitLab, Bitbucket, and Azure DevOps signed receivers plus Actions |
| Governed external automations | Signed `/automation/webhook` with event, nested-field, and URL matching; read-only review/plan/fix actions | Actions, MCP, and cloud-agent workflows | Scheduled, message-triggered, and custom webhook automations |
| Full PR context | Files, commits, checks, discussion, Jira/Linear, local and explicitly linked repositories, opt-in read-only MCP tools, and labeled web search | Full changeset, repository, and MCP context | PR, issue, repository, knowledge base context |
| Direct issue planning | GitHub, Jira, and Linear issue URL to acceptance criteria, evidence plan, and citations; GitHub issues can also drive a guarded implementation patch | Issue and task workflows | Issue planning and task actions |
| Suggested reviewers | Path-aware suggestions from CODEOWNERS and `.mergeproof/reviewers.json` | Suggested reviewers and team rules | Suggested reviewer rules |
| Team instructions | `.mergeproof`, Copilot, AGENTS, CLAUDE, cursorrules files, and named custom-agent profiles | Custom instructions, custom agents, skills, MCP | Repository and path-based instructions |
| Citation-backed decision | Exact head-SHA citations and source validation | Actionable suggestions | Review findings and summaries |
| Durable memory | Local bounded review JSONL, explicit approved knowledge JSONL, plus bounded Slack thread reference state | Copilot Memory | Knowledge Base and learnings |
| Local audit history | Bounded JSONL metadata trail with decision, model, head SHA, and attestation lookup | Enterprise audit logs | Workspace audit logs |
| Review effort / scope | Low, medium, or high effort; local `--dir` scopes | Low/medium effort; IDE and repository scope | Directory-scoped CLI review |
| Review profiles | Quiet, chill, and assertive profiles with publication filtering and an attested selected profile | Review customization and repository instructions | Quiet, chill, and assertive profiles |
| Security gate | Deterministic scanner plus optional npm audit, Semgrep, and CodeQL database creation/SARIF adapters | Security risk review and GitHub security ecosystem | Security Agent and built-in checks |
| Privacy / slop gate | Deterministic PII-pattern and placeholder/large-change signals, never removable by model output | Security and quality ecosystem | PII and slop detection |
| Safe fixes | Unified-diff suggestion; explicit checked apply; unresolved-thread autofix in a detached worktree with optional verification, re-review, default-branch PR, or GitHub stacked PR | Suggested multi-line fixes and cloud-agent handoff | Autofix and agent handoff |
| Simplify | Evidence-bounded behavior-preserving refactor patch with checked apply | Agent/code editing workflows | Simplify code command and walkthrough action |
| Conflict resolution | Read-only conflict inventory plus explicit `git apply --3way` resolution patch and staging gate | Agent workflows | Resolve merge conflicts action |
| Test generation | Test-only unified-diff suggestion | Agent/code generation workflows | Generate unit tests |
| Documentation generation | Documentation-only patch suggestion bounded to changed non-test files | Agent/code generation workflows | Generate docstrings |
| Issue creation | GitHub, Jira, and Linear | GitHub task workflows | GitHub, GitLab, Jira, Linear |
| Slack | Signed slash commands, Events API mentions, thread follow-ups, `learn`, rate-limit visibility, governed automations, and guarded stacked-PR autofix | GitHub ecosystem integrations | Conversational agent, learning, automations, and PR actions |
| Model choice | OpenAI, OpenAI-compatible including local endpoints, Anthropic | GitHub-managed model controls | Product-managed model controls |
| Client surfaces | CLI, native Windows desktop, VS Code, Cursor plugin metadata/rule, JetBrains plugin source, CI, and installable agent skill | GitHub, IDE, CLI, cloud agent | Git platforms, IDE, CLI, Slack |
| Consensus gate | Parallel provider/model reviews with per-criterion agreement; `ready` requires unanimous evidence | Agent/sub-agent orchestration | Agent workflows and review automation |
| Walkthrough / change stack | Evidence-derived summary, ordered change layers, review effort, related issues, reviewers, and Mermaid change-flow diagram; citations resolve to fetched files | Repository and PR context, agent workflows | Walkthrough, changed-file summary, sequence diagrams, effort estimate, related issues, labels, reviewers |
| Review lifecycle controls | Explicit local pause/resume, per-PR ignore/unignore, and per-PR auto-pause after a configured number of incremental commits; manual review remains available | Pause/resume and repository policy controls | Pause, resume, ignore, and review controls |
| Review-thread resolution | Read-only current-thread inventory; explicit `--apply` GraphQL resolution for selected or all current threads | Review feedback and agent actions | Resolve all review comments command |
| Named finishing touches | `.mergeproof/recipes.json` recipes with bounded instructions, path scopes, checked patches, verification, re-review, and optional GitHub PR handoff | Custom agents, skills, and hooks | Custom finishing-touch recipes |
| Natural-language PR editing | Explicit `/mergeproof implement <request>` comment creates a separate evidence-grounded, verified GitHub PR; source branch is never mutated | `@copilot` cloud-agent task handoff | Agent chat code editing and stacked PR handoff |
| Repository Q&A | Read-only `mergeproof ask` / `chat` with bounded local retrieval, instructions, selected model, and trace metadata | Copilot CLI question answering and repository exploration | IDE/CLI review context and chat |
| Outcome calibration | Local outcome ledger records merged/closed or human-labeled outcomes against decision, head SHA, and attestation; `feedback` and `metrics` expose calibration | Copilot usage metrics focus on adoption and PR lifecycle | CodeRabbit dashboards and reports focus on review activity and outcomes |
| Reports / export | Local `report` command aggregates activity, decisions, models, attestation coverage, outcomes, calibration, and CSV export; scheduled review workflow uploads weekly Markdown and CSV artifacts | GitHub and IDE usage surfaces | Dashboard filters, reports, and CSV export |

## Differentiation

MergeProof's primary novelty is a **merge evidence ledger**, not another ungrounded review chatbot:

1. Every model citation must resolve to a fetched PR source and the exact PR head SHA or working-tree digest.
2. Local repository retrieval is rejected when its index is stale or belongs to another GitHub remote.
3. Missing evidence produces an explicit abstention state instead of a confident approval.
4. Deterministic security findings cannot be removed by model output and are included in every publication path.
5. Review memory is local, bounded, redacted, and inspectable rather than silently retained by a hosted service.
6. Fixes are tested in an ephemeral Git worktree before they can be reported as verified; the developer checkout is not mutated.
7. Every completed analysis emits a reproducible SHA-256 attestation over the decision, evidence rows, security findings, and PR head SHA or working-tree digest.
8. Independent model disagreement is surfaced as a first-class merge risk; consensus never hides minority evidence.
9. The walkthrough is generated from fetched change evidence rather than invented runtime behavior; its Mermaid diagram is explicitly labeled as a change flow, not a production execution trace.
10. Named finishing touches are configuration-reviewed and path-scoped; a recipe cannot silently expand its write surface beyond its configured scope.
11. Outcome feedback closes the loop between a merge decision and what happened after merge, allowing teams to measure ready-decision calibration instead of optimizing only for review volume.
12. Saved analyses can be independently attestation-verified after transport or publication, making tampering observable instead of trusting the displayed decision.

## Remaining Deliberate Gaps

MergeProof is not a complete replacement for the surrounding GitHub platform or CodeRabbit product. It does not reproduce GitHub's hosted Copilot cloud-agent runtime, CodeRabbit's hosted knowledge administration, or their managed billing/tenant controls. Its local equivalent is the explicit issue-agent and sandbox handoff: repository evidence is bounded, patches are verified in an ephemeral worktree, and a PR is only pushed when the operator enables it. The differentiator remains an inspectable evidence ledger, deterministic privacy/quality gates, model disagreement visibility, and a conservative mutation boundary.
