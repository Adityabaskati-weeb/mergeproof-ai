import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { generateMergeProofConfiguration } from "./configuration";

export type InitFile = { path: string; created: boolean; purpose: string };
export type InitResult = { repository: string; files: InitFile[]; configurationCreated: boolean };

const TEMPLATES: Array<{ path: string; content: string; purpose: string }> = [
  {
    path: ".mergeproof/instructions.md",
    purpose: "Evidence-first repository review instructions",
    content: [
      "# MergeProof repository instructions",
      "",
      "- Treat unverified claims as needs-evidence, never as an approval.",
      "- Cite the exact changed file, check, test, or review thread used for each conclusion.",
      "- Do not expose secrets, credentials, or private data in findings or generated patches.",
      "- Prefer the smallest reversible patch and require verification before applying it.",
      "",
    ].join("\n"),
  },
  {
    path: ".mergeproof/permissions.json",
    purpose: "Safe default mutation policy",
    content: `${JSON.stringify({ default: "allow", actions: { apply: "allow", publish: "allow", resolve: "allow" }, allowedPaths: [], deniedPaths: [".env", "**/*.pem", "**/*secret*"], requireVerification: true }, null, 2)}\n`,
  },
  {
    path: ".mergeproof/checks.json",
    purpose: "Repository-specific pre-merge checks",
    content: "[]\n",
  },
  {
    path: ".mergeproof/README.md",
    purpose: "Local policy and evidence storage guide",
    content: [
      "# MergeProof local state",
      "",
      "This directory stores repository-scoped policy, evidence indexes, sessions, findings, audit events, and outcome data.",
      "",
      "Review generated files before committing them. Do not commit credentials or private evidence.",
      "",
    ].join("\n"),
  },
];

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function initializeRepository(root: string, force = false): Promise<InitResult> {
  const repository = resolve(root);
  await mkdir(join(repository, ".mergeproof"), { recursive: true });
  const configuration = await generateMergeProofConfiguration(repository, force);
  const files: InitFile[] = [{ path: configuration.path, created: configuration.created, purpose: "Repository MergeProof policy" }];
  for (const template of TEMPLATES) {
    const absolute = join(repository, template.path);
    const alreadyExists = await exists(absolute);
    if (!alreadyExists || force) await writeFile(absolute, template.content, "utf8");
    files.push({ path: template.path, created: !alreadyExists || force, purpose: template.purpose });
  }
  return { repository, files, configurationCreated: configuration.created };
}

export function renderInitialization(result: InitResult): string {
  return [
    `MergeProof initialized: ${result.repository}`,
    ...result.files.map((file) => `${file.created ? "CREATED" : "KEPT"} ${file.path} - ${file.purpose}`),
    "",
    "Next: review .mergeproof/checks.json, run `mergeproof index`, then run `mergeproof review`.",
  ].join("\n");
}
