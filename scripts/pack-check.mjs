import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const packageRoot = "packages/dsh-balance";
const manifest = JSON.parse(await readFile(`${packageRoot}/package.json`, "utf8"));
const required = ["package.json", "cordis.patch.yml", "lib/index.js", "lib/client.js", "lib/host/index.js", "lib/host/security.js", "lib/client/client.js", "README.md", "LICENSE", "SECURITY.md", "CHANGELOG.md", "docs/images/01-provider-settings.png", "docs/images/02-balance-editor.png", "docs/images/03-advanced-models.png", "docs/images/04-health-monitor.png", "docs/images/05-chat-status-bar.png", "docs/images/06-provider-switcher.png", "docs/images/07-health-details.png"];
for (const relative of required) await access(`${packageRoot}/${relative}`);
const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "pnpm";
const args = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm pack --dry-run"] : ["pack", "--dry-run"];
const result = spawnSync(command, args, { cwd: packageRoot, encoding: "utf8" });
if (result.status !== 0) {
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  process.exit(result.status ?? 1);
}
const output = `${result.stdout}\n${result.stderr}`;
const forbidden = ["design-balance-", "verify-balance-settings.png", ".git/"];
for (const entry of forbidden) if (output.includes(entry)) throw new Error(`forbidden package entry: ${entry}`);
for (const relative of required) {
  const archiveName = relative.replaceAll("\\", "/");
  if (relative !== "package.json" && !output.includes(archiveName)) throw new Error(`required package entry missing from pack output: ${relative}`);
}
console.log(`${manifest.name} package pack check passed (${manifest.version})`);
