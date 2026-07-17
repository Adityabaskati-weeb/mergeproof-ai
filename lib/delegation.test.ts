import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cancelDelegation, createDelegationRecord, listDelegations, readDelegation, readDelegationResult, runDelegationWorker, writeDelegation } from "./delegation";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("delegated sessions", () => {
  it("persists a bounded request and lists it without exposing a model secret", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-delegation-test-"));
    roots.push(root);
    const record = createDelegationRecord({ repoPath: root, request: "Add a focused test", verify: "npm test", model: "gpt-5.6" }, "delegate-test");
    await writeDelegation(record);
    expect((await readDelegation(root, "delegate-test"))?.request).toBe("Add a focused test");
    expect((await listDelegations(root)).map((value) => value.id)).toEqual(["delegate-test"]);
    expect(await readFile(record.resultPath).catch(() => undefined)).toBeUndefined();
  });

  it("cancels a queued delegation and writes a durable result artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-delegation-test-"));
    roots.push(root);
    const queued = createDelegationRecord({ repoPath: root, request: "Wait for operator", verify: "npm test" }, "delegate-queued");
    await writeDelegation(queued);
    const cancelled = await cancelDelegation(root, queued.id);
    expect(cancelled?.status).toBe("cancelled");
    expect((await readDelegationResult(root, queued.id))?.status).toBe("cancelled");
  });

  it("does not leave a non-Git repository queued forever", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-delegation-test-"));
    roots.push(root);
    const record = createDelegationRecord({ repoPath: root, request: "Run safely", verify: "npm test" }, "delegate-invalid-repo");
    await writeDelegation(record);
    const failed = await runDelegationWorker(root, record.id);
    expect(failed?.status).toBe("failed");
    expect((await readDelegationResult(root, record.id))?.status).toBe("failed");
  });
});
