import { describe, expect, it, vi } from "vitest";
import { publishReviewReport, publishReviewReportEmail } from "./report-delivery";

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

  it("delivers email reports through SendGrid with validated addresses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);
    await publishReviewReportEmail("# report", { to: "team@example.com", from: "bot@example.com", apiKey: "sg-test" });
    expect(fetchMock).toHaveBeenCalledWith("https://api.sendgrid.com/v3/mail/send", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer sg-test" }) }));
    vi.unstubAllGlobals();
  });

  it("rejects invalid report email addresses", async () => {
    await expect(publishReviewReportEmail("report", { to: "not-an-email", from: "bot@example.com", apiKey: "sg-test" })).rejects.toThrow("recipient");
  });
});
