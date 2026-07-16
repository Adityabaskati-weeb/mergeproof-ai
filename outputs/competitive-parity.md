# MergeProof Competitive Parity

This document keeps the product claim honest. The comparison is against GitHub Copilot Code Review and CodeRabbit's public documentation, not private implementation details.

## Capability Matrix

| Capability | MergeProof | Copilot Code Review | CodeRabbit |
| --- | --- | --- | --- |
| GitHub PR review | Yes | Yes | Yes |
| GitLab / Bitbucket / Azure DevOps ingestion | Yes: normalized read-only analysis | Azure DevOps and broader provider support | GitLab, Bitbucket, and Azure DevOps support |
| Local uncommitted review | Yes: staged, unstaged, and untracked changes | IDE and CLI surfaces | IDE and CLI surfaces |
| Agent handoff / fix verification | Yes: local ephemeral Git worktree plus manual ephemeral GitHub Actions runner with artifact/comment output | Cloud-agent handoff | Agent handoff and Autofix |
| Automatic review trigger | GitHub Actions and signed webhook | Yes | Yes: GitHub, GitLab, Bitbucket, and Azure DevOps signed receivers plus Actions |
| Full PR context | Files, commits, checks, discussion, Jira/Linear, local repository, opt-in read-only MCP tools | Full changeset, repository, and MCP context | PR, issue, repository, knowledge base context |
| Team instructions | `.mergeproof`, Copilot, AGENTS, CLAUDE, cursorrules files | Custom instructions, skills, MCP | Repository and path-based instructions |
| Citation-backed decision | Exact head-SHA citations and source validation | Actionable suggestions | Review findings and summaries |
| Durable memory | Local bounded JSONL, opt-in | Copilot Memory | Knowledge Base and learnings |
| Security gate | Deterministic scanner plus optional npm audit, Semgrep, and CodeQL database creation/SARIF adapters | Security risk review and GitHub security ecosystem | Security Agent and built-in checks |
| Safe fixes | Unified-diff suggestion; explicit checked apply | Suggested multi-line fixes and cloud-agent handoff | Autofix and agent handoff |
| Test generation | Test-only unified-diff suggestion | Agent/code generation workflows | Generate unit tests |
| Issue creation | GitHub, Jira, and Linear | GitHub task workflows | GitHub, GitLab, Jira, Linear |
| Slack | Signed slash commands and Events API mentions for review, investigate, plan, safe fix, test patch, and issue | GitHub ecosystem integrations | Conversational Slack agent |
| Model choice | OpenAI, OpenAI-compatible, Anthropic | GitHub-managed model controls | Product-managed model controls |
| Client surfaces | CLI, native Windows desktop, VS Code, CI, installable agent skill for compatible editors | GitHub, IDE, CLI, cloud agent | Git platforms, IDE, CLI, Slack |

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

MergeProof is not yet a complete replacement for the surrounding GitHub platform or CodeRabbit product. Native JetBrains/Cursor UI plugins, automatic remote agent scheduling, and web-search context remain separate implementation tracks. Slack now supports conversational entry points, but it does not yet provide governed multi-turn knowledge, automation scheduling, or automatic PR creation.
