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
        "  high_level_summary: false",
        "knowledge_base:",
        "  linked_repositories:",
        "    - org/shared-contracts",
        "pre_merge_checks:",
        "  title:",
        "    mode: warning",
      ].join("\n"), "utf8");
      const preview = await readCoderabbitConfiguration(root);
      expect(preview?.policy).toMatchObject({ profile: "assertive", pathFilters: ["src/**"], requestChangesWorkflow: true, highLevelSummary: false });
      expect(preview?.policy.instructions).toContain("org/shared-contracts");
      expect(preview?.policy.customChecks?.[0].name).toContain("title");
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
