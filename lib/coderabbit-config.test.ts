import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importCoderabbitConfiguration, readCoderabbitConfiguration } from "./coderabbit-config";

describe("CodeRabbit configuration migration", () => {
  it("maps bounded review settings without executing YAML", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-coderabbit-"));
    try {
      await writeFile(join(root, ".coderabbit.yaml"), [
        "reviews:",
        "  profile: assertive",
        "  request_changes_workflow: true",
        "  path_filters:",
        "    - src/**",
        "  path_instructions:",
        "    - path: src/**",
        "      instructions: |",
        "        Verify API compatibility.",
        "        Require a focused test.",
        "  high_level_summary: false",
        "  auto_review:",
        "    enabled: false",
        "    auto_incremental_review: true",
        "    auto_pause_after_reviewed_commits: 3",
        "    ignore_title_keywords:",
        "      - wip",
        "    labels:",
        "      - ready-for-review",
        "      - '!draft'",
        "  drafts: false",
        "  base_branches:",
        "    - ^main$",
        "  ignore_usernames:",
        "    - bot-user",
        "  finishing_touches:",
        "    custom:",
        "      - name: api-contract",
        "        description: Add contract tests",
        "        instructions: |",
        "          Add tests for every changed endpoint.",
        "        paths:",
        "          - src",
        "knowledge_base:",
        "  linked_repositories:",
        "    - org/shared-contracts",
        "pre_merge_checks:",
        "  title:",
        "    mode: warning",
        "  custom_checks:",
        "    - mode: error",
        "      name: API contract",
        "      instructions: |",
        "        Every changed endpoint needs contract evidence.",
      ].join("\n"), "utf8");
      const preview = await readCoderabbitConfiguration(root);
      expect(preview?.policy).toMatchObject({ profile: "assertive", pathFilters: ["src/**"], requestChangesWorkflow: true, highLevelSummary: false, autoReview: false, autoIncrementalReview: true, autoPauseAfterReviewedCommits: 3, ignoreTitleKeywords: ["wip"], reviewLabels: ["ready-for-review", "!draft"], includeDrafts: false, baseBranches: ["^main$"], ignoreUsernames: ["bot-user"] });
      expect(preview?.policy.instructions).toContain("org/shared-contracts");
      expect(preview?.policy.instructions).toContain("Verify API compatibility.\nRequire a focused test.");
      expect(preview?.policy.customChecks?.[0].name).toContain("title");
      expect(preview?.policy.customChecks?.some((check) => check.name === "API contract" && check.instructions.includes("contract evidence"))).toBe(true);
      expect(preview?.recipes[0]).toMatchObject({ name: "api-contract", instructions: "Add tests for every changed endpoint.", paths: ["src"] });
      expect(preview?.unsupported).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("does not overwrite an existing policy without force", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-coderabbit-"));
    try {
      await writeFile(join(root, ".coderabbit.yml"), "reviews:\n  profile: quiet\n", "utf8");
      await mkdir(join(root, ".mergeproof"), { recursive: true });
      await writeFile(join(root, ".mergeproof", "config.json"), "{\"model\":\"local\"}\n", "utf8");
      const result = await importCoderabbitConfiguration(root);
      expect(result.created).toBe(false);
      expect(await readFile(join(root, ".mergeproof", "config.json"), "utf8")).toContain("local");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
