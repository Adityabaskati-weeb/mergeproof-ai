# MergeProof Competitive Parity

This document keeps the product claim honest. The comparison is against GitHub Copilot Code Review and CodeRabbit's public documentation, not private implementation details.

## Capability Matrix

| Capability | MergeProof | Copilot Code Review | CodeRabbit |
| --- | --- | --- | --- |
| GitHub PR review | Yes | Yes | Yes |
| Automatic review trigger | GitHub Actions and signed webhook | Yes | Yes |
| Full PR context | Files, commits, checks, discussion, Jira, local repository | Full changeset and repository context | PR, issue, repository, knowledge base context |
| Team instructions | `.mergeproof`, Copilot, AGENTS, CLAUDE, cursorrules files | Custom instructions, skills, MCP | Repository and path-based instructions |
| Citation-backed decision | Exact head-SHA citations and source validation | Actionable suggestions | Review findings and summaries |
| Durable memory | Local bounded JSONL, opt-in | Copilot Memory | Knowledge Base and learnings |
| Security gate | Deterministic added-line scanner | Security risk review and GitHub security ecosystem | Security Agent and built-in checks |
| Safe fixes | Unified-diff suggestion; explicit checked apply | Suggested multi-line fixes and cloud-agent handoff | Autofix and agent handoff |
| Test generation | Test-only unified-diff suggestion | Agent/code generation workflows | Generate unit tests |
| Issue creation | GitHub and Jira | GitHub task workflows | GitHub, GitLab, Jira, Linear |
| Slack | Signed slash commands for review, plan, issue | GitHub ecosystem integrations | Conversational Slack agent |
| Model choice | OpenAI, OpenAI-compatible, Anthropic | GitHub-managed model controls | Product-managed model controls |
| Client surfaces | CLI, native Windows desktop, VS Code, CI | GitHub, IDE, CLI, cloud agent | Git platforms, IDE, CLI, Slack |

## Differentiation

MergeProof's primary novelty is a **merge evidence ledger**, not another ungrounded review chatbot:

1. Every model citation must resolve to a fetched PR source and the exact PR head SHA.
2. Local repository retrieval is rejected when its index is stale or belongs to another GitHub remote.
3. Missing evidence produces an explicit abstention state instead of a confident approval.
4. Deterministic security findings cannot be removed by model output and are included in every publication path.
5. Review memory is local, bounded, redacted, and inspectable rather than silently retained by a hosted service.

## Remaining Deliberate Gaps

MergeProof is not yet a complete replacement for the surrounding GitHub platform or CodeRabbit product. GitLab, Bitbucket, Azure DevOps, Linear, JetBrains/Cursor-native clients, CodeQL-class analysis, cloud sandbox execution, and full Slack conversational tool orchestration remain separate implementation tracks. The product should claim “evidence-backed, provider-neutral merge control” rather than “all competitor features” until those tracks are shipped and independently tested.
