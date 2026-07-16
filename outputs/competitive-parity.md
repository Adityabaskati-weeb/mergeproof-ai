# MergeProof Competitive Parity

This document keeps the product claim honest. The comparison is against GitHub Copilot Code Review and CodeRabbit's public documentation, not private implementation details.

## Capability Matrix

| Capability | MergeProof | Copilot Code Review | CodeRabbit |
| --- | --- | --- | --- |
| GitHub PR review | Yes | Yes | Yes |
| GitLab / Bitbucket / Azure DevOps ingestion | Yes: normalized read-only analysis | Azure DevOps and broader provider support | GitLab, Bitbucket, and Azure DevOps support |
| Local uncommitted review | Yes: staged, unstaged, and untracked changes | IDE and CLI surfaces | IDE and CLI surfaces |
| Agent handoff / fix verification | Yes: local ephemeral Git worktree, optional one-pass re-review, plus manual ephemeral GitHub Actions runner with artifact/comment output and explicit new-PR handoff | Cloud-agent handoff | Agent handoff, Autofix, and autonomous fix/review cycles |
| Automatic review trigger | GitHub Actions, signed webhook, and opt-in hourly scheduled review | Yes | Yes: GitHub, GitLab, Bitbucket, and Azure DevOps signed receivers plus Actions |
| Full PR context | Files, commits, checks, discussion, Jira/Linear, local and explicitly linked repositories, opt-in read-only MCP tools, and labeled web search | Full changeset, repository, and MCP context | PR, issue, repository, knowledge base context |
| Team instructions | `.mergeproof`, Copilot, AGENTS, CLAUDE, cursorrules files, and named custom-agent profiles | Custom instructions, custom agents, skills, MCP | Repository and path-based instructions |
| Citation-backed decision | Exact head-SHA citations and source validation | Actionable suggestions | Review findings and summaries |
| Durable memory | Local bounded review JSONL, explicit approved knowledge JSONL, plus bounded Slack thread reference state | Copilot Memory | Knowledge Base and learnings |
| Review effort / scope | Low, medium, or high effort; local `--dir` scopes | Low/medium effort; IDE and repository scope | Directory-scoped CLI review |
| Security gate | Deterministic scanner plus optional npm audit, Semgrep, and CodeQL database creation/SARIF adapters | Security risk review and GitHub security ecosystem | Security Agent and built-in checks |
| Safe fixes | Unified-diff suggestion; explicit checked apply | Suggested multi-line fixes and cloud-agent handoff | Autofix and agent handoff |
| Test generation | Test-only unified-diff suggestion | Agent/code generation workflows | Generate unit tests |
| Issue creation | GitHub, Jira, and Linear | GitHub task workflows | GitHub, GitLab, Jira, Linear |
| Slack | Signed slash commands, Events API mentions, bounded thread follow-ups, and governed message automations | GitHub ecosystem integrations | Conversational Slack agent and automations |
| Model choice | OpenAI, OpenAI-compatible, Anthropic | GitHub-managed model controls | Product-managed model controls |
| Client surfaces | CLI, native Windows desktop, VS Code, CI, Cursor rule, JetBrains External Tool recipe, installable agent skill | GitHub, IDE, CLI, cloud agent | Git platforms, IDE, CLI, Slack |

## Differentiation

MergeProof's primary novelty is a **merge evidence ledger**, not another ungrounded review chatbot:

1. Every model citation must resolve to a fetched PR source and the exact PR head SHA or working-tree digest.
2. Local repository retrieval is rejected when its index is stale or belongs to another GitHub remote.
3. Missing evidence produces an explicit abstention state instead of a confident approval.
4. Deterministic security findings cannot be removed by model output and are included in every publication path.
5. Review memory is local, bounded, redacted, and inspectable rather than silently retained by a hosted service.
6. Fixes are tested in an ephemeral Git worktree before they can be reported as verified; the developer checkout is not mutated.
7. Every completed analysis emits a reproducible SHA-256 attestation over the decision, evidence rows, security findings, and PR head SHA or working-tree digest.

## Remaining Deliberate Gaps

MergeProof is not yet a complete replacement for the surrounding GitHub platform or CodeRabbit product. Dedicated native JetBrains/Cursor marketplace plugins, Copilot-specific cloud hooks/custom-agent hosting, hosted knowledge administration, and automatic remote code-mutating agent scheduling remain separate implementation tracks. MergeProof now supports bounded Slack thread follow-ups, explicit approved local knowledge, explicitly linked local repositories, one-pass sandbox re-review, and opt-in scheduled read-only reviews; it does not silently schedule code-mutating agents.
