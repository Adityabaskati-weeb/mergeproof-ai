import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addKnowledge, readKnowledge } from "./knowledge";

describe("governed knowledge", () => {
  it("stores explicit human facts and filters by repository and changed path", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-knowledge-"));
    const ref = { owner: "acme", repo: "payments", number: 1, url: "https://github.com/acme/payments/pull/1" };
    try {
      const global = await addKnowledge(root, ref, "Payment retries must use exponential backoff.");
      const scoped = await addKnowledge(root, ref, "The API client is intentionally generated; edit the schema instead.", ["src/api"]);
      await addKnowledge(root, { ...ref, repo: "other" }, "Do not leak this fact.");
      await addKnowledge(root, ref, scoped.content, ["src/api"]);

      const facts = await readKnowledge(root, ref, ["src/api/client.ts"], "", 10);
      expect(facts.map((fact) => fact.id)).toEqual([global.id, scoped.id]);
      expect(facts.every((fact) => fact.approved && fact.source === "human")).toBe(true);
      expect((await readKnowledge(root, ref, ["docs/readme.md"], "", 10)).map((fact) => fact.id)).toEqual([global.id]);
      expect((await readKnowledge(root, { ...ref, repo: "other" }, [], "", 10)).map((fact) => fact.content)).toEqual(["Do not leak this fact."]);
      expect((await readFile(join(root, ".mergeproof", "knowledge.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean)).toHaveLength(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
