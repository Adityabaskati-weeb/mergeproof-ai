import { promises as fs } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSlackThread, recordSlackThread } from "./slack-memory";

describe("Slack thread memory", () => {
  it("stores only the latest bounded change-request reference", async () => {
    const root = await fs.mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-slack-memory-"));
    try {
      await recordSlackThread(root, "C123:T456", "https://github.com/acme/payments/pull/42");
      await recordSlackThread(root, "C123:T456", "https://gitlab.com/acme/payments/-/merge_requests/7");
      await expect(readSlackThread(root, "C123:T456")).resolves.toMatchObject({ key: "C123:T456", prUrl: "https://gitlab.com/acme/payments/-/merge_requests/7" });
      await expect(readSlackThread(root, "other")).resolves.toBeUndefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
