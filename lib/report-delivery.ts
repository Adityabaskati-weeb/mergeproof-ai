export type ReportDestination = "slack" | "discord" | "teams";

function validateDestination(destination: ReportDestination, webhookUrl: string): URL {
  const url = new URL(webhookUrl);
  if (url.protocol !== "https:") throw new Error("Report destinations must use HTTPS.");
  const host = url.hostname.toLowerCase();
  const allowed = destination === "slack"
    ? host === "hooks.slack.com"
    : destination === "discord"
      ? host === "discord.com" || host === "discordapp.com"
      : host.endsWith(".webhook.office.com") || host.endsWith(".logic.azure.com");
  if (!allowed) throw new Error(`The URL is not an approved ${destination} webhook host.`);
  return url;
}

function payload(destination: ReportDestination, report: string): Record<string, string> {
  const content = report.slice(0, 18_000);
  if (destination === "discord") return { content };
  return { text: content };
}

export async function publishReviewReport(destination: ReportDestination, webhookUrl: string, report: string): Promise<void> {
  const url = validateDestination(destination, webhookUrl);
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(destination, report)) });
  if (!response.ok) throw new Error(`${destination} report webhook failed with HTTP ${response.status}.`);
}
