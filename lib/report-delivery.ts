export type ReportDestination = "slack" | "discord" | "teams";

export type ReportEmailOptions = { to: string; from: string; subject?: string; apiKey?: string };

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

function validateEmail(value: string, label: string): string {
  const email = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw new Error(`${label} must be a valid email address.`);
  return email;
}

export async function publishReviewReportEmail(report: string, options: ReportEmailOptions): Promise<void> {
  const to = validateEmail(options.to, "Report recipient");
  const from = validateEmail(options.from, "Report sender");
  const apiKey = options.apiKey || process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error("SENDGRID_API_KEY is required for email report delivery.");
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: from }, subject: options.subject?.trim().slice(0, 200) || "MergeProof review report", content: [{ type: "text/plain", value: report.slice(0, 100_000) }] }),
  });
  if (!response.ok) throw new Error(`Email report delivery failed with HTTP ${response.status}.`);
}
