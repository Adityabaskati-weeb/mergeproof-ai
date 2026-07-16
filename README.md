# MergeProof

MergeProof is an evidence-backed merge decision agent for engineering teams. It turns a Jira ticket and GitHub pull request into a cited change contract across code, tests, and release readiness.

## Current vertical slice

- Responsive GitHub-first dashboard
- Evidence matrix with source citations
- Three-state decision model: ready, needs evidence, needs owner decision
- RAG provenance surface showing retrieved repository context
- Typed analysis API seam ready for the OpenAI and GitHub integrations

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

## Planned integrations

- GitHub App + Octokit for pull request webhooks, diffs, checks, and comments
- OpenAI Responses API with structured output for the Change Contract
- Hybrid repository retrieval using lexical search plus `pgvector`
- Jira Cloud REST API for acceptance criteria and approved follow-ups
- Slack Bolt for approved ownership messages

See `outputs/mergeproof-design.md` for the validated product design and review decisions.
