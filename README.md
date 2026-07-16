# MergeProof

MergeProof is an evidence-backed merge decision agent for engineering teams. It turns a Jira ticket and GitHub pull request into a cited change contract across code, tests, and release readiness.

## Current vertical slice

- Paste a public GitHub pull request URL into the dashboard
- Fetch real PR metadata, changed files, commits, and checks with Octokit
- Extract acceptance criteria from the PR description
- Analyze the change with a configurable OpenAI model (GPT-5.6 by default)
- Validate model citations against the fetched GitHub sources
- Three-state decision model: ready, needs evidence, needs owner decision
- Provenance metrics for fetched sources, cited sources, unsupported claims, model, and latency

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

Set `OPENAI_API_KEY` in `.env.local` before running a live analysis. `GITHUB_TOKEN` is optional for public repositories but helps avoid GitHub API rate limits.

## Planned integrations

- GitHub App + Octokit for pull request webhooks, diffs, checks, and comments
- OpenAI Responses API with structured output for the Change Contract
- Hybrid repository retrieval using lexical search plus `pgvector`
- Jira Cloud REST API for acceptance criteria and approved follow-ups
- Slack Bolt for approved ownership messages

See `outputs/mergeproof-design.md` for the validated product design and review decisions.
