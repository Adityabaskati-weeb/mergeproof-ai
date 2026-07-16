import type { PullRequestContext } from "./github";
import type { SecurityFinding } from "./types";
import { addedLines } from "./security";

function luhn(value: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (doubleDigit) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export function scanPullRequestPrivacy(context: PullRequestContext): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const file of context.files) {
    for (const added of addedLines(file.patch)) {
      const checks: Array<{ id: string; title: string; severity: SecurityFinding["severity"]; detail: string; match: boolean }> = [
        { id: "ssn", title: "Possible US Social Security number", severity: "high", detail: "A Social Security number-shaped literal was added to the change.", match: /\b\d{3}-\d{2}-\d{4}\b/.test(added.text) },
        { id: "iban", title: "Possible IBAN added", severity: "high", detail: "An IBAN-shaped literal was added to the change.", match: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/i.test(added.text) },
        { id: "email", title: "Possible personal email added", severity: "medium", detail: "An email address was added to the change; verify that it is not personal data or an unintended recipient.", match: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(added.text) && !/@(?:example|test|localhost)\.(?:com|org|net)\b/i.test(added.text) },
        { id: "phone", title: "Possible phone number added", severity: "medium", detail: "A phone-number-shaped literal was added to the change; verify consent and data handling.", match: /(?:\+?\d[\d\s().-]{8,}\d)/.test(added.text) },
      ];
      const cardDigits = added.text.match(/(?:\d[ -]?){13,19}/)?.[0].replace(/\D/g, "");
      if (cardDigits && luhn(cardDigits)) checks.push({ id: "payment-card", title: "Possible payment card number", severity: "high", detail: "A payment-card-shaped literal passed a checksum and was added to the change.", match: true });
      for (const check of checks) {
        if (!check.match) continue;
        findings.push({ id: `${check.id}:${file.path}:${added.line}`, title: check.title, severity: check.severity, path: file.path, line: added.line, detail: check.detail, category: "privacy", citation: { path: file.path, commitSha: context.headSha, url: `${file.url}#L${added.line}` } });
      }
    }
  }
  return findings.filter((finding, index, values) => values.findIndex((candidate) => candidate.id === finding.id) === index);
}
