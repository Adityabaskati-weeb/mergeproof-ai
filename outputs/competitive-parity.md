# MergeProof Competitive Parity

This document keeps the product claim honest. The comparison is against GitHub Copilot Code Review and CodeRabbit's public documentation, not private implementation details.

## Capability Matrix

| Capability | MergeProof | Copilot Code Review | CodeRabbit |
| --- | --- | --- | --- |
| GitHub PR review | Yes | Yes | Yes |
| GitLab / Bitbucket / Azure DevOps ingestion and publication | Yes: normalized analysis plus provider checks/reviews | Azure DevOps and broader provider support | GitLab, Bitbucket, and Azure DevOps support |
| Local uncommitted review | Yes: staged, unstaged, and untracked changes | IDE and CLI surfaces | IDE and CLI surfaces |
| Agent handoff / fix verification | Yes: local natural-language implementation agent, ephemeral Git worktree, optional one-pass re-review, GitHub-issue-to-PR task agent, manual ephemeral GitHub Actions runner, GitHub/GitLab review-finding autofix, and GitHub stacked-PR handoff | Cloud-agent handoff | Agent handoff, Autofix, and autonomous fix/review cycles |
| Automatic review trigger | GitHub Actions, signed webhook, and opt-in hourly scheduled review | Yes | Yes: GitHub, GitLab, Bitbucket, and Azure DevOps signed receivers plus Actions |
| Governed external automations | Signed `/automation/webhook` with event, nested-field, and URL matching; read-only review/plan/fix actions | Actions, MCP, and cloud-agent workflows | Scheduled, message-triggered, and custom webhook automations |
| Full PR context | Files, commits, checks, discussion, Jira/Linear, local and explicitly linked repositories, opt-in read-only MCP tools, and labeled web search | Full changeset, repository, and MCP context | PR, issue, repository, knowledge base context |
| Direct issue planning | GitHub, GitLab, Jira, and Linear issue URL to acceptance criteria, evidence plan, and citations; GitHub issues can also drive a guarded implementation patch | Issue and task workflows | Issue planning and task actions |
| Free-form product planning | `work-plan` accepts PRDs, designs, issue text, or plain requests; retrieves current checkout evidence and removes unsupported citations | Cloud-agent research and planning | Plans from PRDs, designs, issues, and free-form descriptions |
| Suggested reviewers | Path-aware suggestions from CODEOWNERS and `.mergeproof/reviewers.json` | Suggested reviewers and team rules | Suggested reviewer rules |
| Team instructions | `.mergeproof`, Copilot, AGENTS, CLAUDE, cursorrules files, named custom-agent profiles, and bounded central-policy inheritance | Custom instructions, custom agents, skills, MCP | Repository and path-based instructions plus central configuration |
| Natural-language pre-merge checks | `.mergeproof/checks.json` checks become evidence-backed criteria and cannot silently approve without citations | Repository instructions and checks | Built-in and custom pre-merge checks |
| Citation-backed decision | Exact head-SHA citations and source validation | Actionable suggestions | Review findings and summaries |
| Offline review capsule | Portable snapshot of fetched change context, analysis, source manifest, exact head SHA, and SHA-256 digests; verifiable without a model or network | Hosted review history and cloud artifacts | Hosted review history and dashboards |
| Durable memory | Local bounded review JSONL, explicit approved knowledge JSONL, plus bounded Slack thread reference state | Copilot Memory | Knowledge Base and learnings |
| Local audit history | Bounded JSONL metadata trail with decision, model, head SHA, and attestation lookup | Enterprise audit logs | Workspace audit logs |
| Review effort / scope | Low, medium, or high effort; local `--dir` scopes | Low/medium effort; IDE and repository scope | Directory-scoped CLI review |
| Review profiles | Quiet, chill, and assertive profiles with publication filtering and an attested selected profile | Review customization and repository instructions | Quiet, chill, and assertive profiles |
| Security gate | Deterministic changed-line gate plus `security` full-repository scanner, optional npm audit/Semgrep/CodeQL, and bounded SARIF ingestion for existing ESLint, Ruff, Gitleaks, Checkov, and other CI tools | Security risk review and GitHub security ecosystem | Security Agent and built-in checks |
| Privacy / slop gate | Deterministic PII-pattern and placeholder/large-change signals, never removable by model output | Security and quality ecosystem | PII and slop detection |
| Safe fixes | Unified-diff suggestion; explicit checked apply; unresolved-thread autofix in a detached worktree with optional verification, re-review, default-branch PR, or GitHub stacked PR | Suggested multi-line fixes and cloud-agent handoff | Autofix and agent handoff |
| Simplify | Evidence-bounded behavior-preserving refactor patch with checked apply | Agent/code editing workflows | Simplify code command and walkthrough action |
| Conflict resolution | Read-only conflict inventory plus explicit `git apply --3way` resolution patch and staging gate | Agent workflows | Resolve merge conflicts action |
| Test generation | Test-only unified-diff suggestion | Agent/code generation workflows | Generate unit tests |
| Documentation generation | Documentation-only patch suggestion bounded to changed non-test files | Agent/code generation workflows | Generate docstrings |
| Issue creation | GitHub, GitLab, Jira, and Linear | GitHub task workflows | GitHub, GitLab, Jira, Linear |
| Slack / Discord | Signed Slack slash commands, Events API mentions, thread follow-ups, default-deny channel/user/action scopes, durable hourly request budgets, and a signed Discord interaction endpoint reuse the same governed review, plan, issue, and guarded autofix actions | GitHub ecosystem integrations | Conversational agents, learning, automations, scopes, and PR actions |
| Model choice | OpenAI, OpenAI-compatible including local endpoints, Anthropic | GitHub-managed model controls | Product-managed model controls |
| Client surfaces | Interactive CLI chat, one-shot CLI, native Windows desktop, VS Code, Cursor plugin metadata/rule, JetBrains plugin source, CI, and installable agent skill | GitHub, IDE, CLI, cloud agent | Git platforms, IDE, CLI, Slack |
| Consensus gate | Parallel provider/model reviews with per-criterion agreement; `ready` requires unanimous evidence | Agent/sub-agent orchestration | Agent workflows and review automation |
| Walkthrough / change stack | Evidence-derived summary, ordered change layers, review effort, related issues, reviewers, Mermaid change-flow diagram, and conservative ERD/schema-impact diagram; citations resolve to fetched files | Repository and PR context, agent workflows | Walkthrough, changed-file summary, sequence diagrams and ERDs, effort estimate, related issues, labels, reviewers |
| Review lifecycle controls | Explicit local pause/resume, per-PR ignore/unignore, and per-PR auto-pause after a configured number of incremental commits; manual review remains available | Pause/resume and repository policy controls | Pause, resume, ignore, and review controls |
| Review-thread resolution | Read-only current-thread inventory; explicit `--apply` GraphQL resolution for selected or all current threads | Review feedback and agent actions | Resolve all review comments command |
| Named finishing touches | `.mergeproof/recipes.json` recipes with bounded instructions, path scopes, checked patches, verification, re-review, and optional GitHub PR handoff | Custom agents, skills, and hooks | Custom finishing-touch recipes |
| Natural-language editing | Local `mergeproof implement <request>` plus explicit `/mergeproof implement <request>` PR handoff; both use evidence-grounded patches and never mutate the source checkout/branch without an explicit gate | `@copilot` cloud-agent task handoff | Agent chat code editing and stacked PR handoff |
| Repository Q&A | Read-only `mergeproof ask` / `chat` with bounded local retrieval, instructions, selected model, and trace metadata | Copilot CLI question answering and repository exploration | IDE/CLI review context and chat |
| Outcome calibration | Local outcome ledger records merged/closed or human-labeled outcomes against decision, head SHA, and attestation; `feedback` and `metrics` expose calibration | Copilot usage metrics focus on adoption and PR lifecycle | CodeRabbit dashboards and reports focus on review activity and outcomes |
| Post-merge actions | Optional GitHub Actions workflow records merged lifecycle outcomes and uploads a machine-readable artifact without invoking a model | Cloud-agent and workflow automations | Post-merge actions for changelogs, tickets, and notifications |
| Reports / export | Local `report` command aggregates activity, decisions, models, attestation coverage, outcomes, calibration, CSV export, natural-language custom reports, and opt-in Slack/Discord/Teams/SendGrid email delivery; scheduled review workflow uploads weekly Markdown/CSV artifacts | GitHub and IDE usage surfaces | Dashboard filters, scheduled/on-demand custom reports, email/Slack/Discord/Teams delivery, and CSV export |
| Plan history | Optional local JSONL version history with stable plan identity, version, content digest, model, and repository head; inspectable through `plan-history` | Cloud-agent task history | Coding Plan refinement and version history |
| CI/CD failure context | Failed GitHub check summaries and annotations are fetched as cited evidence for analysis and safe fixes | Actions-backed agent context | CI/CD pipeline analysis with inline fix suggestions |

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
13. A local natural-language implementation request is treated as a reproducible, evidence-bounded patch job: clean HEAD, bounded retrieval, ephemeral worktree, verification, optional re-review, and stale-checkout refusal before apply.
14. Free-form planning uses the same ledger boundary as review: a plan is not allowed to retain citations from a different checkout or commit, so planning and implementation start from the same verifiable evidence surface.
15. Natural-language pre-merge checks are evaluated as normal evidence rows, so teams get a measurable abstention when a custom rule cannot be proven rather than an opaque pass/fail toggle.
16. Follow-up issues are duplicate-safe and enriched with related issue links, available smart labels, and optional configured assignees without inventing labels that do not exist in the repository.
17. Review capsules make a completed decision independently auditable after the provider or model is gone: the context, citations, exact head SHA, analysis attestation, and bundle digest travel together and can be checked offline.
18. Existing CI security and quality tools can join the evidence ledger through bounded SARIF artifacts; MergeProof does not need shell access to reproduce or trust a tool result.
19. Central policy inheritance keeps organization defaults reviewable as code while preserving repository-local overrides and the same bounded custom-check contract.

## Remaining Deliberate Gaps

MergeProof is not a complete replacement for the surrounding GitHub platform or CodeRabbit product. It does not reproduce GitHub's hosted Copilot cloud-agent runtime, CodeRabbit's hosted knowledge administration, or their managed billing/tenant controls. Its local equivalent is the explicit issue-agent and sandbox handoff: repository evidence is bounded, patches are verified in an ephemeral worktree, and a PR is only pushed when the operator enables it. The differentiator remains an inspectable evidence ledger, deterministic privacy/quality gates, model disagreement visibility, and a conservative mutation boundary.
