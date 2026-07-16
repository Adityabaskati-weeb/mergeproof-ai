import { describe, expect, it } from "vitest";
import { matchSlackAutomation, type SlackAutomation } from "./slack-automations";

const automation: SlackAutomation = { id: "review-alerts", action: "review", contains: ["review this pr"], channelIds: ["C123"], authorIds: ["U123"] };

describe("Slack automations", () => {
  it("requires configured channel, author, and message scope", () => {
    expect(matchSlackAutomation([automation], { type: "message", text: "Please review this PR https://github.com/acme/payments/pull/1", channel: "C123", user: "U123", ts: "1" })).toEqual(automation);
    expect(matchSlackAutomation([automation], { type: "message", text: "Please review this PR", channel: "C999", user: "U123", ts: "1" })).toBeUndefined();
    expect(matchSlackAutomation([automation], { type: "message", text: "Please review this PR", channel: "C123", user: "U123", thread_ts: "0", ts: "1" })).toBeUndefined();
  });
});
