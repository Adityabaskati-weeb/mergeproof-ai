import { describe, expect, it, vi } from "vitest";
import { publishReviewReport } from "./report-delivery";

describe("report delivery", () => {
  it("publishes provider-shaped payloads to approved webhook hosts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await publishReviewReport("discord", "https://discord.com/api/webhooks/123/token", "# report");
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ body: JSON.stringify({ content: "# report" }) }));
    vi.unstubAllGlobals();
  });

  it("rejects arbitrary webhook hosts", async () => {
    await expect(publishReviewReport("slack", "https://example.com/hook", "report")).rejects.toThrow("approved slack webhook host");
  });
});
