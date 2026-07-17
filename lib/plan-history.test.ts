import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewPlan } from "./models";
import { readPlanHistory, recordPlanVersion } from "./plan-history";

const roots: string[] = [];
const plan: ReviewPlan = { summary: "Implement it", risks: [], steps: [{ title: "Change code", detail: "Add the behavior", citations: [] }], trace: { model: "test:model", headSha: "sha", fetchedSources: 1, citedSources: 0 } };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("plan history", () => {
  it("records versions with stable identity, digest, and head", async () => {
    const root = await fs.mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-plan-history-"));
    roots.push(root);
    const first = await recordPlanVersion(root, plan, { kind: "work-item", target: "repo", request: "Add feature" });
    const second = await recordPlanVersion(root, { ...plan, summary: "Implement it better" }, { kind: "work-item", target: "repo", request: "Add feature" });
    expect(first.id).toBe(second.id);
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(first.digest).not.toBe(second.digest);
    await expect(readPlanHistory(root, { id: first.id })).resolves.toMatchObject([{ version: 2 }, { version: 1 }]);
  });
});
