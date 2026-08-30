import { readFile } from "node:fs/promises";

const files = [
  "packages/dsh-host-balance/lib/index.js",
  "packages/dsh-host-balance/lib/security.js",
  "packages/dsh-client-balance/lib/client.js",
  "packages/dsh-balance/lib/index.js",
  "packages/dsh-balance/lib/host/index.js",
  "packages/dsh-balance/lib/host/security.js",
  "packages/dsh-balance/lib/host/net.js",
  "packages/dsh-balance/lib/host/http-utils.js",
  "packages/dsh-balance/lib/host/json-path.js",
  "packages/dsh-balance/lib/host/presets.js",
  "packages/dsh-balance/lib/host/validate.js",
  "packages/dsh-balance/lib/host/config-store.js",
  "packages/dsh-balance/lib/host/external-status.js",
  "packages/dsh-balance/lib/host/external-preview-cache.js",
  "packages/dsh-balance/lib/host/query.js",
  "packages/dsh-balance/lib/host/routes.js",
  "packages/dsh-balance/lib/client.js",
  "packages/dsh-balance/lib/client/client.js",
];

for (const file of files) {
  const source = await readFile(file, "utf8");
  if (!source.trim()) throw new Error(`${file} is empty`);
  // Syntax validation is delegated to Node so this script stays dependency-free.
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const manifest = JSON.parse(await readFile("packages/dsh-balance/package.json", "utf8"));
if (manifest.dsh?.bundle?.patch !== "./cordis.patch.yml" || manifest.dsh?.client?.platform !== "web") throw new Error("invalid dsh-balance manifest");
if (!manifest.exports?.["./client"] || !manifest.files?.includes("cordis.patch.yml")) throw new Error("incomplete dsh-balance package manifest");
const clientBundle = await readFile("packages/dsh-balance/lib/client/client.js", "utf8");
if (!clientBundle.includes(`id: "${manifest.name}"`)) throw new Error("client bundle loader id must match package name");
if (!clientBundle.includes(`key: "${manifest.name}"`)) throw new Error("keyed settings slot must use the package name");
const hostBundle = await readFile("packages/dsh-balance/lib/host/index.js", "utf8");
if (!hostBundle.includes(`settingsNamespace("${manifest.name}")`)) throw new Error("host settings namespace must match package name");
