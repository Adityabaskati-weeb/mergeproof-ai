# MergeProof: Evidence-Backed Merge Decisions

## Understanding Summary

- MergeProof is a GitHub-first work and productivity tool for engineering teams.
- It verifies whether a pull request provides sufficient evidence that it fulfils the linked Jira task safely enough to merge.
- It creates a change contract from the Jira issue and PR description, then traces every acceptance criterion to code, tests, and release evidence.
- The primary result is one of: `Ready to merge`, `Needs evidence`, or `Needs owner decision`.
- GitHub is the required live integration. Jira and Slack actions are approval-gated extensions.
- It does not autonomously merge, act as a general chatbot, replace Copilot, or claim reliable incident prediction.

## Assumptions and Constraints

- MVP serves small engineering teams and processes one PR at a time.
- The GitHub App receives minimum permissions and processes only the PR, its linked issue, and relevant checks.
- Raw code is not retained after analysis; structured findings and audit records are retained.
- Every write to Jira or Slack requires an explicit human approval.
- A PR analysis should complete in under two minutes for a typical small-to-medium change.

## Product Flow

1. A GitHub pull request opens or is updated.
2. MergeProof reads the PR description, changed files, linked Jira issue, check runs, and test results.
3. A hybrid RAG layer retrieves the most relevant repository artifacts: nearby tests, API contracts, `CODEOWNERS`, runbooks, and architecture decisions. Every retrieved item retains its source path and commit reference.
4. The AI builds a structured change contract: acceptance criteria, expected code evidence, expected test evidence, and release considerations.
5. It emits an evidence matrix and a decision with citations to the PR, files, checks, Jira text, or retrieved repository artifacts.
6. The result is posted as a GitHub PR check or comment.
7. A user may approve a draft Jira follow-up or Slack ownership message.

## Design Decisions

| Decision | Alternatives considered | Rationale |
| --- | --- | --- |
| Evidence completeness over incident prediction | Generic AI review; incident-risk score | Evidence can be shown and challenged. Incident prediction needs historical labels and would be an unsubstantiated hackathon claim. |
| GitHub-first MVP | Equal GitHub/Jira/Slack scope | GitHub makes the value visible in the judging demo and contains the core PR evidence. |
| Three decisions, not a numerical score | Risk score; long review narrative | Clearer, less opaque, and forces actionable outcomes. |
| Human approval for external writes | Autonomous Jira/Slack actions | Protects teams from hallucinated or noisy actions and demonstrates responsible agent design. |
| Structured JSON outputs with cited evidence | Free-form prose | Allows deterministic rendering, auditability, and evaluation. |
| Hybrid RAG for repository context | Full-repository prompt; vector-only retrieval | Combines lexical search for exact identifiers with semantic search for related behavior, while keeping every answer traceable to a source. |

## Structured Review

### Skeptic / Challenger

- Objection: AI code review is crowded and a generic risk score is not defensible.
- Resolution: narrow the product to proving the link between requested behavior, implementation, validation, and release readiness.
- Objection: Jira and Slack integration are not novel by themselves.
- Resolution: use them only to resolve evidence gaps and ownership decisions, not as decorative integrations.

### Constraint Guardian

- Objection: Full-repository prompts create privacy, latency, and cost risks.
- Resolution: retrieve only the diff, selected relevant file slices, Jira issue, and check results; cap context and do not retain raw code.
- Objection: GitHub/Jira/Slack writes can be unreliable or unsafe.
- Resolution: use idempotent webhook processing, least-privilege OAuth scopes, action previews, and explicit approval gates.

### User Advocate

- Objection: Engineers will ignore opaque scores and noisy notifications.
- Resolution: show a compact evidence matrix in the PR and send Slack only for unresolved owner decisions.
- Objection: “AI-generated code” framing can feel accusatory.
- Resolution: assess the change itself, not who or what authored it.

## Arbiter Disposition

**APPROVED.** The accepted design has a distinct, testable job to be done: make merge decisions explainable through an evidence contract. The MVP scope remains feasible for a hackathon while showing real agent orchestration and responsible automation.
