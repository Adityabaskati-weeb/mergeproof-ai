import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const bundled = resolve(root, "dist/mergeproof-cli.cjs");
const sidecar = resolve(root, "apps/desktop/src-tauri/binaries/mergeproof-cli-x86_64-pc-windows-msvc.exe");
mkdirSync(dirname(bundled), { recursive: true });
mkdirSync(dirname(sidecar), { recursive: true });

execFileSync(process.execPath, [resolve(root, "node_modules/esbuild/bin/esbuild"), "bin/mergeproof.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${bundled}`], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [resolve(root, "node_modules/@yao-pkg/pkg/lib-es5/bin.js"), bundled, "--targets", "node22-win-x64", "--output", sidecar], { cwd: root, stdio: "inherit" });
