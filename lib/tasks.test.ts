import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cancelTask, createTaskRecord, isTaskAction, listTasks, readTask, writeTask } from "./tasks";

describe("durable local tasks", () => {
  it("validates the allowlist and persists an inspectable task record", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-task-"));
    try {
      expect(isTaskAction("review")).toBe(true);
      expect(isTaskAction("shell")).toBe(false);
      const task = createTaskRecord(root, "review", [root, "--json"], "review-one");
      await writeTask(task);
      expect((await readTask(root, task.id))?.args).toEqual([root, "--json"]);
      expect(await listTasks(root)).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cancels queued work without deleting its audit record", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-task-cancel-"));
    try {
      const task = createTaskRecord(root, "doctor", ["--repo", root, "--json"], "doctor-one");
      await writeTask(task);
      const cancelled = await cancelTask(root, task.id);
      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.error).toContain("operator");
      expect((await readTask(root, task.id))?.status).toBe("cancelled");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
