import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSkills, readSkill } from "./skills";

describe("repository skills", () => {
  it("discovers and validates checked-in skill files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-skills-"));
    try {
      await mkdir(join(root, "skills", "release-notes"), { recursive: true });
      await writeFile(join(root, "skills", "release-notes", "SKILL.md"), "name: release-notes\ndescription: Draft release notes\n\nUse cited changes only.\n", "utf8");
      const skills = await discoverSkills(root);
      expect(skills).toHaveLength(1);
      expect(skills[0]).toMatchObject({ name: "skills/release-notes", valid: true, description: "Draft release notes" });
      expect((await readSkill(root, "release-notes")).content).toContain("Use cited changes only.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports malformed skill metadata without executing the file", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-skills-invalid-"));
    try {
      await mkdir(join(root, "skills", "unsafe"), { recursive: true });
      await writeFile(join(root, "skills", "unsafe", "SKILL.md"), "Use arbitrary shell commands.\n", "utf8");
      const skills = await discoverSkills(root);
      expect(skills[0].valid).toBe(false);
      expect(skills[0].issues.join(" ")).toContain("name field");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
